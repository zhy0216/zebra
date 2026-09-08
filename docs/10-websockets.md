# WebSocket

`app.ws(path, handler)` wires the WebSocket upgrade path into `Bun.serve`, with radix-router params, a DI-resolved upgrade decision (`onUpgrade` + `upgrade()`), and connection-level sessions (`ws.data.session`).

## Quick start

```ts
import { Zebra } from "@zebra-web/zebra";

const app = new Zebra();

app.ws("/chat/:room", {
  open(ws, data) {
    ws.subscribe(`room:${data.params.room}`);
    ws.send(JSON.stringify({ type: "joined", room: data.params.room }));
  },
  message(ws, data, message) {
    ws.publish(`room:${data.params.room}`, String(message));
  },
  close(ws, data) {
    ws.unsubscribe(`room:${data.params.room}`);
  },
});

await app.listen({ port: 3000 });
```

## Handler signature

```ts
interface WsHandler<D, Up> {
  onUpgrade?: D;                    // deps for the upgrade hook (same semantics as middleware())
  upgrade?: (req, deps, params) =>
    Up | WsUpgrade<Up> | Response | false |
    Promise<Up | WsUpgrade<Up> | Response | false>;
  open?: (ws, data) => void | Promise<void>;
  message?: (ws, data, message) => void | Promise<void>;  // string | Buffer
  close?: (ws, data, code, reason) => void | Promise<void>;
  drain?: (ws, data) => void | Promise<void>;
  ping?: (ws, data, payload) => void | Promise<void>;
  pong?: (ws, data, payload) => void | Promise<void>;
}
```

Callbacks align with Bun `ServerWebSocket` semantics; Zebra injects `ws.data` (upgrade result + path params) as the second argument, shifting Bun's original args (message / code / reason / ping-pong payload) to the right.

Callback promises are caught and reported, but callbacks are not serialized: a
`message` can arrive before an async `open` finishes. Applications that load state
in `open` need their own readiness barrier and bounded incoming queue.

## The upgrade decision chain (`upgrade` hook)

The `upgrade` hook runs before the upgrade happens, deciding whether to **accept or reject** and spreading custom data into `ws.data`:

| Return | Behavior |
| --- | --- |
| `Up` object | upgrade succeeds; fields spread into `ws.data` (typed as `Up`, accessible in open/message/close) |
| `wsUpgrade(data, { headers })` | successful upgrade with additional response headers; only `data` is spread into `ws.data`, with the same type inference |
| `Response` | reject without calling Bun's `upgrade` or `open`; return the response's status, body and headers unchanged |
| `false` | explicit client rejection → **401** `upgrade_rejected` |
| throws | internal error → **500** `upgrade_error` |

```ts
app.ws("/topics/:topicId/live", {
  onUpgrade: { forum: ForumService },          // DI-resolved
  async upgrade(_req, { forum }, params) {
    const topic = await forum.findTopic(Number(params.topicId));
    return topic === undefined ? false : { topicId: topic.id };  // missing → 401
  },
  open(ws, data) {
    // data.topicId: number — typed from the upgrade return value
  },
});
```

Key points:

- `onUpgrade` deps resolve in the **upgrade request's request scope**, disposed right after the decision — **don't** hang request-scoped deps on `ws.data` across the connection (resolve connection-level deps once in `open` and reuse).
- Upgrade requests bypass `app.use` global middleware — do path-based auth in the `upgrade` hook.
- Transport-level failure (Bun's `upgrade` returns false) → **401** `upgrade_failed` (distinct from `upgrade_rejected` above).
- Custom rejections skip `wsSession`; request scopes are still disposed and awaited on every decision path. Hook or disposal failures retain **500** `upgrade_error` semantics.

### Custom rejections and successful response headers

`wsUpgrade`, `WsUpgrade<Up>` and `WsUpgradeOptions` are public in both
`@zebra-web/core` and `@zebra-web/zebra`:

```ts
import { Zebra, wsUpgrade, type WsUpgrade, type WsUpgradeOptions } from "@zebra-web/core";

const app = new Zebra();
const protocol = "chat-v1";

app.ws("/chat/:room", {
  upgrade(req, _deps, params) {
    if (params.room !== "lobby") {
      return new Response("Room unavailable", {
        status: 404,
        headers: { "x-room-status": "unavailable" },
      });
    }
    const offered = req.headers.get("sec-websocket-protocol")?.split(",").map((p) => p.trim());
    const headers = new Headers({ "x-chat-server": "zebra" });
    if (offered?.includes(protocol)) headers.set("sec-websocket-protocol", protocol);
    return wsUpgrade({ userId: "u1" }, { headers });
  },
  message(ws, data, message) {
    // data.userId and ws.data.userId are both string.
    ws.send(`${data.userId}: ${message}`);
  },
});
```

The helper has signature
`wsUpgrade<Up extends Record<string, unknown>>(data: Up, options?: WsUpgradeOptions): WsUpgrade<Up>`.
`WsUpgradeOptions.headers` accepts Bun's `HeadersInit` (record, tuple list or
`Headers`). Use a tuple list or `Headers.append` for multiple `Set-Cookie` values.
The result carries a symbol discriminator: plain objects with `data`, `headers`
or `type` keys retain their original meaning as connection data.

