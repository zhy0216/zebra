# Cookie Sessions (@zebra/session)

`@zebra/session` provides signed-cookie server-side sessions: HMAC-SHA256-signed `sid` cookies, a pluggable `SessionStore` (in-memory by default), rolling TTL renewal, and session-fixation protection. It also bridges into core's session-scoped DI via its `resolver`.

## Install

```sh
bun add @zebra/session
```

## Quick start

```ts
import { Zebra } from "@zebra/core";
import { sessionMiddleware } from "@zebra/session";

const session = sessionMiddleware({
  secret: "a-long-random-secret",
  cookie: { httpOnly: true, sameSite: "lax", maxAge: 7 * 24 * 60 * 60, path: "/" },
});

const app = new Zebra({
  session: { resolver: session.resolver, wsSession: session.wsSession, ttl: 30 * 60 * 1000 },
});

app.use(session);

app.get("/counter", async (req) => {
  const s = getSession(req)!;
  const count = (await s.get<number>("count")) ?? 0;
  await s.set("count", count + 1);
  return { count: count + 1 };
});
```

The key wiring:

1. `sessionMiddleware({ secret, cookie?, store? })` returns the middleware object.
2. Its `.resolver` goes into `new Zebra({ session: { resolver, ttl } })` — this makes **session-scoped DI** work under the same session id (core doesn't depend on the session package; the resolver is the bridge).
3. `.wsSession` goes into `session: { wsSession }` — WebSocket connections get a session handle (see [WebSocket](10-websockets.md)).
4. `app.use(session)` mounts the middleware: it puts a read/write `RequestSession` on `req.ctx.session` and persists on the response path.

## RequestSession API

`getSession(req)` returns the current request's session handle (`undefined` when the middleware didn't run):

```ts
interface RequestSession {
  readonly id: string;      // verified session id (fresh for first-time visitors)
  readonly isNew: boolean;  // whether this request created the session
  get<T>(key: string): Promise<T | undefined>;
  set(key: string, value: unknown): Promise<void>;
  delete(key: string): Promise<void>;
  has(key: string): Promise<boolean>;
  data(): Promise<Record<string, unknown>>; // shallow copy
  flush(): Promise<void>;   // persist now (the middleware also persists at response end)
  destroy(): Promise<void>; // destroy: remove data + expiring Set-Cookie
}
```

- Data is **lazily loaded**: the first `get`/`set` pulls from the store, cached for the rest of the request.
- `set`/`delete` mark the session dirty; persistence happens at response end (even on error). A brand-new visitor that never wrote data writes nothing (no store pollution).
- After `destroy()` the handle is inert: further mutations are not persisted, and the response carries `Set-Cookie: sid=; Max-Age=0` so the client drops the cookie.

## Persistence semantics

| Scenario | Behavior |
| --- | --- |
| New session + no writes | store untouched (zero-cost anonymous requests) |
| New session + writes | `store.set(id, data)` + `Set-Cookie` (signed) |
| Existing session + writes | `store.set(id, data)` |
| Existing session + no writes | `store.touch(id)` — rolling TTL renewal |
| `destroy()` | `store.destroy(id)` + expiring cookie; **never revived** |

Persistence runs after `next()` (including the handler-threw path, as long as the session is not destroyed) — see "TTL ownership" below.

## Cookie details

- Default cookie name `sid`, path `/`.
- Value = HMAC-SHA256-signed id. `parseSignedCookie` verifies the signature; a tampered cookie is treated as anonymous.
- **The default cookie has no security attributes** (frozen v1 behavior). Harden with `preset: "secure"` (`HttpOnly` + `SameSite=Lax`), or explicit attributes (which override the preset):

```ts
sessionMiddleware({
  secret,
  cookie: { preset: "secure" },            // HttpOnly + SameSite=Lax
  // or explicit: cookie: { httpOnly: true, sameSite: "strict", secure: true }
});
```

`SECURE_COOKIE` is the frozen `{ httpOnly: true, sameSite: "lax" }` constant; `SECURE_COOKIE` env var also works.

## Session-fixation protection

- The signature only proves the cookie is **genuine**, not that the session is **alive**. Both the resolver and `openSession` consult the store before reusing an id: a verified id with no store record (destroyed or TTL-expired) is treated as a **new visitor** — a fresh sid + cookie replace the stale one instead of resurrecting the old session.
- This keeps core's session DI scope consistent with the middleware's data layer: a destroyed session revives neither data nor DI scope.
- `MemoryStore` uses a short-lived tombstone so an in-flight request's `set` cannot resurrect a destroyed session.

## SessionStore interface and default implementation

```ts
interface SessionStore {
  get(id: string): Promise<unknown | undefined>;
  set(id: string, data: unknown): Promise<void>;
  touch(id: string, ttl?: number): Promise<void>;
  destroy(id: string): Promise<void>;
}
```

- `MemoryStore({ ttl })` — default, `Map`-backed, lazy sweep (at most `SWEEP_BUDGET` entries per access), no timers, no leaks; TTL in ms.
- Roll your own backend (Redis / Postgres): implement this interface. `@zebra/redis` ships `RedisSessionStore` (see [Redis](14-redis.md)).

## TTL ownership

Two independent TTLs:

- **The store TTL owns the data**: a session id is alive iff the store holds a record. After expiry, the cookie is dead and the data is gone.
- **Core's `sessionTtl` only reclaims the DI container**: `app.disposeSession(id)` clears the container and timer, never touching store data.

To reclaim both immediately (logout), combine `session.destroy()` (store layer) with `app.disposeSession(id)` (container layer).

## Logout pattern

```ts
import { HttpError } from "@zebra/core";
import { getSession } from "@zebra/session";

z.post("/logout", async (req) => {
  const s = getSession(req);
  if (!s) throw new HttpError(401, "unauthorized", "No session");
  await s.destroy();
  // response carries the expiring Set-Cookie; the store record is gone,
  // so the old cookie can no longer revive the session
  return { ok: true };
});
```

## WebSocket sessions

The `.wsSession` hook returned by `sessionMiddleware` attaches a connection-level session handle to `ws.data.session` at upgrade time (`undefined` for anonymous connections — an upgrade response cannot send Set-Cookie, so no orphan sessions are fabricated). WebSockets have no HTTP response path for automatic persistence: write explicitly with `await session.flush()`. See [WebSocket](10-websockets.md).

## Next steps

- [Session-scoped DI working together](03-di.md#session-scope)
- [Redis backend store](14-redis.md)
- [Sessions in WebSockets](10-websockets.md)
