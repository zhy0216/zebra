# WebSocket

`app.ws(path, handler)` wires a WebSocket upgrade path into `Bun.serve` with
radix-router params and DI-resolved upgrade decisions.

## Basic handler

```ts
import { Zebra } from "zebra";

const z = new Zebra();

z.ws("/chat/:room", {
  open(ws, data) {
    // data.params carries path params: { room }
    ws.subscribe(`room:${data.params.room}`);
  },
  message(ws, data, message) {
    ws.publish(`room:${data.params.room}`, message);
  },
  close(ws, data) {
    // connection cleanup
  },
});

await z.listen({ port: 3000 });
```

`open` / `message` / `close` align to Bun's WebSocket semantics.

## DI-resolved upgrade decision

Upgrade can be gated by services from the container — a rejected upgrade
answers 401 (return `false`), a hook failure answers 500:

```ts
z.ws("/admin", {
  // onUpgrade is a named-dep declaration (like middleware()), NOT a callback.
  onUpgrade: { auth: AuthService },
  // upgrade(req, deps, params) decides the handshake:
  //   - return an object → spread onto ws.data (typed via Up)
  //   - return false → 401 (upgrade_rejected)
  //   - throw → 500 (upgrade_error); to reject, return false, never throw
  async upgrade(req, { auth }, params) {
    const u = await auth.fromRequest(req.raw);
    return u ? { userId: u.id } : false;
  },
  open(ws, data) { /* ... */ },
});
```

`req` is the `ZebraRequest` (`.raw` is the underlying `Request`); `params`
carries the route path params so upgrade can do path-based auth (e.g. room
permissions).

## Sessions over WebSocket

The session middleware exposes a `wsSession` hook that core uses to attach a
live `RequestSession` to the socket — reads and writes share the same session
as the HTTP routes:

```ts
import { Zebra } from "zebra";
import { sessionMiddleware } from "@zebra/session";

const mw = sessionMiddleware({ secret: "change-me" });
const z = new Zebra({ session: { resolver: mw.resolver, wsSession: mw.wsSession } });
z.use(mw);

z.ws("/chat/:room", {
  open(ws, data) {
    const s = data.session; // RequestSession | undefined (anonymous sockets)
  },
});
```

## Notes

- Upgrade requests **bypass** `app.use` global middleware — the upgrade runs
  before the composed middleware chain.
- Writes over WS need an explicit `flush()` on the session; there is no
  HTTP-response path to auto-persist (see the session package docs).
