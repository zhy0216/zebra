import { expect, test } from "bun:test";
import { Zebra, type ZebraRequest } from "@zebra-web/core";

import { MemoryStore, SECURE_COOKIE, getSession, sessionMiddleware, sign } from "../src/index.ts";
import { verify } from "../src/sign.ts";
import type { SessionStore } from "../src/store.ts";

const SECRET = "test-secret";

function makeApp(store: SessionStore, ttl = 30_000) {
  const mw = sessionMiddleware({ secret: SECRET, cookie: { maxAge: 3600 }, store });
  const app = new Zebra({ session: { resolver: mw.resolver, ttl } });
  app.use(mw);
  return { app, mw };
}

test("new visitor: generates sid and sets signed Set-Cookie (nothing persisted until the first write)", async () => {
  const store = new MemoryStore({ ttl: 30_000 });
  const { app } = makeApp(store);
  app.get("/", async () => new Response("hi"));

  const res = await app.dispatch(new Request("http://test.local/"));
  expect(res.status).toBe(200);

  const setCookie = res.headers.get("set-cookie");
  expect(setCookie).toContain("Max-Age=3600");
  expect(setCookie).toContain("Path=/");

  const signed = setCookie!.split(";")[0]!.slice("sid=".length);
  const sid = verify(signed, SECRET);
  expect(sid).not.toBeNull();
  // An empty record would grow the store with every anonymous request; the
  // visitor only appears in the store once it writes something.
  expect(await store.get(sid!)).toBeUndefined();
});

test("writes persist to the store at response end and read back on the next request", async () => {
  const store = new MemoryStore({ ttl: 30_000 });
  const { app } = makeApp(store);
  let sessionId = "";
  app.post("/login", async (req: ZebraRequest) => {
    const s = getSession(req)!;
    sessionId = s.id;
    await s.set("user", { id: 42 });
    return { ok: true };
  });
  app.get("/me", async (req: ZebraRequest) => {
    const s = getSession(req)!;
    return { user: await s.get("user"), isNew: s.isNew };
  });

  const res1 = await app.dispatch(new Request("http://test.local/login", { method: "POST" }));
  expect(await store.get(sessionId)).toEqual({ user: { id: 42 } });

  const cookie = res1.headers.get("set-cookie")!.split(";")[0]!;
  const res2 = await app.dispatch(new Request("http://test.local/me", { headers: { cookie } }));
  expect(await res2.json()).toEqual({ user: { id: 42 }, isNew: false });
});

test("tampered signature is rejected: treated as a new visitor", async () => {
  const { app } = makeApp(new MemoryStore({ ttl: 30_000 }));
  app.get("/", async (req: ZebraRequest) => {
    const s = getSession(req)!;
    return { id: s.id, isNew: s.isNew };
  });

  const forged = `${sign("victim-sid", SECRET)}tampered`;
  const res = await app.dispatch(
    new Request("http://test.local/", { headers: { cookie: `sid=${forged}` } }),
  );
  const body = (await res.json()) as { id: string; isNew: boolean };
  expect(body.isNew).toBe(true);
  expect(body.id).not.toBe("victim-sid");
  expect(res.headers.get("set-cookie")).not.toBeNull();
});

test("read-only requests on an existing session renew the TTL via touch instead of rewriting data", async () => {
  const ops: string[] = [];
  const base = new MemoryStore({ ttl: 30_000 });
  const store: SessionStore = {
    get: (id) => {
      ops.push(`get:${id}`);
      return base.get(id);
    },
    set: (id, data) => {
      ops.push(`set:${id}`);
      return base.set(id, data);
    },
    touch: (id, ttl) => {
      ops.push(`touch:${id}`);
      return base.touch(id, ttl);
    },
    destroy: (id) => base.destroy(id),
  };
  const { app } = makeApp(store);
  app.get("/", async (req: ZebraRequest) => {
    const s = getSession(req)!;
    return { id: s.id, count: await s.get("count") };
  });

  // A brand-new visitor that writes nothing is not persisted at all.
  const _res1 = await app.dispatch(new Request("http://test.local/"));
  expect(ops.filter((op) => op.startsWith("set:"))).toHaveLength(0);

  // An existing session is touched on read-only requests, never rewritten.
  const sid = "pre-seeded-session";
  await base.set(sid, { count: 1 });
  ops.length = 0;
  await app.dispatch(
    new Request("http://test.local/", { headers: { cookie: `sid=${sign(sid, SECRET)}` } }),
  );
  expect(ops).toEqual([`get:${sid}`, `get:${sid}`, `touch:${sid}`]);
});

