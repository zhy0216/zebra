import {
  type BodyOptions,
  effectiveLimit,
  limitStream,
  parseBody,
  parseForm,
  readBody,
} from "./body.ts";
import { HttpError } from "./errors.ts";

export interface ZebraRequest<P = Record<string, string>, B = unknown, Q = Record<string, string>> {
  raw: Request;
  params: P;
  query: Q;
  headers: Headers;
  url: URL;
  body: () => Promise<B>;
  /**
   * Parses the body as JSON regardless of content-type. Lazy + memoized:
   * the body is buffered once (the same per-content-type `body` limits
   * apply) and shared with `text()` / `form()`. Empty body → `null`;
   * invalid JSON → 400 `invalid_json` `HttpError`. The body stream is
   * single-consumption: call exactly one of `body()` / `json()` /
   * `text()` / `form()` / `stream()`.
   */
  json: () => Promise<unknown>;
  /** Raw body text. Lazy + memoized (shares the buffered bytes with `json()` / `form()`). */
  text: () => Promise<string>;
  /**
   * Body as `FormData`: multipart → parsed with `File` entries (enforces
   * `maxFiles` / `maxFileSize`), urlencoded → string entries, any other
   * content-type → empty `FormData`. Lazy + memoized (shares the buffered
   * bytes with `json()` / `text()`).
   */
  form: () => Promise<FormData>;
  /**
   * The raw body `ReadableStream`, piped through the same app-level size
   * limit (`limitStream`) — the non-buffering path for large uploads.
   * Not memoized: it consumes the stream, so it cannot be combined with the
   * buffering helpers, and when the limit trips the error surfaces when the
   * stream is read.
   */
  stream: () => ReadableStream<Uint8Array>;
  ctx: Map<symbol, unknown>;
  /**
   * The socket peer address of the request, from Bun's `server.requestIP(req)`.
   * Never derived from headers — `x-forwarded-for` is only trusted via
   * explicit configuration (see `@zebra/rate-limit`'s `trustProxy`).
   * `undefined` when dispatched directly without a Bun server (e.g.
   * `app.dispatch()` in tests).
   */
  ip?: string;
  /**
   * The abort signal for this request. When `ZebraOptions.requestTimeout` is
   * configured it combines Bun's raw `Request.signal` (aborts when the
   * client disconnects) with the deadline abort (its `reason` is the 504
   * `HttpError`). Without a timeout it is `req.raw.signal` itself. Listen to
   * `abort` to stop background work early.
   */
  signal: AbortSignal;
}

const DEFAULT_BODY: BodyOptions = {
  maxSize: 1024 * 1024,
  json: { limit: 1024 * 1024 },
  form: { limit: 1024 * 1024 },
  multipart: { limit: 16 * 1024 * 1024, maxFiles: 10, maxFileSize: 8 * 1024 * 1024 },
};

export function buildRequest<P, B = unknown>(
  raw: Request,
  params: P,
  bodyOpts: BodyOptions = DEFAULT_BODY,
  ip?: string,
  signal?: AbortSignal,
): ZebraRequest<P, B> {
  const url = new URL(raw.url);
  const query = Object.create(null) as Record<string, string>;
  for (const [k, v] of url.searchParams) query[k] = v;
  let bodyPromise: Promise<B> | null = null;
  let bytesPromise: Promise<Uint8Array> | null = null;
  let jsonPromise: Promise<unknown> | null = null;
  let textPromise: Promise<string> | null = null;
  let formPromise: Promise<FormData> | null = null;
  const contentType = raw.headers.get("content-type") ?? "";
  const ct = contentType.toLowerCase();
  // Buffers the body once (limits enforced) and lets `json` / `text` / `form`
  // derive from the same bytes: the raw stream is single-consumption.
  const bytes = (): Promise<Uint8Array> => {
    bytesPromise ??= readBody(raw, effectiveLimit(bodyOpts, ct));
    return bytesPromise;
  };
  return {
    raw,
    params,
    query,
    headers: raw.headers,
    url,
    ...(ip === undefined ? {} : { ip }),
    signal: signal ?? raw.signal,
    body: () => {
      bodyPromise ??= parseBody(raw, bodyOpts) as Promise<B>;
      return bodyPromise;
    },
    json: () => {
      jsonPromise ??= bytes().then((body) => {
        try {
          const text = decoder.decode(body);
          return text === "" ? null : JSON.parse(text);
        } catch (error) {
          if (error instanceof HttpError) throw error;
          throw new HttpError(400, "invalid_json", "Body is not valid JSON");
        }
      });
      return jsonPromise;
    },
    text: () => {
      textPromise ??= bytes().then((body) => decoder.decode(body));
      return textPromise;
    },
    form: () => {
      formPromise ??= bytes().then((body) => parseForm(body, bodyOpts, contentType));
      return formPromise;
    },
    stream: () => {
      if (!raw.body) {
        return new ReadableStream<Uint8Array>({
          start(controller) {
            controller.close();
          },
        });
      }
      return raw.body.pipeThrough(limitStream(effectiveLimit(bodyOpts, ct)));
    },
    ctx: new Map(),
  };
}

const decoder = new TextDecoder();
