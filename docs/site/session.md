# Sessions — `@zebra/session`

Cookie sessions: HMAC-SHA256-signed `sid` cookies, pluggable `SessionStore`,
and session-fixation protection (destroyed/expired ids are never revived).

```sh
bun add @zebra/session
```

## Setup

```ts
import { sessionMiddleware, getSession } from "@zebra/session";

const mw = sessionMiddleware({ secret: "change-me", cookie: { maxAge: 3600 } });
const z = new Zebra({ session: { resolver: mw.resolver } }); // for session-scoped DI
z.use(mw);
```

Options:

| Option | Default | Description |
| ------ | ------- | ----------- |
| `secret` | required | HMAC key used to sign the `sid` cookie |
| `cookie` | — | `{ name?: "sid", ...CookieSerializeOptions }` — cookie name + attributes |
| `store` | `MemoryStore({ ttl: 30min })` | Pluggable session data store |

## Reading / writing the session

```ts
z.post("/login", async (req) => {
  const s = getSession(req)!;
  await s.set("user", { id: 42 });
  return { ok: true };
});

z.get("/me", async (req) => {
  const s = getSession(req)!;
  return { sid: s.id, isNew: s.isNew, user: await s.get("user") };
});
```

`RequestSession` members: `id`, `isNew`, `get(key)`, `set(key, value)`.
`createSession` and `SESSION_KEY` are also exported for lower-level use.

## Behavior

- **Signed cookie** — the `sid` value is HMAC-SHA256-signed with `secret`;
  tampered/expired ids are rejected and never revived (anti-fixation).
- **Rolling TTL** — idle sessions are renewed; the store applies the TTL.
- **Session-scoped DI** — pass `resolver: mw.resolver` to `Zebra` so
  session-scoped bindings resolve per session (see [DI](di.md));
  `z.disposeSession(id)` reclaims the DI scope container.
- **WebSocket** — `mw.wsSession` attaches a live `RequestSession` to sockets
  (`ws.data.session`) when wired as `ZebraOptions.session.wsSession`; writes
  on the socket path need an explicit `flush()`.

## Stores

- `MemoryStore` (default): in-memory with TTL, `MemoryStoreOptions` for
  configuration.
- `SessionStore` interface: implement to back sessions with Redis, SQLite,
  etc. The middleware exposes `destroySession(id)` for server-side teardown.

## Cookie helpers

`sign`, `verify`, `parseCookies`, `parseSignedCookie`, `serializeCookie` are
exported for working with signed cookies directly.

## Full frozen surface

See `docs/api-freeze.md` §3 `@zebra/session` — includes
`sessionMiddleware`, `createSession`, `getSession`, `SESSION_KEY`,
`MemoryStore`, `sign`, `verify`, `parseCookies`, `parseSignedCookie`,
`serializeCookie`, and the option/type exports.
