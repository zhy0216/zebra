// End-to-end: the Redis-backed stores driving the real `@zebra/session` and
// `@zebra/rate-limit` middleware through `createTestApp` (full
// prepare/boot + dispatch + core's error middleware). No live Redis — the
// stores run on the `FakeRedis` client from fake-redis.ts, which honors the
// exact command semantics the stores issue.

import "reflect-metadata";
import { describe, expect, test } from "bun:test";
import { rateLimit } from "@zebra/rate-limit";
import { getSession, sessionMiddleware, verify } from "@zebra/session";
import { createTestApp, type TestApp } from "@zebra/testing";

import { RedisRateLimitStore, RedisSessionStore } from "../src/index.ts";
import { FakeRedis } from "./fake-redis.ts";

const SECRET = "test-secret";
const SESSION_TTL = 30_000;
const WINDOW_MS = 60_000;

function makeSessionApp(): {
  app: TestApp;
  mw: ReturnType<typeof sessionMiddleware>;
  redis: FakeRedis;
} {
  const redis = new FakeRedis();
  const store = new RedisSessionStore(redis, { ttl: SESSION_TTL, prefix: "e2e:session:" });
  const mw = sessionMiddleware({ secret: SECRET, cookie: { maxAge: 3600 }, store });
  const app = createTestApp({ session: { resolver: mw.resolver } });
  app.use(mw);
  app.post("/login", async (req) => {
    const s = getSession(req)!;
    await s.set("user", { id: 42 });
    return { ok: true };
  });
  app.get("/me", async (req) => {
    const s = getSession(req)!;
    return { sid: s.id, isNew: s.isNew, user: await s.get("user") };
  });
  return { app, mw, redis };
}

function extractCookie(res: Response): string {
  return res.headers.get("set-cookie")!.split(";")[0]!;
}

function sidOf(cookie: string): string {
  return verify(cookie.slice("sid=".length), SECRET)!;
}

describe("session middleware with RedisSessionStore", () => {
  test("write → readback round trip through the real pipeline", async () => {
    const { app } = makeSessionApp();

    const cookie = extractCookie(await app.request("/login", { method: "POST" }));
    const sid = sidOf(cookie);
    expect(sid).not.toBeNull();

    const body = (await (await app.request("/me", { headers: { cookie } })).json()) as {
      sid: string;
      isNew: boolean;
      user: { id: number } | undefined;
    };
    expect(body.sid).toBe(sid);
    expect(body.isNew).toBe(false);
    expect(body.user).toEqual({ id: 42 });
  });

  test("a destroyed session is not revived and the stale cookie gets a fresh sid", async () => {
    const { app, mw } = makeSessionApp();

    const cookie = extractCookie(await app.request("/login", { method: "POST" }));
    const sid = sidOf(cookie);
    expect(await mw.resolver(new Request("http://test.local/", { headers: { cookie } }))).toBe(sid);

    await mw.destroySession(sid);
    // Resolver agrees with the store: the destroyed id is anonymous again.
    expect(await mw.resolver(new Request("http://test.local/", { headers: { cookie } }))).toBeUndefined();

    const res = await app.request("/me", { headers: { cookie } });
    const body = (await res.json()) as { sid: string; isNew: boolean };
    expect(body.isNew).toBe(true);
    expect(body.sid).not.toBe(sid);
    expect(sidOf(extractCookie(res))).not.toBe(sid);
  });

  test("an expired session is treated as a new visitor (fake clock past TTL)", async () => {
    const { app, redis } = makeSessionApp();

    const cookie = extractCookie(await app.request("/login", { method: "POST" }));
    const sid = sidOf(cookie);

    redis.now += SESSION_TTL + 1_000;

    const res = await app.request("/me", { headers: { cookie } });
    const body = (await res.json()) as { sid: string; isNew: boolean };
    expect(body.isNew).toBe(true);
    expect(body.sid).not.toBe(sid);
  });

  test("a Redis failure fails the request closed (500 Problem+Json, nothing silently succeeds)", async () => {
    const { app, redis } = makeSessionApp();

    // Establish a valid signed cookie first, then cut the store off: the next
    // request must fail loudly (resolver → store.get) instead of silently
    // continuing without session state.
    const cookie = extractCookie(await app.request("/login", { method: "POST" }));
    redis.fail("get");

    const res = await app.request("/me", { headers: { cookie } });
    expect(res.status).toBe(500);
    expect(res.headers.get("content-type")).toBe("application/problem+json; charset=utf-8");

    // The persist path fails closed too: a fresh login cannot write.
    redis.recover("get");
    redis.fail("set");
    const login = await app.request("/login", { method: "POST" });
    expect(login.status).toBe(500);
  });
});

describe("rate limit middleware with RedisRateLimitStore", () => {
  function makeRateLimitApp(): {
    app: TestApp;
    redis: FakeRedis;
  } {
    const redis = new FakeRedis();
    const store = new RedisRateLimitStore(redis, { prefix: "e2e:rl:" });
    const app = createTestApp();
    app.use(
      rateLimit({
        windowMs: WINDOW_MS,
        max: 2,
        store,
        keyBy: () => "client",
      }),
    );
    app.get("/", () => ({ ok: true }));
    return { app, redis };
  }

  test("the (max+1)-th request is a 429 with headers derived from the Redis state", async () => {
    const { app, redis } = makeRateLimitApp();

    expect((await app.request("/")).status).toBe(200);
    expect((await app.request("/")).status).toBe(200);
    const res = await app.request("/");
    expect(res.status).toBe(429);
    expect(res.headers.get("content-type")).toBe("application/problem+json; charset=utf-8");
    expect(res.headers.get("x-rate-limit-limit")).toBe("2");
    expect(res.headers.get("x-rate-limit-remaining")).toBe("0");

    // Reset header is derived from the actual window start stored in Redis.
    const start = Number(await redis.get("e2e:rl:client:start"));
    expect(start).toBeGreaterThan(0);
    expect(res.headers.get("x-rate-limit-reset")).toBe(String(Math.floor((start + WINDOW_MS) / 1000)));
    expect(res.headers.get("retry-after")).toMatch(/^\d+$/);
  });

  test("the window slides: after Redis TTL expires the budget resets", async () => {
    const redis = new FakeRedis();
    const store = new RedisRateLimitStore(redis, { prefix: "e2e:rl:" });
    const app = createTestApp();
    app.use(
      rateLimit({
        windowMs: WINDOW_MS,
        max: 1,
        store,
        keyBy: () => "client",
      }),
    );
    app.get("/", () => ({ ok: true }));

    expect((await app.request("/")).status).toBe(200);
    expect((await app.request("/")).status).toBe(429);

    redis.now += WINDOW_MS + 1_000;

    const recovered = await app.request("/");
    expect(recovered.status).toBe(200);
    expect(recovered.headers.get("x-rate-limit-limit")).toBe("1");
    expect(recovered.headers.get("x-rate-limit-remaining")).toBe("0");
  });

  test("a Redis failure fails the request closed (500, rate limiting not bypassed)", async () => {
    const { app, redis } = makeRateLimitApp();

    // The first request claims the window via SET NX — seed a live window so
    // the next request takes the INCR path, then cut that path off.
    expect((await app.request("/")).status).toBe(200);
    redis.fail("incr");
    const res = await app.request("/");
    expect(res.status).toBe(500);
    expect(res.headers.get("content-type")).toBe("application/problem+json; charset=utf-8");
  });
});
