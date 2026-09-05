import { describe, expect, expectTypeOf, spyOn, test } from "bun:test";
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

test("contract holds for MemoryStore", () =>
  assertStoreContract(new MemoryStore({ windowMs: 60_000 })));

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

  for (const source of ["per-call", "constructor default"] as const) {
    test.each([Number.NaN, Number.POSITIVE_INFINITY, Number.NEGATIVE_INFINITY, 0, -1])(
      `rejects ${source} windowMs %s without changing or sweeping buckets`,
      async (windowMs) => {
        let now = 0;
        const clock = spyOn(Date, "now").mockImplementation(() => now);
        const store = new MemoryStore({
          windowMs: source === "constructor default" ? windowMs : 1_000,
        });
        const buckets = (store as unknown as { buckets: Map<string, IncrementResult> }).buckets;
        try {
          await store.increment("expired", 1);
          await store.increment("active", 1_000);
          const before = [...buckets].map<[string, IncrementResult]>(([key, entry]) => [
            key,
            { ...entry },
          ]);
          now = 5;
          for (const key of ["new", "active"]) {
            await expect(
              store.increment(key, source === "per-call" ? windowMs : undefined),
            ).rejects.toThrow(/windowMs/);
            expect([...buckets]).toEqual(before);
          }
        } finally {
          clock.mockRestore();
        }
      },
    );
  }

  test("accepts positive fractional default and per-call windows", async () => {
    let now = 1_000;
    const clock = spyOn(Date, "now").mockImplementation(() => now);
    const store = new MemoryStore({ windowMs: 0.5 });
    try {
      expect(await store.increment("default")).toEqual({ count: 1, resetAt: 1_000.5 });
      expect(await store.increment("override", 1.25)).toEqual({ count: 1, resetAt: 1_001.25 });
      now = 1_000.5;
      expect(await store.increment("default")).toEqual({ count: 1, resetAt: 1_001 });
      expect(await store.increment("override", 1.25)).toEqual({ count: 2, resetAt: 1_001.25 });
    } finally {
      clock.mockRestore();
    }
  });

  test("expired buckets are swept so the map cannot grow without limit", async () => {
    const store = new MemoryStore({ windowMs: 60_000 });
    await store.increment("a", 10);
    await store.increment("b", 10);
    await Bun.sleep(15);
    // The sweep on this increment drops the two expired buckets above.
    await store.increment("c", 10);
    const buckets = (store as unknown as { buckets: Map<string, unknown> }).buckets;
    expect(buckets.size).toBe(1);
    expect(buckets.has("c")).toBe(true);
  });

  test("bounded sweeps reach expired tails behind 512 live counters", async () => {
    let now = 0;
    const clock = spyOn(Date, "now").mockImplementation(() => now);
    const store = new MemoryStore({ windowMs: 100 });
    const buckets = (store as unknown as { buckets: Map<string, { resetAt: number }> }).buckets;
    try {
      for (let i = 0; i < 512; i++) await store.increment(`live${i}`, 10_000);
      for (let i = 0; i < 1200; i++) await store.increment(`expired${i}`);
      expect(buckets.size).toBe(1712);
      let inspected = 0;
      for (const bucket of buckets.values()) {
        const resetAt = bucket.resetAt;
        Object.defineProperty(bucket, "resetAt", {
          get() {
            inspected++;
            return resetAt;
          },
        });
      }
      now = 100;
      const calls = Math.ceil(buckets.size / 512) + 1;
      for (let i = 0; i < calls; i++) {
        inspected = 0;
        expect(await store.increment("live0")).toEqual({ count: i + 2, resetAt: 10_000 });
        // The target check and returned resetAt account for two reads in
        // addition to the sweep's maximum 512 entry inspections.
        expect(inspected).toBeLessThanOrEqual(514);
      }
      expect(buckets.size).toBe(512);
      expect([...buckets.keys()].every((key) => key.startsWith("live"))).toBe(true);
    } finally {
      clock.mockRestore();
    }
  });

  test("sweeps survive resets, reinsertion, wraparound and regrowth after an empty map", async () => {
    let now = 0;
    const clock = spyOn(Date, "now").mockImplementation(() => now);
    const store = new MemoryStore({ windowMs: 100 });
    const buckets = (store as unknown as { buckets: Map<string, unknown> }).buckets;
    try {
      for (let i = 0; i < 1200; i++) await store.increment(`live${i}`, 10_000);
      for (let i = 0; i < 600; i++) await store.increment(`expired${i}`);
      now = 100;
      for (let i = 0; i < 8; i++) {
        await store.reset(`live${i}`);
        await store.reset(`expired${i * 70}`);
        expect((await store.increment(`live${i}`, 100)).count).toBe(1);
        await store.increment(`new${i}`, 100);
      }
      expect([...buckets.keys()].some((key) => key.startsWith("expired"))).toBe(false);
      now = 200;
      for (let i = 0; i < 5; i++) await store.increment("live100");
      expect(buckets.size).toBe(1200 - 8);
      expect([...buckets.keys()].every((key) => key.startsWith("live"))).toBe(true);

      for (const key of [...buckets.keys()]) await store.reset(key);
      expect(buckets.size).toBe(0);
      expect(await store.increment("regrown")).toEqual({ count: 1, resetAt: 300 });
      now = 300;
      expect(await store.increment("fresh")).toEqual({ count: 1, resetAt: 400 });
      expect([...buckets.keys()]).toEqual(["fresh"]);
    } finally {
      clock.mockRestore();
    }
  });

  test("increment without any windowMs rejects", async () => {
    const store = new MemoryStore();
    await expect(store.increment("k")).rejects.toThrow(/windowMs/);
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
