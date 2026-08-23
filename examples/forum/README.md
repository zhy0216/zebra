# forum — a full-featured example

A forum (boards → topics → replies) built to show off the breadth of Zebra:
**contract-first** API, **DI** everywhere, **signed cookie sessions**, per-user
**rate limiting**, **CORS**, a **WebSocket** live feed, a static **frontend**,
and an in-process **test suite** — all in one example.

## Run it

```sh
bun --filter example-forum start     # server on http://localhost:3002
bun --filter example-forum client    # typed-client round-trip (separate terminal)
bun --filter example-forum test      # integration tests (no sockets)
```

Open http://localhost:3002 — register, pick a board, start a topic, and reply.
Open the same topic in two tabs: replies appear in the second tab live, via
WebSocket.

## What each file shows

| File                 | Zebra feature                                                     |
| -------------------- | ----------------------------------------------------------------- |
| `src/contract.ts`    | One contract (`zc.get/post...`) — params, query, body, output, status, and error-code schemas. Server implements it, the client derives from it, tests exercise it. |
| `src/services.ts`    | `@injectable()` services; the container resolves the constructor graph (`AuthService → ForumStore`) and validates it at boot. Failures are `HttpError`s → RFC 9457 Problem+Json. |
| `src/auth.ts`        | Dep-aware middleware via `middleware({ store }, fn)` — named deps resolved per request. `attachUser` reads the session cookie and stashes the user on `req.ctx`; `requireAuth()` is a per-route guard (401). |
| `src/feed.ts`        | `LiveFeed` bridged across HTTP and WebSocket: registered with `injectValue`, used as a route dep by name and captured by the WS handler. |
| `src/app.ts`         | The composition root: `sessionMiddleware` (resolver + `wsSession` wired into `Zebra`), `cors`, global middleware chain, per-user `rateLimit`, `app.implement`, `app.ws` with DI upgrade decision, `app.static`, lifecycle hooks. |
| `client-demo.ts`     | `createClient(contract)` — a type-safe client over the contract, with a tiny cookie jar so login persists. |
| `test/forum.test.ts` | Integration tests drive the real app in-process via `app.dispatch()` and a `createClient` with cookie jar. |
| `public/index.html`  | Vanilla-JS frontend served by `app.static("/")`. |

## Feature tour

- **Contract-first.** `forumContract` declares every endpoint, its input
  schemas, output, status codes and error codes. `app.implement` enforces
  input *and output* validation at runtime; `createClient` gives the client
  exact types (`api.topics.create({ params, body })`) and turns declared
  errors into typed `ClientError`s (`err.code === "username_taken"`).
- **DI is first-class.** Routes declare deps by name and receive resolved
  instances: `{ auth: AuthService, forum: ForumService, feed: LiveFeed }`.
  `middleware({ store: ForumStore }, ...)` does the same for middleware.
  `injectValue` binds a pre-built instance (the `LiveFeed`) so the same
  object is reachable from both the HTTP handlers and the WS handler.
- **Sessions.** `sessionMiddleware({ secret })` issues an HMAC-SHA256-signed
  `sid` cookie. `login` writes `userId` into the session; `logout` calls
  `session.destroy()` (store teardown + expiring cookie, fixation-safe).
  The resolver is wired into `Zebra` for session-scoped DI, and `wsSession`
  attaches the same session handle to WebSocket connections.
- **Rate limiting.** `rateLimit({ windowMs, max, keyBy })` guards write
  routes — the key is the logged-in user's id, so limits are per-user.
  429s are Problem+Json with `Retry-After` / `X-RateLimit-*` headers.
- **WebSocket.** `app.ws("/topics/:topicId/live", ...)` gates the upgrade
  through a DI-resolved `upgrade` hook (unknown topics are rejected with
  401). Every reply created over HTTP is broadcast to subscribed sockets
  through `LiveFeed` — open two browser tabs to see it.
- **Errors.** All failures are `HttpError`s — `404 board_not_found`,
  `401 unauthorized`, `409 username_taken` — serialized as RFC 9457
  Problem+Json with the error code in the `type` URI.
- **Lifecycle.** `on("ready")` / `on("shutdown")` hooks, and graceful
  draining is built into `listen`.
- **Static files.** `app.static("/", ...)` serves the frontend with
  path-traversal defense, ETags and byte ranges.

## Testing without sockets

`test/forum.test.ts` builds the *same* `buildForumApp()` the server uses and
drives it through `app.dispatch()`, so the tests hit real middleware, session
signing and rate limiting. `@zebra-web/testing`'s `createTestApp` /
`createTestClient` are the socket-free helpers for plain `Zebra` apps (see
`examples/contract-blog`); this example uses the real app + `createClient`
with a cookie jar because auth flows need the `sid` cookie to persist.
