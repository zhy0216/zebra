import { describe, expect, expectTypeOf, test } from "bun:test";
import { MemoryStore } from "../src/store.ts";
import type { IncrementResult, RateLimitStore } from "../src/store.ts";

/** Minimal backend with an injectable clock — proves the contract is not memory-store shaped. */
class FakeStore implements RateLimitStore {
  now = 0;

  private counters = new Map<string, { count: number; resetAt: number }>();

  async increment(key: string, windowMs: number): Promise<IncrementResult> {
    const entry = this.counters.get(key);
    if (entry === undefined || this.now >= entry.resetAt) {
      const fresh = { count: 1, resetAt: this.now + windowMs };
      this.counters.set(key, fresh);
      return fresh;
    }
    entry.count += 1;
    return entry;
  }

  async reset(key: string): Promise<void> {
    this.counters.delete(key);
  }
}

/** Behavioral contract shared by every RateLimitStore implementation. */
async function assertStoreContract(store: RateLimitStore): Promise<void> {
  const first = await store.increment("a", 60_000);
  expect(first.count).toBe(1);
  expect(first.resetAt).toBeGreaterThan(Date.now());

  // A second increment in the same window counts up but keeps the reset time.
  const second = await store.increment("a", 60_000);
  expect(second.count).toBe(2);
  expect(second.resetAt).toBe(first.resetAt);

  // Keys are isolated.
  const other = await store.increment("b", 60_000);
  expect(other.count).toBe(1);

  // reset drops the counter; the next increment opens a fresh window.
  await store.reset("a");
  const afterReset = await store.increment("a", 60_000);
  expect(afterReset.count).toBe(1);
  expect(afterReset.resetAt).toBeGreaterThanOrEqual(first.resetAt);
}

test("contract holds for MemoryStore", () => assertStoreContract(new MemoryStore({ windowMs: 60_000 })));

test("contract holds for an unrelated fake implementation", () => {
  const store = new FakeStore();
  store.now = Date.now();
  return assertStoreContract(store);
});

describe("MemoryStore", () => {
  test("increment counts up inside the window, keeping the reset time", async () => {
    const store = new MemoryStore({ windowMs: 60_000 });
    const first = await store.increment("k");
    expect(first).toEqual({ count: 1, resetAt: expect.any(Number) });
    expect(first.resetAt - Date.now()).toBeLessThanOrEqual(60_000);
    const second = await store.increment("k");
    expect(second.count).toBe(2);
    expect(second.resetAt).toBe(first.resetAt);
    const third = await store.increment("k");
    expect(third.count).toBe(3);
    expect(third.resetAt).toBe(first.resetAt);
  });

  test("an expired window is lazily replaced by a fresh one", async () => {
    const store = new MemoryStore({ windowMs: 50 });
    await store.increment("k");
    const expiredResetAt = (await store.increment("k")).resetAt;
    await Bun.sleep(80);
    const fresh = await store.increment("k");
    expect(fresh.count).toBe(1);
    expect(fresh.resetAt).toBeGreaterThan(expiredResetAt);
  });

  test("reset drops the counter; the next increment opens a fresh window", async () => {
    const store = new MemoryStore({ windowMs: 60_000 });
    await store.increment("k");
    await store.increment("k");
    await store.reset("k");
    const fresh = await store.increment("k");
    expect(fresh.count).toBe(1);
  });

  test("a per-call windowMs overrides the constructor default", async () => {
    const store = new MemoryStore({ windowMs: 1_000 });
    const short = await store.increment("k", 50);
    const long = await store.increment("k2");
    // The per-call window (50ms) wins over the constructor default (1s):
    // "long" expires roughly 950ms after "short".
    expect(long.resetAt - short.resetAt).toBeGreaterThan(900);
    expect(long.resetAt - short.resetAt).toBeLessThan(1_000);
  });

  test("increment without any windowMs rejects", async () => {
    const store = new MemoryStore();
    expect(store.increment("k")).rejects.toThrow(/windowMs/);
  });
});

describe("RateLimitStore interface", () => {
  test("any implementation is assignable", () => {
    const store: RateLimitStore = new FakeStore();
    const memory: RateLimitStore = new MemoryStore({ windowMs: 1000 });
    expectTypeOf<FakeStore>().toMatchTypeOf<RateLimitStore>();
    expectTypeOf<MemoryStore>().toMatchTypeOf<RateLimitStore>();
    expectTypeOf(store.increment("x", 1000)).resolves.toEqualTypeOf<IncrementResult>();
    expectTypeOf(store.reset("x")).resolves.toBeVoid();
    expectTypeOf(memory.increment("x", 1000)).resolves.toMatchTypeOf<{
      count: number;
      resetAt: number;
    }>();
  });
});
