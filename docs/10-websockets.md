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
  upgrade?: (req, deps, params) => Up | false | Promise<Up | false>;
  open?: (ws, data) => void | Promise<void>;
  message?: (ws, data, message) => void | Promise<void>;  // string | Buffer
  close?: (ws, data, code, reason) => void | Promise<void>;
  drain?: (ws, data) => void | Promise<void>;
  ping?: (ws, data, payload) => void | Promise<void>;
  pong?: (ws, data, payload) => void | Promise<void>;
}
```

Callbacks align with Bun `ServerWebSocket` semantics; Zebra injects `ws.data` (upgrade result + path params) as the second argument, shifting Bun's original args (message / code / reason / ping-pong payload) to the right.

## The upgrade decision chain (`upgrade` hook)

The `upgrade` hook runs before the upgrade happens, deciding whether to **accept or reject** and spreading custom data into `ws.data`:

| Return | Behavior |
| --- | --- |
| `Up` object | upgrade succeeds; fields spread into `ws.data` (typed as `Up`, accessible in open/message/close) |
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
- Anonymous connections get `undefined` — an upgrade response cannot send Set-Cookie, so fabricating a new id would only create orphan records the client can't use.
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
