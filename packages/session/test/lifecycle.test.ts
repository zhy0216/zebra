// C5: session lifecycle boundaries.
// - destroy() → store record gone + expiring Set-Cookie
// - stale cookies never revive a destroyed / TTL-expired session (fixation)
// - mw.destroySession(id) / app.disposeSession(id) store-vs-container split

import { expect, test } from "bun:test";
import { Zebra, type ZebraRequest } from "@zebra-web/core";

import { MemoryStore, createSession, getSession, sessionMiddleware } from "../src/index.ts";
import { verify } from "../src/sign.ts";
import type { SessionStore } from "../src/store.ts";

const SECRET = "test-secret";

function makeApp(store: SessionStore, ttl = 30_000) {
  const mw = sessionMiddleware({ secret: SECRET, cookie: { maxAge: 3600 }, store });
  const app = new Zebra({ session: { resolver: mw.resolver, ttl } });
  app.use(mw);
  return { app, mw };
}

async function login(app: Zebra): Promise<{ sid: string; cookie: string }> {
  app.post("/login", async (req: ZebraRequest) => {
    const s = getSession(req)!;
    await s.set("user", { id: 42 });
    return { ok: true };
  });
  const res = await app.dispatch(new Request("http://test.local/login", { method: "POST" }));
  const cookie = res.headers.get("set-cookie")!.split(";")[0]!;
  const sid = verify(cookie.slice("sid=".length), SECRET)!;
  return { sid, cookie };
}

test("session.destroy(): store record removed and the response carries an expiring Set-Cookie", async () => {
  const store = new MemoryStore({ ttl: 30_000 });
  const { app } = makeApp(store);
  app.get("/logout", async (req: ZebraRequest) => {
    await getSession(req)!.destroy();
    return { ok: true };
  });
  const { cookie, sid } = await login(app);
  expect(await store.get(sid)).toEqual({ user: { id: 42 } });

  const res = await app.dispatch(new Request("http://test.local/logout", { headers: { cookie } }));
  expect(res.status).toBe(200);

  // Response-end persistence must not resurrect the record.
  expect(await store.get(sid)).toBeUndefined();

  const setCookie = res.headers.get("set-cookie")!;
  expect(setCookie).toContain("Max-Age=0");
  expect(setCookie).toContain("Expires=Thu, 01 Jan 1970 00:00:00 GMT");
  expect(setCookie).toContain("Path=/");
});

test("stale cookie after destroy does not revive the session (anti-fixation)", async () => {
  const store = new MemoryStore({ ttl: 30_000 });
  const { app } = makeApp(store);
  app.get("/logout", async (req: ZebraRequest) => {
    await getSession(req)!.destroy();
    return { ok: true };
  });
  app.get("/me", async (req: ZebraRequest) => {
    const s = getSession(req)!;
    return { id: s.id, isNew: s.isNew, user: await s.get("user") };
  });
  const { cookie, sid } = await login(app);
  await app.dispatch(new Request("http://test.local/logout", { headers: { cookie } }));

  const res = await app.dispatch(new Request("http://test.local/me", { headers: { cookie } }));
  const body = (await res.json()) as { id: string; isNew: boolean; user: unknown };
  expect(body.isNew).toBe(true);
  expect(body.id).not.toBe(sid);
  expect(body.user).toBeUndefined();
  expect(await store.get(sid)).toBeUndefined();

  // A fresh signed cookie was issued instead of reviving the old session.
  const newSid = verify(res.headers.get("set-cookie")!.split(";")[0]!.slice("sid=".length), SECRET);
  expect(newSid).not.toBeNull();
  expect(newSid).not.toBe(sid);
  // The new visitor wrote nothing, so it is not persisted yet.
  expect(await store.get(newSid!)).toBeUndefined();
});

test("mw.destroySession(id): store data removed and the old cookie is treated as a new visitor", async () => {
  const store = new MemoryStore({ ttl: 30_000 });
  const { app, mw } = makeApp(store);
  app.get("/me", async (req: ZebraRequest) => {
    const s = getSession(req)!;
    return { id: s.id, isNew: s.isNew };
  });
  const { cookie, sid } = await login(app);

  await mw.destroySession(sid);
  expect(await store.get(sid)).toBeUndefined();

  const res = await app.dispatch(new Request("http://test.local/me", { headers: { cookie } }));
  const body = (await res.json()) as { id: string; isNew: boolean };
  expect(body.isNew).toBe(true);
  expect(body.id).not.toBe(sid);
  expect(await store.get(sid)).toBeUndefined();
});

test("app.disposeSession(id) reclaims only the core container; store data stays (store owns data lifecycle)", async () => {
  const store = new MemoryStore({ ttl: 30_000 });
  const { app } = makeApp(store);
  const { sid } = await login(app);

  await app.disposeSession(sid);
  expect(await store.get(sid)).toEqual({ user: { id: 42 } });
});

test("TTL-expired session: old cookie is treated as a new visitor, not revived", async () => {
  const store = new MemoryStore({ ttl: 10 });
  const { app } = makeApp(store);
  app.get("/me", async (req: ZebraRequest) => {
    const s = getSession(req)!;
    return { id: s.id, isNew: s.isNew };
  });
  const { cookie, sid } = await login(app);
  await Bun.sleep(25);

  const res = await app.dispatch(new Request("http://test.local/me", { headers: { cookie } }));
  const body = (await res.json()) as { id: string; isNew: boolean };
  expect(body.isNew).toBe(true);
  expect(body.id).not.toBe(sid);
  expect(await store.get(sid)).toBeUndefined();
  expect(res.headers.get("set-cookie")).not.toBeNull();
});

test("session writes are isolated from the store and sibling sessions until flushed", async () => {
  const store = new MemoryStore({ ttl: 30_000 });
  await store.set("s1", { a: 1 });
  const initial = (await store.get("s1")) as Record<string, unknown>;

  const first = createSession({ id: "s1", isNew: false, store, initial });
  await first.set("a", 2);
  // Uncommitted writes stay in the session handle: neither the store nor a
  // sibling handle opened on the same id sees them.
  expect(await store.get("s1")).toEqual({ a: 1 });
  const sibling = createSession({ id: "s1", isNew: false, store, initial });
  expect(await sibling.get<number>("a")).toBe(1);

  await first.flush();
  expect(await store.get("s1")).toEqual({ a: 2 });
  // The sibling keeps its own snapshot even after another handle flushes.
  expect(await sibling.get<number>("a")).toBe(1);
  // A handle opened without `initial` also clones on load instead of aliasing
  // the store record.
  const late = createSession({ id: "s1", isNew: false, store });
  await late.set("a", 3);
  expect(await store.get("s1")).toEqual({ a: 2 });
});