test("explicit flush persists mid-request; the response-end pass only renews", async () => {
  const ops: string[] = [];
  const base = new MemoryStore({ ttl: 30_000 });
  const store: SessionStore = {
    get: (id) => base.get(id),
    set: (id, data) => {
      ops.push(`set:${id}`);
      return base.set(id, data);
    },
    touch: (id, ttl) => {
      ops.push(`touch:${id}`);
      return base.touch(id, ttl);
    },
    destroy: (id) => base.destroy(id),
  };
  const { app } = makeApp(store);
  app.get("/flush", async (req: ZebraRequest) => {
    const s = getSession(req)!;
    await s.set("early", true);
    await s.flush();
    return { ok: true };
  });

  const first = await app.dispatch(new Request("http://test.local/flush"));
  const cookie = first.headers.get("set-cookie")!.split(";")[0]!;
  ops.length = 0;
  const res = await app.dispatch(new Request("http://test.local/flush", { headers: { cookie } }));
  expect(res.headers.get("set-cookie")).toBeNull();
  expect(ops.filter((op) => op.startsWith("set:"))).toHaveLength(1);
  expect(ops.at(-1)?.startsWith("touch:")).toBe(true);
});

test("resolver maps a verified cookie to a session id only when the store holds a live record", async () => {
  const store = new MemoryStore({ ttl: 30_000 });
  const { mw } = makeApp(store);

  expect(await mw.resolver(new Request("http://test.local/"))).toBeUndefined();

  const sid = "resolved-session-id";
  const ok = new Request("http://test.local/", {
    headers: { cookie: `sid=${sign(sid, SECRET)}` },
  });
  // A valid signature alone is not enough — the store owns the data lifecycle,
  // so an id without a live record is anonymous (anti-fixation).
  expect(await mw.resolver(ok)).toBeUndefined();

  await store.set(sid, { v: 1 });
  expect(await mw.resolver(ok)).toBe(sid);

  const bad = new Request("http://test.local/", {
    headers: { cookie: `sid=${sign(sid, SECRET)}xx` },
  });
  expect(await mw.resolver(bad)).toBeUndefined();

  // Destroyed ids resolve to anonymous again — no zombie DI scope.
  await store.destroy(sid);
  expect(await mw.resolver(ok)).toBeUndefined();
});

test("verified sessions enter core's non-ephemeral session scope (injectSession resolvable)", async () => {
  const store = new MemoryStore({ ttl: 30_000 });
  const mw = sessionMiddleware({ secret: SECRET, store });
  const app = new Zebra({ session: { resolver: mw.resolver, ttl: 30_000 } });
  app.use(mw);

  class Cart {
    items = 0;
  }
  app.injectSession(Cart);
  app.get("/cart", { cart: Cart } as never, async (_req, deps: { cart: Cart }) => ({
    items: deps.cart.items,
  }));

  // A live store record is required for the resolver to enter the session scope.
  const sid = "di-session-id";
  await store.set(sid, {});
  const res = await app.dispatch(
    new Request("http://test.local/cart", {
      headers: { cookie: `sid=${sign(sid, SECRET)}` },
    }),
  );
  expect(await res.json()).toEqual({ items: 0 });
});

test("missing secret throws at construction", () => {
  expect(() => sessionMiddleware({ secret: "" })).toThrow(/secret is required/);
});

test("SECURE_COOKIE preset carries HttpOnly + SameSite=Lax", () => {
  expect(SECURE_COOKIE).toEqual({ httpOnly: true, sameSite: "lax" });
});

