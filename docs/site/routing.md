# Routing

Zebra uses a radix-tree router with `:params` and wildcards, plus the usual
HTTP verbs and route groups.

## Methods

```ts
z.get(path, handler);
z.post(path, handler);
z.put(path, handler);
z.patch(path, handler);
z.delete(path, handler);
```

Handlers receive a `ZebraRequest` — a `Request` superset with `params`,
`query`, and lazy body parsing — and may return a `Response` or any value
(value returns become JSON).

```ts
z.get("/hello/:name", async (req) => new Response(`hello, ${req.params.name}`));
```

## Route DI

Routes declare their dependencies with a named-object spec:

```ts
z.get("/hi/:name", { g: Greeter }, async (req, { g }) => g.greet(req.params.name));
```

## Groups

`app.group(prefix, g => { ... })` scopes a prefix and per-group middleware:

```ts
z.group("/blogs", (g) => {
  g.use(authMiddleware);
  g.get("/", listHandler);        // GET /blogs
  g.get("/:id", getHandler);      // GET /blogs/:id
});
```

## Static files

`app.static()` serves files with path-traversal and symlink-escape defense
(files are realpath-resolved and must stay inside the realpath of the root —
a symlink inside root pointing outside is rejected with 403), weak ETags,
conditional requests, and byte ranges.

## The request object

| Member | Description |
| ------ | ----------- |
| `req.params` | Radix-router path params (`/blogs/:id` → `{ id }`) |
| `req.query` | Parsed query string |
| `req.body()` | Lazily-parsed, content-type-aware body (with size limits) |
| `req.json()` | Body parsed as JSON regardless of content-type; lazy + memoized |
| `req.text()` | Raw body text; lazy + memoized |
| `req.form()` | Body as `FormData`: multipart (with `File` entries), urlencoded (string entries), anything else → empty; lazy + memoized |
| `req.stream()` | Raw body `ReadableStream` through the app size limit — the non-buffering path for large uploads |
| `req.ip` | Socket peer address from Bun's `server.requestIP` (undefined under direct `dispatch()`); never header-derived — see rate-limit's `trustProxy` |
| `req.signal` | Abort signal for the request: aborts on client disconnect (Bun's raw `Request.signal`) and, when `requestTimeout` is configured, on the deadline (reason is the 504 `HttpError`). Identity: `req.raw.signal` when no timeout is configured |

`json()` / `text()` / `form()` share a single buffered read: the body
stream is consumed once (with the same per-content-type `body` limits as
`req.body()`) and each helper is memoized. Invalid JSON throws a 400
`invalid_json` `HttpError`; empty bodies give `null` / `""` / an empty
`FormData`. The raw stream is single-consumption — call exactly one of
`body()` / `json()` / `text()` / `form()` / `stream()` per request.

## Response helpers

```ts
import { json, text, html, redirect, stream } from "@zebra/core";

z.post("/things", async (req) => {
  return json({ created: await req.json() }, { status: 201 });
});
z.get("/plain", () => text("hello"));
z.get("/page", () => html("<h1>hi</h1>"));
z.get("/old", () => redirect("/new", { status: 301 }));
z.get("/file", () => stream(Bun.file("data.csv")));
```

Default `content-type` / status rules:

| Helper | Default `content-type` | Default status |
| ------ | ---------------------- | -------------- |
| `json()` | `application/json; charset=utf-8` | 200 |
| `text()` | `text/plain; charset=utf-8` | 200 |
| `html()` | `text/html; charset=utf-8` | 200 |
| `stream()` | `application/octet-stream` | 200 |
| `redirect()` | — (no body, `Location` set) | 302 |

`init.headers` always wins over the default `content-type`; `Location`
always comes from the `url` argument. Any `init` field (`status`, headers,
etc.) may be passed.

**What a handler may return:** a raw `Response` passes through unchanged; a
non-`Response` value is `JSON.stringify`d with 200 (`application/json;
charset=utf-8`) — including plain strings and `null`; `undefined` → empty
204. This is frozen v1 behavior: returning a string does *not* yield
`text/plain`. Use the helpers above — `text()`, `html()`, `stream()` — as
the explicit escape hatches.

## Streaming

- **Uploads:** `req.stream()` pipes the raw body (through the app-level size
  limit) without buffering — write to disk, S3, etc. The 413 `HttpError`
  surfaces when the stream errors mid-read. `req.body()` / `json()` /
  `text()` / `form()` buffer, so use `req.stream()` for genuinely large
  uploads (raise `body.maxSize` / `body.multipart.limit` as needed).
- **Downloads:** `app.static()` already streams files with ranges/ETags; for
  dynamic streaming use `stream()` — e.g. `stream(Bun.file(path))`, SSE
  `ReadableStream`s, or chunked data.

## Timeouts and cancellation

`new Zebra({ requestTimeout: ms })` gives every request a deadline. When the
pipeline has not produced a response in time, the client receives a 504
Problem+Json (`https://errors.zebra.dev/request_timeout`) and the handler's
`req.signal` aborts — listen for `abort` to stop background work:

```ts
const z = new Zebra({ requestTimeout: 5_000 });

z.post("/slow", async (req) => {
  req.signal.addEventListener("abort", () => {
    // client disconnected or the deadline fired — cancel background work
    cancelWork();
  });
  await doWork();
  return "done";
});
```

Bun aborts the raw `Request.signal` when the client disconnects; the combined
`req.signal` observes both that and the deadline (with `signal.reason` being
the 504 `HttpError` on timeout). Note that a timed-out handler keeps running
until it settles — the framework answers 504 and stops waiting, but cannot
kill arbitrary pending promises; use the signal to cancel cooperatively.

## Request body limits

Two independent layers produce 413s:

- **Transport (Bun)** — `listen({ maxRequestBodySize })` rejects requests
  bigger than the cap *before any handler runs* with a bare 413 (no
  Problem+Json body). Default 128MB.
- **App (parser)** — `new Zebra({ body: { ... } })` limits enforced inside
  `req.body()` with a 413 Problem+Json (`payload_too_large`), per
  content-type: `json.limit`, `form.limit`, `multipart.limit` /
  `maxFiles` / `maxFileSize`, all capped by `maxSize`. Enforced both from
  `Content-Length` and while streaming (chunked bodies), so they work
  regardless of the transport limit.

**Composition:** keep `maxRequestBodySize` ≥ the largest app limit so the
app parser's more specific per-type limits stay authoritative. If the
transport limit is smaller, it wins first and turns large uploads into a
bare 413 before the parser can produce its structured error.

## Structured errors

Throw `HttpError` for structured failures; the default error middleware turns
it into an RFC 9457 Problem+Json response (see [middleware](middleware.md)).
