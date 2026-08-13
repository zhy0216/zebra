// C6: end-to-end integration tests through `createTestApp`.
//
// Covers the §8.3 `@zebra/session` use cases end-to-end:
// - HMAC-SHA256 signed cookies (tampering is rejected)
// - pluggable session store (a custom store backs the full flow)
// - session scope wiring (`session.resolver` provided by the middleware)
// - `req.ctx.session` read/write
// plus: write→readback, TTL expiry, injectSession resolution, and
// anonymous-session isolation.

import "reflect-metadata";
import { expect, test } from "bun:test";
import type { ZebraRequest } from "@zebra/core";
import { type TestApp, createTestApp } from "@zebra/testing";

import { MemoryStore, getSession, sessionMiddleware, verify } from "../src/index.ts";
import type { SessionStore } from "../src/store.ts";

const SECRET = "test-secret";

interface TestContext {
  app: TestApp;
  mw: ReturnType<typeof sessionMiddleware>;
  store: SessionStore;
}

function makeApp(store: SessionStore): TestContext {
  const mw = sessionMiddleware({ secret: SECRET, cookie: { maxAge: 3600 }, store });
  const app = createTestApp({ session: { resolver: mw.resolver } });
  app.use(mw);
  return { app, mw, store };
}

/** Extracts the raw `sid=...` cookie from a Set-Cookie header. */
function extractCookie(res: Response): string {
  return res.headers.get("set-cookie")!.split(";")[0]!;
}

/** Verifies the signed cookie value and returns the underlying session id. */
function sidOf(cookie: string): string {
  return verify(cookie.slice("sid=".length), SECRET)!;
}

/** Registers a login that stores `user` and a `/me` that reads it back. */
function registerSessionRoutes(app: TestApp): void {
  app.post("/login", async (req: ZebraRequest) => {
    const s = getSession(req)!;
    await s.set("user", { id: 42 });
    return { ok: true };
  });
  app.get("/me", async (req: ZebraRequest) => {
    const s = getSession(req)!;
    return { sid: s.id, isNew: s.isNew, user: await s.get("user") };
  });
}

interface MeBody {
  sid: string;
  isNew: boolean;
  user: { id: number } | undefined;
}

test("req.ctx.session read/write: Set-Cookie carries the sid and the next request reads the data back", async () => {
  const { app } = makeApp(new MemoryStore({ ttl: 30_000 }));
  registerSessionRoutes(app);

  const login = await app.request("/login", { method: "POST" });
  const cookie = extractCookie(login);
  expect(cookie.startsWith("sid=")).toBe(true);
  const sid = sidOf(cookie);
  expect(sid).not.toBeNull();

  const body = (await (await app.request("/me", { headers: { cookie } })).json()) as MeBody;
  expect(body.sid).toBe(sid);
  expect(body.isNew).toBe(false);
  expect(body.user).toEqual({ id: 42 });
});

test("HMAC-SHA256 signed cookie: a tampered signature is rejected (treated as a new visitor)", async () => {
  const { app } = makeApp(new MemoryStore({ ttl: 30_000 }));
  registerSessionRoutes(app);

  const cookie = extractCookie(await app.request("/login", { method: "POST" }));
  const sid = sidOf(cookie);

  // Flip the last character of the HMAC portion of the signed cookie.
  const [signedSid, sig] = cookie.slice("sid=".length).split(".");
  const tampered = `${signedSid}.${sig!.slice(0, -1)}${sig!.endsWith("A") ? "B" : "A"}`;

  const res = await app.request("/me", { headers: { cookie: `sid=${tampered}` } });
  const body = (await res.json()) as MeBody;
  expect(body.isNew).toBe(true);
  expect(body.user).toBeUndefined();
  expect(body.sid).not.toBe(sid);

  // The stale cookie was replaced with a fresh one rather than honored.
  expect(sidOf(extractCookie(res))).not.toBe(sid);
});

test("TTL expiry: an expired session is not revived — the old cookie gets a fresh sid", async () => {
  const store = new MemoryStore({ ttl: 30 });
  const { app } = makeApp(store);
  registerSessionRoutes(app);

  const cookie = extractCookie(await app.request("/login", { method: "POST" }));
  const sid = sidOf(cookie);
  expect(await store.get(sid)).toEqual({ user: { id: 42 } });

  await Bun.sleep(60);

  const res = await app.request("/me", { headers: { cookie } });
  const body = (await res.json()) as MeBody;
  expect(body.isNew).toBe(true);
  expect(body.sid).not.toBe(sid);
  expect(body.user).toBeUndefined();
  expect(await store.get(sid)).toBeUndefined();
  expect(sidOf(extractCookie(res))).not.toBe(sid);
});

/** In-memory `SessionStore` that records every call, to prove the store is the one backing the flow. */
class SpyStore implements SessionStore {
  readonly calls: string[] = [];
  private readonly entries = new Map<string, { data: unknown; expiresAt: number }>();
  private readonly ttl: number;

  constructor(ttl = 30_000) {
    this.ttl = ttl;
  }

  private log(op: string, id: string): void {
    this.calls.push(`${op}:${id}`);
  }

  async get(id: string): Promise<unknown | undefined> {
    this.log("get", id);
    const entry = this.entries.get(id);
    if (entry === undefined || Date.now() >= entry.expiresAt) return undefined;
    return entry.data;
  }

  async set(id: string, data: unknown): Promise<void> {
    this.log("set", id);
    this.entries.set(id, { data, expiresAt: Date.now() + this.ttl });
  }

  async touch(id: string, ttl?: number): Promise<void> {
    this.log("touch", id);
    const entry = this.entries.get(id);
    if (entry === undefined) return;
    entry.expiresAt = Date.now() + (ttl ?? this.ttl);
  }