test("preset: secure cookie adds HttpOnly and SameSite=Lax to Set-Cookie", async () => {
  const store = new MemoryStore({ ttl: 30_000 });
  const mw = sessionMiddleware({ secret: SECRET, cookie: { preset: "secure" }, store });
  const app = new Zebra({ session: { resolver: mw.resolver, ttl: 30_000 } });
  app.use(mw);
  app.get("/", async () => new Response("hi"));

  const res = await app.dispatch(new Request("http://test.local/"));
  const setCookie = res.headers.get("set-cookie");
  expect(setCookie).toContain("HttpOnly");
  expect(setCookie).toContain("SameSite=Lax");
});

test("explicit cookie attributes override the secure preset", async () => {
  const store = new MemoryStore({ ttl: 30_000 });
  const mw = sessionMiddleware({
    secret: SECRET,
    cookie: { preset: "secure", sameSite: "strict", httpOnly: false },
    store,
  });
  const app = new Zebra({ session: { resolver: mw.resolver, ttl: 30_000 } });
  app.use(mw);
  app.get("/", async () => new Response("hi"));

  const res = await app.dispatch(new Request("http://test.local/"));
  const setCookie = res.headers.get("set-cookie");
  expect(setCookie).toContain("SameSite=Strict");
  expect(setCookie).not.toContain("HttpOnly");
});

test("default cookie is hardened: HttpOnly + SameSite=Lax", async () => {
  const store = new MemoryStore({ ttl: 30_000 });
  const mw = sessionMiddleware({ secret: SECRET, store });
  const app = new Zebra({ session: { resolver: mw.resolver, ttl: 30_000 } });
  app.use(mw);
  app.get("/", async () => new Response("hi"));

  const res = await app.dispatch(new Request("http://test.local/"));
  const setCookie = res.headers.get("set-cookie");
  expect(setCookie).toContain("HttpOnly");
  expect(setCookie).toContain("SameSite=Lax");
});

test("preset: plain restores the flag-free cookie", async () => {
  const store = new MemoryStore({ ttl: 30_000 });
  const mw = sessionMiddleware({ secret: SECRET, cookie: { preset: "plain" }, store });
  const app = new Zebra({ session: { resolver: mw.resolver, ttl: 30_000 } });
  app.use(mw);
  app.get("/", async () => new Response("hi"));

  const res = await app.dispatch(new Request("http://test.local/"));
  const setCookie = res.headers.get("set-cookie");
  expect(setCookie).not.toContain("HttpOnly");
  expect(setCookie).not.toContain("SameSite");
});

test("handler errors still issue the sid cookie to a first-time visitor", async () => {
  const store = new MemoryStore({ ttl: 30_000 });
  const { app } = makeApp(store);
  app.get("/boom", async () => {
    throw new Error("boom");
  });

  const res = await app.dispatch(new Request("http://test.local/boom"));
  expect(res.status).toBe(500);
  const setCookie = res.headers.get("set-cookie");
  expect(setCookie).not.toBeNull();
  const signed = setCookie!.split(";")[0]!.slice("sid=".length);
  const sid = verify(signed, SECRET);
  expect(sid).not.toBeNull();
  // Nothing was written, so no store record exists (mirrors the success path).
  expect(await store.get(sid!)).toBeUndefined();
});

test("a session destroyed before the handler throws expires the cookie on the error response", async () => {
  const store = new MemoryStore({ ttl: 30_000 });
  const { app } = makeApp(store);
  // First visit establishes the session.
  app.get("/start", async (req: ZebraRequest) => {
    await getSession(req)!.set("user", 1);
    return "ok";
  });
  const first = await app.dispatch(new Request("http://test.local/start"));
  const cookie = first.headers.get("set-cookie")!.split(";")[0]!;

  app.get("/boom", async (req: ZebraRequest) => {
    await getSession(req)!.destroy();
    throw new Error("boom");
  });
  const res = await app.dispatch(new Request("http://test.local/boom", { headers: { cookie } }));
  expect(res.status).toBe(500);
  const setCookies = res.headers.getSetCookie();
  expect(setCookies.join("; ")).toContain("Max-Age=0");
});
