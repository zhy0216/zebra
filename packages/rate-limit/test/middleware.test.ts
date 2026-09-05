// C3 tests for the enforcement middleware (`src/middleware.ts`): the
// fixed-window check on the request path, `X-RateLimit-*` header injection
// on the success response, and the 429 via `HttpError` (Problem+Json through
// core's error middleware) with `Retry-After`.
//
// Most tests invoke the middleware directly against a real `MemoryStore`
// (default) with an inlined `next`, giving precise control over counts and
// headers; one integration test goes through `createTestApp` to pin the
// end-to-end Problem+Json contract (core turns the thrown `HttpError` into
// `application/problem+json` and copies its headers onto the response).

import { describe, expect, spyOn, test } from "bun:test";
import { HttpError, type ZebraRequest, buildRequest } from "@zebra-web/core";
import { type TestApp, createTestApp } from "@zebra-web/testing";

import { MemoryStore, rateLimit } from "../src/index.ts";

const WINDOW_MS = 60_000;

function makeReq(path = "/", init: RequestInit = {}, ip?: string): ZebraRequest {
  return buildRequest(new Request(`http://test.local${path}`, init), {}, undefined, ip);
}

/** `next` returning a canned success response. */
const okNext = async (): Promise<Response> => new Response("ok", { status: 200 });

describe("rateLimit middleware · option validation", () => {
  for (const option of ["windowMs", "max"] as const) {
    test.each([Number.NaN, Number.POSITIVE_INFINITY, Number.NEGATIVE_INFINITY, 0, -1])(
      `rejects ${option} %s when creating the middleware`,
      (value) => {
        const store = new MemoryStore();
        const increment = spyOn(store, "increment");
        expect(() => rateLimit({ windowMs: WINDOW_MS, max: 5, store, [option]: value })).toThrow(
          new Error(`rateLimit: ${option} must be a positive number`),
        );
        expect(increment).not.toHaveBeenCalled();
      },
    );
  }

  test("positive fractional options retain finite response and rejection headers", async () => {
    const clock = spyOn(Date, "now").mockReturnValue(1_000);
    try {
      const mw = rateLimit({ windowMs: 0.5, max: 1.5 });
      const res = await mw(makeReq(), okNext);
      expect(res.headers.get("x-rate-limit-limit")).toBe("1.5");
      expect(res.headers.get("x-rate-limit-remaining")).toBe("0.5");
      expect(res.headers.get("x-rate-limit-reset")).toBe("1");
      await expect(mw(makeReq(), okNext)).rejects.toMatchObject({
        status: 429,
        headers: {
          "x-rate-limit-limit": "1.5",
          "x-rate-limit-remaining": "0",
          "x-rate-limit-reset": "1",
          "retry-after": "1",
        },
      });
    } finally {
      clock.mockRestore();
    }
  });
});

describe("rateLimit middleware · within window", () => {
  test("passes requests through and injects Limit/Remaining/Reset headers", async () => {
    const mw = rateLimit({ windowMs: WINDOW_MS, max: 2 });
    const res = await mw(makeReq("/", {}, "1.2.3.4"), okNext);
    expect(res.status).toBe(200);
    expect(res.headers.get("x-rate-limit-limit")).toBe("2");
    expect(res.headers.get("x-rate-limit-remaining")).toBe("1");
    const reset = Number(res.headers.get("x-rate-limit-reset"));
    expect(Number.isInteger(reset)).toBe(true);
    expect(reset).toBeGreaterThan(Math.floor(Date.now() / 1000)); // epoch seconds, in the future
  });

  test("remaining decrements per request inside the same window", async () => {
    const mw = rateLimit({ windowMs: WINDOW_MS, max: 3 });
    const remaining = [];
    for (let i = 0; i < 3; i++) {
      const res = await mw(makeReq("/", {}, "1.2.3.4"), okNext);
      remaining.push(Number(res.headers.get("x-rate-limit-remaining")));
    }
    expect(remaining).toEqual([2, 1, 0]);
  });

  test("Reset is epoch seconds and sits inside the current window", async () => {
    const mw = rateLimit({ windowMs: WINDOW_MS, max: 5 });
    const before = Math.floor(Date.now() / 1000);
    const res = await mw(makeReq("/"), okNext);
    const reset = Number(res.headers.get("x-rate-limit-reset"));
    expect(reset).toBeGreaterThanOrEqual(before);
    expect(reset).toBeLessThanOrEqual(before + WINDOW_MS / 1000);
  });

  test("wraps the response without mutating status, statusText or body", async () => {
    const mw = rateLimit({ windowMs: WINDOW_MS, max: 2 });
    const res = await mw(makeReq("/"), async () => new Response("created", { status: 201 }));
    expect(res.status).toBe(201);
    expect(await res.text()).toBe("created");
    expect(res.headers.get("x-rate-limit-remaining")).toBe("1");
  });

  test("does not swallow handler exceptions (they propagate unchanged)", async () => {
    const mw = rateLimit({ windowMs: WINDOW_MS, max: 2 });
    const boom = new Error("boom");
    await expect(mw(makeReq("/"), async () => Promise.reject(boom))).rejects.toBe(boom);
  });
});