  async destroy(id: string): Promise<void> {
    this.log("destroy", id);
    this.entries.delete(id);
  }
}

test("pluggable store: a custom SessionStore backs the full write→readback flow", async () => {
  const store = new SpyStore();
  const { app } = makeApp(store);
  registerSessionRoutes(app);

  const cookie = extractCookie(await app.request("/login", { method: "POST" }));
  const sid = sidOf(cookie);
  const body = (await (await app.request("/me", { headers: { cookie } })).json()) as MeBody;
  expect(body.user).toEqual({ id: 42 });

  // Persist on write, load on open, touch on the (clean) follow-up read.
  expect(store.calls).toContain(`set:${sid}`);
  expect(store.calls).toContain(`get:${sid}`);
  expect(store.calls).toContain(`touch:${sid}`);
});

class SessionState {
  static next = 0;
  readonly id = ++SessionState.next;
}

test("resolver assembly: session.resolver from the middleware makes the session scope reachable (injectSession resolves per session)", async () => {
  SessionState.next = 0;
  const { app } = makeApp(new MemoryStore({ ttl: 30_000 }));
  app.injectSession(SessionState);
  app.post("/login", async (req: ZebraRequest) => {
    const s = getSession(req)!;
    await s.set("user", { id: 7 });
    return { ok: true };
  });
  app.get("/state", { state: SessionState }, async (req: ZebraRequest, { state }) => {
    const s = getSession(req)!;
    return { stateId: (state as SessionState).id, sid: s.id, user: await s.get("user") };
  });

  const c1 = extractCookie(await app.request("/login", { method: "POST" }));
  const first = (await (await app.request("/state", { headers: { cookie: c1 } })).json()) as {
    stateId: number;
    sid: string;
    user: { id: number } | undefined;
  };
  expect(first.stateId).toBe(1);
  expect(first.user).toEqual({ id: 7 });

  // Same session id → the same session-scoped instance is reused.
  const second = (await (
    await app.request("/state", { headers: { cookie: c1 } })
  ).json()) as typeof first;
  expect(second.stateId).toBe(first.stateId);
  expect(second.sid).toBe(first.sid);

  // A different session id gets its own container and instance.
  const c2 = extractCookie(await app.request("/login", { method: "POST" }));
  const other = (await (
    await app.request("/state", { headers: { cookie: c2 } })
  ).json()) as typeof first;
  expect(other.sid).not.toBe(first.sid);
  expect(other.stateId).not.toBe(first.stateId);
});

test("anonymous session isolation: cookie-less requests get distinct sids and never share data", async () => {
  const { app } = makeApp(new MemoryStore({ ttl: 30_000 }));
  registerSessionRoutes(app);

  const anon1 = (await (await app.request("/me")).json()) as MeBody;
  const anon2 = (await (await app.request("/me")).json()) as MeBody;
  expect(anon1.isNew).toBe(true);
  expect(anon2.isNew).toBe(true);
  expect(anon1.sid).not.toBe(anon2.sid);
  expect(anon1.user).toBeUndefined();
  expect(anon2.user).toBeUndefined();

  // Data written by a logged-in session never leaks into an anonymous one.
  const cookie = extractCookie(await app.request("/login", { method: "POST" }));
  const logged = (await (await app.request("/me", { headers: { cookie } })).json()) as MeBody;
  expect(logged.sid).not.toBe(anon1.sid);
  expect(logged.user).toEqual({ id: 42 });

  const anon3 = (await (await app.request("/me")).json()) as MeBody;
  expect(anon3.sid).not.toBe(logged.sid);
  expect(anon3.user).toBeUndefined();
});

test("resolver agrees with the store: a destroyed session id resolves to undefined (no DI scope revival)", async () => {
  const { app, mw } = makeApp(new MemoryStore({ ttl: 30_000 }));
  registerSessionRoutes(app);

  const cookie = extractCookie(await app.request("/login", { method: "POST" }));
  const sid = sidOf(cookie);
  const req = () => new Request("http://localhost/", { headers: { cookie } });
  expect(await mw.resolver(req())).toBe(sid);

  await mw.destroySession(sid);
  // A stale cookie must resolve to anonymous again — core then skips the
  // session scope for the old id instead of rebuilding a zombie container.
  expect(await mw.resolver(req())).toBeUndefined();

  const res = await app.request("/me", { headers: { cookie } });
  const body = (await res.json()) as MeBody;
  expect(body.isNew).toBe(true);
  expect(sidOf(extractCookie(res))).not.toBe(sid);
});

test("a brand-new visitor that writes nothing is not persisted (store does not grow)", async () => {
  const store = new SpyStore();
  const { app } = makeApp(store);
  app.get("/ping", () => ({ ok: true }));

  const res = await app.request("/ping");
  // The visitor still receives a signed session cookie...
  expect(res.headers.get("set-cookie")).toContain("sid=");
  const sid = sidOf(extractCookie(res));
  // ...but the store was never written to (nothing to renew or persist).
  expect(store.calls.filter((c) => c.startsWith("set:") || c.startsWith("touch:"))).toEqual([]);
  expect(await store.get(sid)).toBeUndefined();
});

test("data() returns a copy: raw mutation is not silently persisted", async () => {
  const store = new SpyStore();
  const { app } = makeApp(store);
  app.post("/raw-mutate", async (req: ZebraRequest) => {
    const s = getSession(req)!;
    const data = await s.data();
    data.user = { id: 999 }; // bypasses set() — must NOT be persisted
    return { ok: true };
  });

  const cookie = extractCookie(await app.request("/raw-mutate", { method: "POST" }));
  const sid = sidOf(cookie);
  await app.request("/raw-mutate", { method: "POST", headers: { cookie } });
  expect(await store.get(sid)).toBeUndefined();
});
