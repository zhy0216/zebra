// C5: end-to-end integration tests through `createTestApp` (full
// prepare/boot + dispatch + core's error middleware), on top of the unit
// suites in store/limiter/middleware.test.ts. The store contract is already
// pinned by `assertStoreContract` in store.test.ts (run against MemoryStore
// and an unrelated fake); these tests exercise the middleware through the
// real pipeline and assert the wire contract end-to-end:
// - the (max+1)-th request in a window is a 429 with an RFC 9457
//   Problem+Json body and the rate-limit headers
// - after the window slides (real time, short MemoryStore window) the key
//   recovers and counts from a fresh window
// - with `trustProxy` different x-forwarded-for values get isolated budgets;
//   without it (the default) a spoofed header does NOT create per-IP buckets
// - Limit/Remaining/Reset header values are correct, with Reset derived from
//   the store's resetAt (epoch seconds)
// - the 429 carries a plausible Retry-After
//
// Header values are asserted against a recording store: it behaves like a
// fixed-window counter but keeps the `IncrementResult` it returned per key,
// so the tests can check that the headers were derived from exactly those
// numbers, not from any independent bookkeeping.

import { describe, expect, test } from "bun:test";
import { type TestApp, createTestApp } from "@zebra-web/testing";

import { type RateLimitOptions, rateLimit } from "../src/index.ts";
import type { IncrementResult, RateLimitStore } from "../src/store.ts";

const WINDOW_MS = 60_000;

/** Fixed-window `RateLimitStore` that records the last increment per key. */
class RecordingStore implements RateLimitStore {
  private readonly buckets = new Map<string, { count: number; resetAt: number }>();
  private readonly last = new Map<string, IncrementResult>();

  lastIncrement(key: string): IncrementResult {
    return this.last.get(key)!;
  }

  async increment(key: string, windowMs: number): Promise<IncrementResult> {
    const entry = this.buckets.get(key);
    let result: IncrementResult;
    if (entry === undefined || Date.now() >= entry.resetAt) {
      result = { count: 1, resetAt: Date.now() + windowMs };
    } else {
      result = { count: entry.count + 1, resetAt: entry.resetAt };
    }
    this.buckets.set(key, { count: result.count, resetAt: result.resetAt });
    this.last.set(key, result);
    return result;
  }

  async reset(key: string): Promise<void> {
    this.buckets.delete(key);
    this.last.delete(key);
  }
}

function makeApp(opts: {
  windowMs: number;
  max: number;
  store?: RateLimitStore;
  trustProxy?: boolean;
}): TestApp {
  const app = createTestApp();
  const rlOptions: RateLimitOptions = {
    windowMs: opts.windowMs,
    max: opts.max,
    trustProxy: opts.trustProxy ?? true,
    ...(opts.store === undefined ? {} : { store: opts.store }),
  };
  app.use(rateLimit(rlOptions));
  app.get("/", async () => Response.json({ ok: true }));
  return app;
}

const CLIENT_A = { headers: { "x-forwarded-for": "1.2.3.4" } };
const CLIENT_B = { headers: { "x-forwarded-for": "5.6.7.8" } };

