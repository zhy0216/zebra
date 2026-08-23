import { describe, expect, expectTypeOf, test } from "bun:test";
import type { RateLimitStore } from "@zebra-web/rate-limit";

import { RedisRateLimitStore } from "../src/index.ts";
import type { RedisLike } from "../src/redis-like.ts";
import { FakeRedis } from "./fake-redis.ts";

const WINDOW_MS = 60_000;
const PREFIX = "test:rl:";

function makeStore(prefix = PREFIX): { store: RedisRateLimitStore; redis: FakeRedis } {
  const redis = new FakeRedis();
  // The store's clock reads the fake client's clock, so advancing `redis.now`
  // ages both the PX expiries and the window-start values deterministically.
  const store = new RedisRateLimitStore(redis, { prefix, now: () => redis.now });
  return { store, redis };
}

test("contract: any implementation is assignable", () => {
  makeStore();
  expectTypeOf<RedisRateLimitStore>().toMatchTypeOf<RateLimitStore>();
  expectTypeOf<FakeRedis>().toMatchTypeOf<RedisLike>();
});

describe("RedisRateLimitStore", () => {
  test("first increment opens a window with count 1, later ones count up with a stable resetAt", async () => {
    const { store, redis } = makeStore();
    const first = await store.increment("a", WINDOW_MS);
    expect(first.count).toBe(1);
    expect(first.resetAt).toBeGreaterThanOrEqual(redis.now);
    expect(first.resetAt).toBeLessThanOrEqual(redis.now + WINDOW_MS);

    const second = await store.increment("a", WINDOW_MS);
    expect(second.count).toBe(2);
    expect(second.resetAt).toBe(first.resetAt);

    // Keys are isolated.
    const other = await store.increment("b", WINDOW_MS);
    expect(other.count).toBe(1);
  });

  test("concurrent increments never lose a count and agree on resetAt", async () => {
    const { store } = makeStore();
    const N = 50;
    const results = await Promise.all(
      Array.from({ length: N }, () => store.increment("k", WINDOW_MS)),
    );
    expect(results[N - 1]!.count).toBe(N);
    // Every request saw the same window.
    expect(new Set(results.map((r) => r.resetAt)).size).toBe(1);
  });

  test("an expired window is lazily replaced by a fresh one", async () => {
    const { store, redis } = makeStore();
    const first = await store.increment("k", 100);
    redis.now += 120;
    const fresh = await store.increment("k", 100);
    expect(fresh.count).toBe(1);
    expect(fresh.resetAt).toBeGreaterThan(first.resetAt);
  });

  test("reset drops the counter; the next increment opens a fresh window", async () => {
    const { store } = makeStore();
    await store.increment("k", WINDOW_MS);
    await store.increment("k", WINDOW_MS);
    await store.reset("k");
    const fresh = await store.increment("k", WINDOW_MS);
    expect(fresh.count).toBe(1);
  });

  test("reset removes the counter and start keys", async () => {
    const { store, redis } = makeStore();
    await store.increment("k", WINDOW_MS);
    expect(await redis.get(`${PREFIX}k:start`)).not.toBeNull();
    await store.reset("k");
    expect(await redis.get(`${PREFIX}k`)).toBeNull();
    expect(await redis.get(`${PREFIX}k:start`)).toBeNull();
  });

  test("stores with different prefixes are isolated", async () => {
    const redis = new FakeRedis();
    const a = new RedisRateLimitStore(redis, { prefix: "a:" });
    const b = new RedisRateLimitStore(redis, { prefix: "b:" });
    await a.increment("k", WINDOW_MS);
    await a.increment("k", WINDOW_MS);
    const other = await b.increment("k", WINDOW_MS);
    expect(other.count).toBe(1);
  });

  test("network errors propagate (fail closed, no silent success)", async () => {
    const { store, redis } = makeStore();

    redis.fail("set");
    await expect(store.increment("k", WINDOW_MS)).rejects.toThrow(/simulated network error/);
    redis.recover("set");

    // Seed a live window, then break the INCR path used by follow-up requests.
    await store.increment("k", WINDOW_MS);
    redis.fail("incr");
    await expect(store.increment("k", WINDOW_MS)).rejects.toThrow(/simulated network error/);
    redis.recover("incr");

    redis.fail("del");
    await expect(store.reset("k")).rejects.toThrow(/simulated network error/);
  });

  test("resetAt never comes back NaN across window rotations", async () => {
    const { store, redis } = makeStore();
    const results: number[] = [];
    // Each call advances halfway through the window, so the start/count keys
    // rotate twice over the loop and the mid-flight re-claim path is hit.
    for (let i = 0; i < 5; i++) {
      results.push((await store.increment("k", 10)).resetAt);
      redis.now += 5;
    }
    for (const resetAt of results) {
      // resetAt may reference the window that opened two rotations ago, but
      // never NaN and never further ahead than the current window's end.
      expect(resetAt).not.toBeNaN();
      expect(resetAt).toBeGreaterThan(redis.now - 20);
      expect(resetAt).toBeLessThanOrEqual(redis.now + 10);
    }
  });
});
