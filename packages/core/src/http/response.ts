/**
 * Lightweight `Response` constructors for handlers.
 *
 * Default content-type / status rules:
 *
 * | Helper     | Default `content-type`          | Default status |
 * | ---------- | ------------------------------- | -------------- |
 * | `json()`   | `application/json; charset=utf-8` | 200          |
 * | `text()`   | `text/plain; charset=utf-8`     | 200            |
 * | `html()`   | `text/html; charset=utf-8`      | 200            |
 * | `stream()` | `application/octet-stream`      | 200            |
 * | `redirect()`| — (no body)                    | 302            |
 *
 * `init.headers` (any header form: record, array or `Headers`) always wins
 * over the default `content-type`. For `redirect()`, `Location` always comes
 * from the `url` argument.
 *
 * These helpers are the explicit escape hatches from the framework's default
 * value encoding: a handler returning a non-`Response` value is
 * `JSON.stringify`d by `Zebra.toResponse` — including plain strings and
 * `null` — with status 200 (frozen v1 behavior). Return `undefined` from a
 * handler for an empty 204. A raw `Response` returned from a handler is
 * passed through unchanged.
 */

/**
 * Merges `init.headers` (any header form; the runtime accepts undici's
 * `Headers`) with the default `content-type`, which always loses to an
 * explicit one.
 */
function withHeaders(init: ResponseInit, contentType: string): Headers {
  const headers = new Headers(init.headers as Bun.HeadersInit | undefined);
  if (!headers.has("content-type")) headers.set("content-type", contentType);
  return headers;
}

/** JSON body with `application/json; charset=utf-8`, status 200. */
export function json(value: unknown, init: ResponseInit = {}): Response {
  return new Response(JSON.stringify(value), {
    ...init,
    headers: withHeaders(init, "application/json; charset=utf-8"),
  });
}

/** Plain text body with `text/plain; charset=utf-8`, status 200. */
export function text(value: string, init: ResponseInit = {}): Response {
  return new Response(value, { ...init, headers: withHeaders(init, "text/plain; charset=utf-8") });
}

/** HTML body with `text/html; charset=utf-8`, status 200. */
export function html(value: string, init: ResponseInit = {}): Response {
  return new Response(value, { ...init, headers: withHeaders(init, "text/html; charset=utf-8") });
}

/**
 * Redirect (no body) with `Location` set from `url`, status 302 unless
 * overridden via `init.status` (e.g. 301).
 */
export function redirect(url: string | URL, init: ResponseInit = {}): Response {
  const headers = new Headers(init.headers as Bun.HeadersInit | undefined);
  headers.set("location", url instanceof URL ? url.href : url);
  return new Response(null, { ...init, status: init.status ?? 302, headers });
}

/**
 * Streaming / binary body (a `ReadableStream` for SSE, chunked data or
 * `Bun.file(path)` — `BunFile` is a `Blob` — or an already-materialized
 * `Blob` / `ArrayBuffer` / typed array). Defaults to
 * `application/octet-stream`; override via `init.headers`, status 200.
 */
export function stream(
  body: ReadableStream<Uint8Array> | Blob | ArrayBuffer | ArrayBufferView,
  init: ResponseInit = {},
): Response {
  return new Response(body as Bun.BodyInit, {
    ...init,
    headers: withHeaders(init, "application/octet-stream"),
  });
}