An explicit `Sec-WebSocket-Protocol` must be one valid token offered by the
client, with an exact case-sensitive match. An invalid or unoffered selection
returns **500** `upgrade_error` before Bun's upgrade; no protocol is fabricated.
When the response header is omitted, Bun's existing negotiation remains in effect
(Bun 1.4 selects the first offered protocol, or none for a client with no offer).
Zebra does not choose an application protocol or impose an authorization policy.

## Listener transport options

`ListenOptions.websocket` accepts `WsTransportOptions`, a typed subset of Bun's
WebSocket handler options. Settings apply to every WS route on that listener:

```ts
await app.listen({
  port: 3000,
  websocket: {
    maxPayloadLength: 1024 * 1024,
    idleTimeout: 120,
    backpressureLimit: 4 * 1024 * 1024,
    closeOnBackpressureLimit: true,
  },
});
```

| Option | Meaning | Bun default when omitted |
| --- | --- | --- |
| `maxPayloadLength` | maximum incoming message bytes | 16 MiB |
| `idleTimeout` | seconds without messages or pings; `0` disables | 120 |
| `backpressureLimit` | maximum buffered outgoing bytes per connection | 16 MiB |
| `closeOnBackpressureLimit` | close on outgoing buffer overflow | `false` |

Only these four fields are forwarded. Zebra retains all callbacks and connection
data dispatch, even if an untyped caller supplies `open`, `message`, `data` or
other extra keys. Omitted values leave Bun's defaults unchanged. The top-level
`listen({ idleTimeout })` controls HTTP connections separately. Bun validates
transport values; see [Bun WebSockets](https://bun.com/docs/runtime/http/websockets).

The payload limit runs before the route's `message` callback, including for binary
messages. Verified with [Bun 1.4.2](https://github.com/oven-sh/bun/releases/tag/bun-v1.4.2),
the latest stable release as of 2026-09-08: Bun terminates oversized messages without a close frame:
the client observes **1006**, and the server close callback reports **1006** with
`Received too big message`. Do not rely on a **1009** close handshake at this
transport limit. At a 1 MiB limit, a 1 MiB binary message reaches the handler,
while 1 MiB + 1 byte never reaches it. Zebra keeps that hard limit unchanged and
exposes Bun's native closure behavior. Earlier Bun 1.4.0 checks observed the same
behavior; the repository's minimum version remains unchanged.
Application queue limits and processing order are separate
responsibilities; transport backpressure bounds outgoing bytes, not async work.

## Connection data `ws.data`

```ts
interface WsData {
  params: Record<string, string>;   // route path params
  session?: unknown;                // session handle (filled by the wsSession hook)
  [key: string]: unknown;           // upgrade() return object spread
}
```

- `params` are the route params (`room` for `/chat/:room`).
- `session` is filled by the `ZebraOptions.session.wsSession` hook (usually a `RequestSession` from `@zebra-web/session`). `undefined` when the hook is not configured or the connection is anonymous — never an error.
- The `upgrade()` return object spreads into the remaining fields; `session` is reserved (a same-named key in the return value is overwritten).

## Sessions and WebSocket

With `@zebra-web/session`, wire the `wsSession` hook returned by `sessionMiddleware()` into the `Zebra` options:

```ts
import { sessionMiddleware } from "@zebra-web/session";

const session = sessionMiddleware({ secret, cookie: { preset: "secure" } });

const app = new Zebra({
  session: { resolver: session.resolver, wsSession: session.wsSession, ttl: 30 * 60 * 1000 },
});
app.use(session);

app.ws("/chat/:room", {
  async open(ws, data) {
    const s = data.session;               // RequestSession | undefined
    const userId = s === undefined ? undefined : await s.get("userId");
    ws.send(JSON.stringify({ type: "joined", userId }));
  },
});
```

Session semantics:

- `sessionId` comes from a **verified live session** resolved on the upgrade request (not live = anonymous).
- Anonymous connections get `undefined`. The session hook does not create or issue a new cookie during upgrade. Custom handshake headers are available through `wsUpgrade`, but do not change the session middleware's anonymous-session policy.
- **WebSockets have no automatic persistence** (no HTTP response path): flush explicitly with `await session.flush()`.

## DI scope trade-offs

| Scenario | Scope |
| --- | --- |
| `upgrade` hook | one-shot request decision, request scope, disposed right after |
| `open` / `message` / `close` | no request scope (the original Request is gone); connection-level deps resolve once in `open` and live for the connection |

## Broadcasting

Use `ws.subscribe` / `ws.publish` for room broadcast:

```ts
app.ws("/feed/:topicId", {
  open(ws, data) {
    ws.subscribe(`feed:${data.params.topicId}`);
  },
});

// broadcast to a room from an HTTP handler:
z.post("/topics/:id/posts", { feed: LiveFeed }, async (req, { feed }) => {
  const post = await feed.create(...);
  return post;
});
```

`examples/forum`'s `LiveFeed` is a complete reference (subscribe / unsubscribe, broadcast, dispose on shutdown).

## No matching route

Upgrading an unregistered ws path → **404** `not_found` Problem+Json.

## Next steps

- [Sessions: the full semantics of the `wsSession` hook](07-sessions.md#websocket-sessions)
- [HTTP requests are unavailable during ws upgrade (upgrade runs before the middleware chain)](04-middleware.md)
- [forum example: ws + contract + rate limiting + static frontend](README.md#examples)
