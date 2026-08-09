import { describe, expect, expectTypeOf, test } from "bun:test";
import type { SessionStore } from "@zebra/session";

import { RedisSessionStore } from "../src/index.ts";
import type { RedisLike } from "../src/redis-like.ts";
import { FakeRedis } from "./fake-redis.ts";

const TTL = 60_000;
const PREFIX = "test:session:";

function makeStore(ttl = TTL, prefix = PREFIX): { store: RedisSessionStore; redis: FakeRedis } {
  const redis = new FakeRedis();
  const store = new RedisSessionStore(redis, { ttl, prefix });
  return { store, redis };
}

test("contract: any implementation is assignable", () => {
  const { store } = makeStore();
  expectTypeOf<RedisSessionStore>().toMatchTypeOf<SessionStore>();
  expectTypeOf<FakeRedis>().toMatchTypeOf<RedisLike>();
});

describe("RedisSessionStore", () => {
  test("set/get round trip preserves all serializable values", async () => {
    const { store } = makeStore();
    await store.set("a", { visits: 1, user: "alice" });
    expect(await store.get("a")).toEqual({ visits: 1, user: "alice" });

    await store.set("zero", 0);
    expect(await store.get("zero")).toBe(0);
    await store.set("empty", "");
    expect(await store.get("empty")).toBe("");
    await store.set("false", false);
    expect(await store.get("false")).toBe(false);
    await store.set("null", null);
    expect(await store.get("null")).toBeNull();

    expect(await store.get("missing")).toBeUndefined();

    await store.set("a", "overwritten");
    expect(await store.get("a")).toBe("overwritten");
  });

  test("data is stored under the configured prefix and expired by Redis TTL", async () => {
    const { store, redis } = makeStore(50);
    await store.set("s", { v: 1 });
    expect(redis.values.size).toBe(1); // one data key, no tombstone yet
    expect(redis.expiresAt.has(`${PREFIX}s`)).toBe(true);
    expect(await redis.get(`${PREFIX}s`)).toBe('{"v":1}');

    redis.now += 60; // past the 50ms TTL → the data key itself is gone
    expect(await store.get("s")).toBeUndefined();
  });

  test("touch renews the expiry with the store default ttl", async () => {
    const { store, redis } = makeStore(80);
    await store.set("s", 1);
    redis.now += 40;
    expect(await store.get("s")).toBe(1);
    await store.touch("s");
    redis.now += 40;
    expect(await store.get("s")).toBe(1);
  });

  test("touch accepts a per-call ttl override", async () => {
    const { store, redis } = makeStore(50);
    await store.set("s", 1);
    await store.touch("s", 200);
    redis.now += 100;
    expect(await store.get("s")).toBe(1);
    redis.now += 150;
    expect(await store.get("s")).toBeUndefined();
  });

  test("touch on a missing or expired session is a no-op", async () => {
    const { store, redis } = makeStore(50);
    await store.touch("never-set");
    await store.set("s", 1);
    redis.now += 80;
    await store.touch("s");
    expect(await store.get("s")).toBeUndefined();
  });

  test("destroy tombstones the id: get/set/touch cannot revive it", async () => {
    const { store, redis } = makeStore(200);
    await store.set("s", { v: 1 });
    await store.destroy("s");

    expect(await store.get("s")).toBeUndefined();
    await store.touch("s");
    expect(await store.get("s")).toBeUndefined();
    // An in-flight request that read the record before the destroy must not
    // resurrect it (anti-session-fixation, mirrors MemoryStore).
    await store.set("s", { v: 2 });
    expect(await store.get("s")).toBeUndefined();
    // The tombstone marker sits under its own key with the store TTL.
    expect(await redis.get(`${PREFIX}s:tomb`)).toBe("1");
  });

  test("a destroyed id is reusable once the tombstone expires", async () => {
    const { store, redis } = makeStore(50);
    await store.set("s", 1);
    await store.destroy("s");
    expect(await store.get("s")).toBeUndefined();
    redis.now += 60; // past the tombstone TTL
    await store.set("s", 2);
    expect(await store.get("s")).toBe(2);
  });

  test("stores with different prefixes are isolated", async () => {
    const redis = new FakeRedis();
    const a = new RedisSessionStore(redis, { ttl: TTL, prefix: "a:" });
    const b = new RedisSessionStore(redis, { ttl: TTL, prefix: "b:" });
    await a.set("s", "for-a");
    await b.set("s", "for-b");
    expect(await a.get("s")).toBe("for-a");
    expect(await b.get("s")).toBe("for-b");
    await b.destroy("s");
    expect(await a.get("s")).toBe("for-a");
  });

  test("a corrupt payload reads as missing rather than throwing", async () => {
    const { store, redis } = makeStore();
    redis.seed(`${PREFIX}corrupt`, "{not json");
    expect(await store.get("corrupt")).toBeUndefined();
  });

  test("network errors propagate (fail closed, no silent success)", async () => {
    const { store, redis } = makeStore();

    redis.fail("get");
    await expect(store.get("s")).rejects.toThrow(/simulated network error/);
    // set's tombstone check is a get too — same failure surface.
    await expect(store.set("s", 1)).rejects.toThrow(/simulated network error/);
    redis.recover("get");

    redis.fail("pexpire");
    await expect(store.touch("s")).rejects.toThrow(/simulated network error/);
    redis.recover("pexpire");

    redis.fail("del");
    await expect(store.destroy("s")).rejects.toThrow(/simulated network error/);
  });
});
