// C2 tests for the fixed-window limiter primitive (`src/limiter.ts`), run
// against a minimal in-memory store implementing the C4 `RateLimitStore`
// contract (the real MemoryStore must keep these same semantics: per-key
// counter, lazy window rotation on increment, and the read-modify-write done
// synchronously, without awaiting, before the promise resolves).

import { describe, expect, test } from "bun:test";

import { checkLimit, createLimiter } from "../src/limiter.ts";
import type { IncrementResult, RateLimitStore } from "../src/store.ts";

class FakeStore implements RateLimitStore {
  /** Injectable clock; tests move it forward to simulate elapsed time. */
  now = 0;

  private counters = new Map<string, { count: number; resetAt: number }>();

  async increment(key: string, windowMs: number): Promise<IncrementResult> {
    // Same atomicity discipline as the future MemoryStore: the read-modify-
    // write below runs synchronously, with no `await` before it, so on the
    // single-threaded event loop concurrent calls are serialized. A snapshot
    // (not the live entry) is returned, so consumers never observe later
    // mutations of the same object.
    const entry = this.counters.get(key);
    if (entry === undefined || this.now >= entry.resetAt) {
      const fresh = { count: 1, resetAt: this.now + windowMs };
      this.counters.set(key, fresh);
      return { ...fresh };
    }
    entry.count += 1;
    return { count: entry.count, resetAt: entry.resetAt };
  }

  async reset(key: string): Promise<void> {
    this.counters.delete(key);
  }
}

describe("checkLimit · fixed window", () => {
  test("counts requests within the window", async () => {
    const store = new FakeStore();
    const first = await checkLimit(store, "k", 10_000, 100);
    expect(first).toMatchObject({ allowed: true, count: 1, remaining: 99 });
    const second = await checkLimit(store, "k", 10_000, 100);
    expect(second).toMatchObject({ allowed: true, count: 2, remaining: 98 });
    expect(second.resetAt).toBe(first.resetAt);
  });

  test("rejects the (max+1)-th request in the window", async () => {
    const store = new FakeStore();
    expect((await checkLimit(store, "k", 10_000, 2)).allowed).toBe(true);
    expect((await checkLimit(store, "k", 10_000, 2)).allowed).toBe(true);
    const third = await checkLimit(store, "k", 10_000, 2);
    expect(third.allowed).toBe(false);
    expect(third.count).toBe(3);
    expect(third.remaining).toBe(0);
  });

  test("reports remaining floored at 0", async () => {
    const store = new FakeStore();
    for (let i = 0; i < 3; i++) {
      const r = await checkLimit(store, "k", 10_000, 3);
      expect(r.count).toBe(i + 1);
      expect(r.remaining).toBe(2 - i);
    }
    const fourth = await checkLimit(store, "k", 10_000, 3);
    expect(fourth.count).toBe(4);
    expect(fourth.remaining).toBe(0);
    expect(fourth.allowed).toBe(false);
  });

  test("keeps different keys isolated", async () => {
    const store = new FakeStore();
    for (let i = 0; i < 5; i++) await checkLimit(store, "a", 10_000, 3);
    const b = await checkLimit(store, "b", 10_000, 3);
    expect(b).toMatchObject({ allowed: true, count: 1, remaining: 2 });
    const a = await checkLimit(store, "a", 10_000, 3);
    expect(a.allowed).toBe(false);
    expect(a.count).toBe(6);
  });

  test("lazily opens a new window after expiry, never scheduling timers", async () => {
    const store = new FakeStore();
    const originalSetInterval = globalThis.setInterval;
    const originalSetTimeout = globalThis.setTimeout;
    let timerCalls = 0;
    globalThis.setInterval = (() => {
      timerCalls += 1;
      return 0 as unknown as ReturnType<typeof setInterval>;
    }) as typeof setInterval;
    globalThis.setTimeout = (() => {
      timerCalls += 1;
      return 0 as unknown as ReturnType<typeof setTimeout>;
    }) as unknown as typeof setTimeout;
    try {
      const first = await checkLimit(store, "k", 10_000, 2);
      expect(first.count).toBe(1);
      store.now = first.resetAt; // window boundary passed
      const r = await checkLimit(store, "k", 10_000, 2);
      expect(r.count).toBe(1); // fresh window, counter restarted
      expect(r.allowed).toBe(true);
      expect(r.resetAt).toBe(first.resetAt + 10_000);
      expect(timerCalls).toBe(0); // no background sweep, no per-key timer
    } finally {
      globalThis.setInterval = originalSetInterval;
      globalThis.setTimeout = originalSetTimeout;
    }
  });

  test("reset(key) starts a fresh window for that key", async () => {
    const store = new FakeStore();
    await checkLimit(store, "k", 10_000, 2);
    await checkLimit(store, "k", 10_000, 2);
    await store.reset("k");
    const r = await checkLimit(store, "k", 10_000, 2);
    expect(r).toMatchObject({ allowed: true, count: 1, remaining: 1 });
  });

  test("createLimiter binds the store", async () => {
    const store = new FakeStore();
    store.now = 5_000;
    const limiter = createLimiter(store);
    const r = await limiter.check("k", 10_000, 5);
    expect(r).toEqual({ allowed: true, count: 1, remaining: 4, resetAt: 15_000 });
  });

  test("rejects invalid windowMs or max", async () => {
    const store = new FakeStore();
    expect(checkLimit(store, "k", 0, 5)).rejects.toThrow();
    expect(checkLimit(store, "k", 10_000, 0)).rejects.toThrow();
  });
});

describe("checkLimit · atomicity", () => {
  test("concurrent checks on one key are serialized (no lost updates)", async () => {
    const store = new FakeStore();
    const results = await Promise.all(
      Array.from({ length: 5 }, () => checkLimit(store, "k", 10_000, 5)),
    );
    // Every request must observe a distinct in-window count: the increments
    // cannot interleave because each store.increment does its read-modify-
    // write in one synchronous segment on the single-threaded event loop.
    const counts = results.map((r) => r.count).sort((a, b) => a - b);
    expect(counts).toEqual([1, 2, 3, 4, 5]);
    expect(results.every((r) => r.allowed)).toBe(true);
    expect(results.every((r) => r.resetAt === results[0]!.resetAt)).toBe(true);
  });
});