describe("rateLimit integration · enforcement", () => {
  test("the (max+1)-th request in the window is a 429 Problem+Json response", async () => {
    const app = makeApp({ windowMs: WINDOW_MS, max: 2 });

    expect((await app.request("/", CLIENT_A)).status).toBe(200);
    expect((await app.request("/", CLIENT_A)).status).toBe(200);
    const res = await app.request("/", CLIENT_A);
    expect(res.status).toBe(429);
    expect(res.headers.get("content-type")).toBe("application/problem+json; charset=utf-8");

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

  test("once the window slides (MemoryStore, real time) the key recovers with a fresh window", async () => {
    // 50ms window, 100ms sleep: 2x the window, same margin as the session
    // suite's TTL tests — fast and stable under CI load.
    const app = makeApp({ windowMs: 50, max: 1 });

    expect((await app.request("/")).status).toBe(200);
    const blocked = await app.request("/");
    expect(blocked.status).toBe(429);
    expect(blocked.headers.get("retry-after")).toMatch(/^\d+$/);

    await Bun.sleep(100);

    const recovered = await app.request("/");
    expect(recovered.status).toBe(200);
    // Fresh window for max=1: the request is back under the limit, with the
    // single remaining slot consumed.
    expect(recovered.headers.get("x-rate-limit-limit")).toBe("1");
    expect(recovered.headers.get("x-rate-limit-remaining")).toBe("0");
  });

  test("different x-forwarded-for values are isolated (one client's budget does not leak)", async () => {
    const app = makeApp({ windowMs: WINDOW_MS, max: 1 });

    expect((await app.request("/", CLIENT_A)).status).toBe(200);
    expect((await app.request("/", CLIENT_A)).status).toBe(429);

    // Client B starts with its own untouched budget.
    const other = await app.request("/", CLIENT_B);
    expect(other.status).toBe(200);
    expect(other.headers.get("x-rate-limit-remaining")).toBe("0");
    // ...and is limited independently of A's exhaustion.
    expect((await app.request("/", CLIENT_B)).status).toBe(429);
    expect((await app.request("/", CLIENT_A)).status).toBe(429);
  });

  test("spoofed x-forwarded-for does NOT create per-IP buckets by default (trustProxy off)", async () => {
    const app = makeApp({ windowMs: WINDOW_MS, max: 1, trustProxy: false });

    expect((await app.request("/", CLIENT_A)).status).toBe(200);
    expect((await app.request("/", CLIENT_A)).status).toBe(429);

    // Client B spoofs a different XFF, but without trustProxy every request
    // shares one budget — B inherits A's exhaustion instead of a fresh bucket.
    const spoofed = await app.request("/", CLIENT_B);
    expect(spoofed.status).toBe(429);
    expect(spoofed.headers.get("x-rate-limit-remaining")).toBe("0");
  });
});

describe("rateLimit integration · headers", () => {
  test("Limit=max, Remaining=max-n, Reset is the store's resetAt in epoch seconds", async () => {
    const store = new RecordingStore();
    const app = makeApp({ windowMs: WINDOW_MS, max: 3, store });

    const first = await app.request("/", CLIENT_A);
    expect(first.status).toBe(200);
    expect(first.headers.get("x-rate-limit-limit")).toBe("3");
    expect(first.headers.get("x-rate-limit-remaining")).toBe("2");
    // Reset is exactly the window expiry the store reported, as epoch seconds.
    const resetAt = store.lastIncrement("1.2.3.4").resetAt;
    expect(first.headers.get("x-rate-limit-reset")).toBe(String(Math.floor(resetAt / 1000)));

    // A second request inside the same window counts down but keeps the reset.
    const second = await app.request("/", CLIENT_A);
    expect(second.status).toBe(200);
    expect(second.headers.get("x-rate-limit-limit")).toBe("3");
    expect(second.headers.get("x-rate-limit-remaining")).toBe("1");
    expect(second.headers.get("x-rate-limit-reset")).toBe(
      String(Math.floor(store.lastIncrement("1.2.3.4").resetAt / 1000)),
    );
    expect(second.headers.get("x-rate-limit-reset")).toBe(first.headers.get("x-rate-limit-reset"));
  });

  test("the 429 carries Retry-After ≈ seconds until the recorded window reset", async () => {
    const store = new RecordingStore();
    const app = makeApp({ windowMs: WINDOW_MS, max: 1, store });

    expect((await app.request("/", CLIENT_A)).status).toBe(200);
    const res = await app.request("/", CLIENT_A);
    expect(res.status).toBe(429);

    const retryAfter = Number(res.headers.get("retry-after"));
    expect(Number.isInteger(retryAfter)).toBe(true);
    expect(retryAfter).toBeGreaterThanOrEqual(1);
    expect(retryAfter).toBeLessThanOrEqual(WINDOW_MS / 1000);

    // Retry-After counts down to the same reset the store reported; allow ±1s
    // for the time that passes between the increment and this read.
    const resetAt = store.lastIncrement("1.2.3.4").resetAt;
    const expected = Math.max(1, Math.ceil((resetAt - Date.now()) / 1000));
    expect(Math.abs(retryAfter - expected)).toBeLessThanOrEqual(1);
    // The 429 also keeps the rate-limit state: limit and remaining 0.
    expect(res.headers.get("x-rate-limit-limit")).toBe("1");
    expect(res.headers.get("x-rate-limit-remaining")).toBe("0");
  });
});
