# HTTP

This guide covers `ZebraRequest` (the request object), request body parsing, response helpers, structured errors (RFC 9457 Problem+Json), static files, and request timeouts.

## ZebraRequest

The `req` passed to route handlers and middleware is a `ZebraRequest` wrapping the Web Standard `Request`:

```ts
interface ZebraRequest<P, B, Q> {
  raw: Request;            // the original Request
  params: P;               // path params (type inferred from the route literal)
  query: Q;                // query params (Record<string, string>)
  headers: Headers;
  url: URL;
  body(): Promise<B>;      // body parsed by content-type
  json(): Promise<unknown>;
  text(): Promise<string>;
  form(): Promise<FormData>;
  stream(): ReadableStream<Uint8Array>;
  ctx: Map<symbol, unknown>; // request-scoped data shared between middleware
  ip?: string;             // socket peer address (Bun requestIP)
  signal: AbortSignal;     // cancellation signal (timeout / client disconnect)
}
```

- `query` comes from `url.searchParams`; repeated keys take the last value.
- `req.ctx` is the request-scoped shared state (middleware writes, handlers read), see [Middleware](04-middleware.md#passing-data-via-reqctx).
- `req.ip` comes from `Bun.serve`'s `server.requestIP(req)` — **never derived from headers**; `undefined` when there is no Bun server (e.g. `app.dispatch()` in tests). `x-forwarded-for` is only read when explicitly configured (`trustProxy`), by middleware such as `@zebra/rate-limit`.

## Request body

### Lazy and single-consumption

The body is **lazily parsed and memoized**: the first call to `body()` / `json()` / `text()` / `form()` buffers the bytes once and later calls share them; `stream()` does not buffer.

The raw stream is **single-consumption**: call exactly one of `body()` / `json()` / `text()` / `form()` / `stream()` (a second call reads an empty stream).

### Parsing rules

| Method | Behavior |
| --- | --- |
| `body()` | by content-type: `application/json` → JSON; `multipart/form-data` → `FormData` (with `File` entries); `application/x-www-form-urlencoded` → `FormData`; anything else → text |
| `json()` | forces JSON regardless of content-type. Empty body → `null`; invalid JSON → 400 `invalid_json` |
| `text()` | raw text |
| `form()` | multipart → `FormData` (`File` entries, constrained by `maxFiles` / `maxFileSize`); urlencoded → string entries; other content-types → empty `FormData` |
| `stream()` | the raw stream, piped through the same app-level size limit (`limitStream`) — the non-buffering path for large uploads; when the limit trips, the error surfaces when the stream is read |

### Size limits

Overridable at construction (`ZebraOptions.body`), with these defaults:

```ts
{
  maxSize: 1024 * 1024,              // 1MB — shared cap for body()/json()/text()/form()
  json: { limit: 1024 * 1024 },      // 1MB
  form: { limit: 1024 * 1024 },      // 1MB
  multipart: { limit: 16 * 1024 * 1024, maxFiles: 10, maxFileSize: 8 * 1024 * 1024 },
}
```

`Bun.serve`'s `maxRequestBodySize` (`ListenOptions`, default 128MB) is a separate transport-level cap that runs before any handler.

```ts
const z = new Zebra({
  body: { json: { limit: 256 * 1024 }, multipart: { maxFiles: 4 } },
});
```

## Response helpers

From `@zebra/core` (also re-exported by the `zebra` facade). Default content-type / status:

| Helper | Default content-type | Default status |
| --- | --- | --- |
| `json(value)` | `application/json; charset=utf-8` | 200 (`undefined` → 204) |
| `text(value)` | `text/plain; charset=utf-8` | 200 |
| `html(value)` | `text/html; charset=utf-8` | 200 |
| `stream(body)` | `application/octet-stream` | 200 |
| `redirect(url)` | — (no body) | 302 |

```ts
import { html, json, redirect, stream, text } from "zebra";

z.get("/api", () => json({ ok: true }));
// json(undefined) has no JSON representation → empty 204, mirroring the
// handler semantics where `undefined` produces a 204.
z.get("/plain", () => text("hello"));          // unquoted raw text
z.get("/page", () => html("<h1>Hi</h1>"));
z.get("/dl", () => stream(Bun.file("./x.bin")));
z.get("/old", () => redirect("/new"));         // or { status: 301 }
```

Rules:

- A `content-type` in `init.headers` (any header form: record / array / `Headers`) always wins over the default.
- `redirect`'s `Location` always comes from the `url` argument; status defaults to 302, overridable via `init.status` (e.g. 301).
- `stream` accepts a `ReadableStream` (SSE, chunked), a `Blob` (`Bun.file()` is a `BunFile`), an `ArrayBuffer`, or a typed array.

## HttpError and Problem+Json

### Throwing structured errors

```ts
import { HttpError } from "zebra";

throw new HttpError(404, "board_not_found", "No such board");
throw new HttpError(429, "rate_limit_exceeded", "Too Many Requests", { limit: 10 }, {
  "retry-after": "60",
});
```

```ts
class HttpError extends Error {
  constructor(
    status: number,        // 400–599 (anything else throws RangeError)
    code: string,          // machine-readable error code
    title: string,         // human-readable title
    detail?: unknown,      // extra detail (JSON-safe serialization)
    headers?: Record<string, string>, // copied onto the response
  );
}
```

The built-in error middleware converts it to:

```json
{
  "type": "https://errors.zebra.dev/rate_limit_exceeded",
  "status": 429,
  "title": "Too Many Requests",
  "detail": { "limit": 10 },
  "instance": "/api/posts"
}
```

`err.headers` are copied verbatim onto the response. (Built-in error codes beyond `HttpError` — see the table below.)

### ValidationError

`@zebra/core`'s `ValidationError` carries `ValidationIssue[]` (`path` + `message`) and renders as a 422 Problem+Json with an `errors` array listing each field. Contract `app.implement` input-validation failures use this shape.

### Built-in error codes

| code | status | trigger |
| --- | --- | --- |
| `not_found` | 404 | no path match |
| `method_not_allowed` | 405 | path exists, method doesn't (with `Allow` header) |
| `invalid_json` | 400 | `json()` on invalid JSON |
| `validation_failed` | 422 | `ValidationError` |
| `request_timeout` | 504 | `requestTimeout` fired (`detail.limit` = ms) |
| `invalid_contract_response` | 500 | contract declares 204 but the handler returned a `Response` |
| `output_validation_failed` | 500 | contract output validation failed |
| `internal` | 500 | unrecognized error |

With `exposeStack: true`, unknown errors (not HttpError/ValidationError) include a `stack` field.

## Static files

`app.static(routePath, root, opts)` — see the [Routing guide](02-routing.md#static-files-appstatic). Key points:

- Path traversal and symlink-escape protection (realpath containment check, 403).
- Dotfiles are denied by default (any decoded segment starting with `.` → 403); opt out per mount with `dotfiles: "allow"`.
- Weak ETags, `If-None-Match` → 304, `Range` → 206 / 416.
- `index` (default `index.html`), `maxAge` (default 3600), `cacheTtl` (default 1000ms metadata cache).

## Request timeout

`ZebraOptions.requestTimeout` (ms) sets a per-request deadline:

```ts
const z = new Zebra({ requestTimeout: 5_000 });
```

- When it fires, the request is aborted and the client receives a 504 `request_timeout` (Problem+Json, `detail.limit` = ms).
- Handlers can listen for `abort` on `req.signal` to stop background work early; the signal also fires on client disconnect (from Bun's raw `Request.signal`).
- Background work is not killed by the timeout (it keeps running), but can observe cancellation via `req.signal`. Opt-in: unset means no deadline and no abort wiring.

## Next steps

- [Middleware: how the pipeline processes requests/responses](04-middleware.md)
- [Structured errors meeting contract validation](11-contract-first.md)
- [Static files and production deployment](15-production.md)