describe("rateLimit middleware · over the limit", () => {
  test("(max+1)-th request throws HttpError 429 with Retry-After and rate-limit headers", async () => {
    const mw = rateLimit({ windowMs: WINDOW_MS, max: 2 });
    await mw(makeReq("/", {}, "1.2.3.4"), okNext);
    await mw(makeReq("/", {}, "1.2.3.4"), okNext);
    await expect(mw(makeReq("/", {}, "1.2.3.4"), okNext)).rejects.toMatchObject({
      name: "HttpError",
      status: 429,
      code: "rate_limit_exceeded",
      title: "Too Many Requests",
    });
    let err: HttpError | undefined;
    try {
      await mw(makeReq("/", {}, "1.2.3.4"), okNext);
    } catch (e) {
      err = e as HttpError;
    }
    expect(err).toBeDefined();
    const retryAfter = Number(err!.headers?.["retry-after"]);
    expect(Number.isInteger(retryAfter)).toBe(true);
    expect(retryAfter).toBeGreaterThanOrEqual(1);
    expect(retryAfter).toBeLessThanOrEqual(WINDOW_MS / 1000);
    // The 429 also carries the rate-limit state: remaining is 0, Reset still
    // points at the same window's expiry (epoch seconds, in the future).
    expect(err!.headers?.["x-rate-limit-limit"]).toBe("2");
    expect(err!.headers?.["x-rate-limit-remaining"]).toBe("0");
    const reset = Number(err!.headers?.["x-rate-limit-reset"]);
    expect(reset).toBeGreaterThan(Math.floor(Date.now() / 1000));
    // Retry-After ≈ Reset − now (both count down to the same window end).
    expect(retryAfter).toBeLessThanOrEqual(reset - Math.floor(Date.now() / 1000) + 1);
    // Problem+Json detail: the limit and the seconds until reset.
    expect(err!.detail).toEqual({ limit: 2, retryAfterSeconds: retryAfter });
  });

  test("every further request in the window stays denied", async () => {
    const mw = rateLimit({ windowMs: WINDOW_MS, max: 1 });
    await mw(makeReq("/"), okNext);
    for (let i = 0; i < 3; i++) {
      await expect(mw(makeReq("/"), okNext)).rejects.toMatchObject({ status: 429 });
    }
  });
});

