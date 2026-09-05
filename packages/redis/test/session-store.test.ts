import { describe, expect, expectTypeOf, spyOn, test } from "bun:test";
import type { SessionStore } from "@zebra-web/session";

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

function recordCommands(redis: FakeRedis) {
  return [
    spyOn(redis, "get"),
    spyOn(redis, "set"),
    spyOn(redis, "incr"),
    spyOn(redis, "del"),
    spyOn(redis, "pexpire"),
  ];
}

test("contract: any implementation is assignable", () => {
  makeStore();
  expectTypeOf<RedisSessionStore>().toMatchTypeOf<SessionStore>();
  expectTypeOf<FakeRedis>().toMatchTypeOf<RedisLike>();
});

describe("RedisSessionStore", () => {
  test.each([Number.NaN, Number.POSITIVE_INFINITY, Number.NEGATIVE_INFINITY])(
    "rejects constructor ttl %s without Redis I/O",
    (ttl) => {
      const redis = new FakeRedis();
      const commands = recordCommands(redis);
      try {
        expect(() => new RedisSessionStore(redis, { ttl })).toThrow(TypeError);
        expect(() => new RedisSessionStore(redis, { ttl })).toThrow(/\bttl\b/);
        for (const command of commands) expect(command).not.toHaveBeenCalled();
      } finally {
        for (const command of commands) command.mockRestore();
      }
    },
  );

  test.each([0, -1, 0.5, Number.MAX_VALUE, -Number.MAX_VALUE])(
    "accepts finite constructor ttl %s",
    (ttl) => {
      expect(makeStore(ttl).store).toBeInstanceOf(RedisSessionStore);
    },
  );

  test.each([Number.NaN, Number.POSITIVE_INFINITY, Number.NEGATIVE_INFINITY])(
    "rejects touch ttl %s without Redis I/O or changing records",
    async (ttl) => {
      const { store, redis } = makeStore(100);
      const commands = recordCommands(redis);
      try {
        redis.now = 0;
        await store.set("expired", "old");
        redis.now = 50;
        await store.set("live", { visits: 1 });
        await store.destroy("destroyed");
        redis.now = 100;
        const calls = structuredClone(commands.map((command) => command.mock.calls));
        const values = new Map(redis.values);
        const expiresAt = new Map(redis.expiresAt);
        for (const id of ["live", "expired", "destroyed", "missing"]) {
          const result = store.touch(id, ttl);
          await expect(result).rejects.toBeInstanceOf(TypeError);
          await expect(result).rejects.toThrow(/\bttl\b/);
        }
        expect(commands.map((command) => command.mock.calls)).toEqual(calls);
        expect(redis.values).toEqual(values);
        expect(redis.expiresAt).toEqual(expiresAt);
        redis.now = 149;
        expect(await store.get("live")).toEqual({ visits: 1 });
        await store.set("destroyed", "blocked");
        expect(await store.get("destroyed")).toBeUndefined();
        redis.now = 150;
        expect(await store.get("live")).toBeUndefined();
        await store.set("destroyed", "reused");
        expect(await store.get("destroyed")).toBe("reused");
      } finally {
        for (const command of commands) command.mockRestore();
      }
    },
  );

  test.each([0, -0, -1, -0.5, -Number.MAX_VALUE])(
    "touch ttl %s expires immediately without tombstoning the id",
    async (ttl) => {
      const { store } = makeStore();
      await store.set("s", "old");
      await store.touch("s", ttl);
      expect(await store.get("s")).toBeUndefined();
      await store.set("s", "new");
      expect(await store.get("s")).toBe("new");
    },
  );

  test("finite fractional ttl values are passed to Redis unchanged", async () => {
    const { store, redis } = makeStore(0.5);
    redis.now = 0;
    await store.set("s", 1);
    expect(redis.expiresAt.get(`${PREFIX}s`)).toBe(0.5);
    await store.touch("s", 1.5);
    expect(redis.expiresAt.get(`${PREFIX}s`)).toBe(1.5);
  });

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
