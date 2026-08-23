import { describe, expect, test } from "bun:test";
import { type ZebraRequest, buildRequest } from "@zebra-web/core";
import { createTestApp } from "@zebra-web/testing";

import { REQUEST_ID_KEY, errorReporter, requestId } from "../src/index.ts";

function makeReq(path = "/"): ZebraRequest {
  return buildRequest(new Request(`http://test.local${path}`), {});
}

describe("errorReporter middleware", () => {
  test("calls the reporter with the error, request and context, and rethrows the original", async () => {
    const boom = new Error("boom");
    let seenError: unknown;
    let seenInfo: { method: string; path: string; requestId: string | undefined } | undefined;
    const mw = errorReporter((error, _req, info) => {
      seenError = error;
      seenInfo = info;
    });
    const req = makeReq("/a");
    req.ctx.set(REQUEST_ID_KEY, "rid-9");
    await expect(mw(req, async () => Promise.reject(boom))).rejects.toBe(boom);
    expect(seenError).toBe(boom);
    expect(seenInfo).toMatchObject({ method: "GET", path: "/a", requestId: "rid-9" });
  });

  test("does not call the reporter on success", async () => {
    let called = false;
    const mw = errorReporter(() => {
      called = true;
    });
    const res = await mw(makeReq(), async () => new Response("ok", { status: 200 }));
    expect(res.status).toBe(200);
    expect(called).toBe(false);
  });

  test("a throwing reporter never masks the original error", async () => {
    const boom = new Error("boom");
    const mw = errorReporter(() => {
      throw new Error("reporter exploded");
    });
    await expect(mw(makeReq(), async () => Promise.reject(boom))).rejects.toBe(boom);
  });
});

describe("errorReporter middleware · integration through core", () => {
  test("handler throws yield Problem+Json 500 while the reporter sees error and request id", async () => {
    const seen: { error: unknown; requestId: string | undefined; path: string }[] = [];
    const app = createTestApp();
    app.use(requestId());
    app.use(
      errorReporter((error, _req, info) => {
        seen.push({ error, requestId: info.requestId, path: info.path });
      }),
    );
    app.get("/boom", () => {
      throw new Error("boom");
    });
    const res = await app.request("/boom");
    expect(res.status).toBe(500);
    expect(res.headers.get("content-type")).toBe("application/problem+json; charset=utf-8");
    expect(seen).toHaveLength(1);
    expect(seen[0]!.error).toBeInstanceOf(Error);
    expect(seen[0]!.path).toBe("/boom");
    expect(seen[0]!.requestId).toMatch(/^[0-9a-f-]{36}$/);
  });

  test("successful requests never reach the reporter", async () => {
    let called = false;
    const app = createTestApp();
    app.use(
      errorReporter(() => {
        called = true;
      }),
    );
    app.get("/", () => Response.json({ ok: true }));
    expect((await app.request("/")).status).toBe(200);
    expect(called).toBe(false);
  });
});