describe("rateLimit middleware · key derivation", () => {
  test("default key is the socket ip (req.ip); different ips are isolated", async () => {
    const mw = rateLimit({ windowMs: WINDOW_MS, max: 1 });
    await mw(makeReq("/", {}, "1.2.3.4"), okNext);
    const other = await mw(makeReq("/", {}, "5.6.7.8"), okNext);
    expect(other.status).toBe(200);
    expect(other.headers.get("x-rate-limit-remaining")).toBe("0");
    await expect(mw(makeReq("/", {}, "1.2.3.4"), okNext)).rejects.toMatchObject({ status: 429 });
  });

  test("spoofed x-forwarded-for is NOT trusted by default: same socket ip shares one budget", async () => {
    const mw = rateLimit({ windowMs: WINDOW_MS, max: 1 });
    await mw(makeReq("/", { headers: { "x-forwarded-for": "1.2.3.4" } }, "9.9.9.9"), okNext);
    // A different spoofed header must not create a fresh bucket for the same peer.
    await expect(
      mw(makeReq("/", { headers: { "x-forwarded-for": "5.6.7.8" } }, "9.9.9.9"), okNext),
    ).rejects.toMatchObject({ status: 429 });
  });

  test("without a socket ip (direct dispatch in tests) requests share the anonymous key", async () => {
    const mw = rateLimit({ windowMs: WINDOW_MS, max: 1 });
    await mw(makeReq("/", { headers: { "x-forwarded-for": "1.2.3.4" } }), okNext);
    await expect(mw(makeReq("/"), okNext)).rejects.toMatchObject({ status: 429 });
  });

  test("leftmost x-forwarded-for entry wins when trustProxy is set", async () => {
    const mw = rateLimit({ windowMs: WINDOW_MS, max: 1, trustProxy: true });
    await mw(makeReq("/", { headers: { "x-forwarded-for": "1.2.3.4, 9.9.9.9" } }), okNext);
    await expect(
      mw(makeReq("/", { headers: { "x-forwarded-for": "1.2.3.4, 8.8.8.8" } }), okNext),
    ).rejects.toMatchObject({ status: 429 });
  });

  test("trustProxy prefers x-forwarded-for over the socket ip", async () => {
    const mw = rateLimit({ windowMs: WINDOW_MS, max: 1, trustProxy: true });
    await mw(makeReq("/", { headers: { "x-forwarded-for": "1.2.3.4" } }, "9.9.9.9"), okNext);
    await expect(
      mw(makeReq("/", { headers: { "x-forwarded-for": "1.2.3.4" } }, "8.8.8.8"), okNext),
    ).rejects.toMatchObject({ status: 429 });
  });

  test("honors a custom keyBy", async () => {
    const mw = rateLimit({
      windowMs: WINDOW_MS,
      max: 1,
      keyBy: (req) => req.headers.get("x-api-key") ?? "no-key",
    });
    await mw(makeReq("/", { headers: { "x-api-key": "a" } }), okNext);
    const other = await mw(makeReq("/", { headers: { "x-api-key": "b" } }), okNext);
    expect(other.status).toBe(200);
    await expect(mw(makeReq("/", { headers: { "x-api-key": "a" } }), okNext)).rejects.toMatchObject(
      { status: 429 },
    );
  });
});

describe("rateLimit middleware · integration through core", () => {
  function makeApp(max: number): TestApp {
    const app = createTestApp();
    app.use(rateLimit({ windowMs: WINDOW_MS, max }));
    app.get("/", async () => Response.json({ ok: true }));
    return app;
  }

  test("429 becomes an RFC 9457 Problem+Json response with Retry-After and rate-limit headers", async () => {
    const app = makeApp(2);
    expect((await app.request("/")).status).toBe(200);
    expect((await app.request("/")).status).toBe(200);
    const res = await app.request("/");
    expect(res.status).toBe(429);
    expect(res.headers.get("content-type")).toBe("application/problem+json; charset=utf-8");
    expect(res.headers.get("retry-after")).toMatch(/^\d+$/);
    expect(res.headers.get("x-rate-limit-limit")).toBe("2");
    expect(res.headers.get("x-rate-limit-remaining")).toBe("0");
    const body = (await res.json()) as {
      type: string;
      status: number;
      title: string;
      instance: string;
      detail: { limit: number; retryAfterSeconds: number };
    };
    expect(body.type).toBe("https://errors.zebra.dev/rate_limit_exceeded");
    expect(body.status).toBe(429);
    expect(body.title).toBe("Too Many Requests");
    expect(body.instance).toBe("/");
    expect(body.detail.limit).toBe(2);
    expect(body.detail.retryAfterSeconds).toBe(Number(res.headers.get("retry-after")));
  });
});
