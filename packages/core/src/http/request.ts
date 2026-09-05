import {
  type BodyOptions,
  effectiveLimit,
  limitStream,
  parseBufferedBody,
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
   * apply) and shared with `body()` / `text()` / `form()`. Empty body →
   * `null`; invalid JSON → 400 `invalid_json` `HttpError`. These buffering
   * helpers can be combined, but cannot be combined with `stream()`.
   */
  json: () => Promise<unknown>;
  /** Raw body text. Lazy + memoized (shares bytes with `body()` / `json()` / `form()`). */
  text: () => Promise<string>;
  /**
   * Body as `FormData`: multipart → parsed with `File` entries (enforces
   * `maxFiles` / `maxFileSize`), urlencoded → string entries, any other
   * content-type → empty `FormData`. Lazy + memoized (shares the buffered
   * bytes with `body()` / `json()` / `text()`).
   */
  form: () => Promise<FormData>;
  /**
   * The raw body `ReadableStream`, piped through the same app-level size
   * limit (`limitStream`) — the non-buffering path for large uploads.
   * Not memoized: it consumes the stream, so it cannot be combined with the
   * buffering helpers, and when the limit trips the error surfaces when the
   * stream is read. Repeated calls or mixing with buffering helpers throws
   * a `TypeError` (buffering helpers return a rejected promise).
   */
  stream: () => ReadableStream<Uint8Array>;
  ctx: Map<symbol, unknown>;
  /**
   * The socket peer address of the request, from Bun's `server.requestIP(req)`.
   * Never derived from headers — `x-forwarded-for` is only trusted via
   * explicit configuration (see `@zebra-web/rate-limit`'s `trustProxy`).
   * `undefined` when dispatched directly without a Bun server (e.g.
   * `app.dispatch()` in tests).
   */
  ip?: string | undefined;
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

/**
 * Internal implementation: methods live on the prototype so a request costs
 * one allocation instead of one plus a closure per body helper. The frozen
 * surface is the `ZebraRequest` interface / `buildRequest` signature.
 */
class ZebraRequestImpl<P, B> implements ZebraRequest<P, B> {
  readonly raw: Request;
  readonly params: P;
  readonly headers: Headers;
  readonly url: URL;
  readonly signal: AbortSignal;
  private readonly bodyOpts: BodyOptions;
  private readonly contentType: string;
  private readonly ct: string;
  private readonly getIp: (() => string | undefined) | undefined;
  private queryValue: Record<string, string> | null = null;
  private ctxValue: Map<symbol, unknown> | null = null;
  private ipValue: string | undefined;
  private ipResolved: boolean;
  private bodyPromise: Promise<B> | null = null;
  private bytesPromise: Promise<Uint8Array> | null = null;
  private jsonPromise: Promise<unknown> | null = null;
  private textPromise: Promise<string> | null = null;
  private formPromise: Promise<FormData> | null = null;
  private streamClaimed = false;
  private bodyReadFailed = false;

  constructor(
    raw: Request,
    params: P,
    bodyOpts: BodyOptions,
    ip: string | undefined,
    signal: AbortSignal | undefined,
    url: URL | undefined,
    getIp: (() => string | undefined) | undefined,
  ) {
    this.raw = raw;
    this.params = params;
    this.bodyOpts = bodyOpts;
    this.headers = raw.headers;
    this.url = url ?? new URL(raw.url);
    this.signal = signal ?? raw.signal;
    this.contentType = raw.headers.get("content-type") ?? "";
    this.ct = this.contentType.toLowerCase();
    this.ipValue = ip;
    this.ipResolved = ip !== undefined;
    this.getIp = getIp;
  }

  /** Lazy: built from `url.searchParams` on first access; assignment (the
   * contract pipeline writes the coerced value back) replaces it. */
  get query(): Record<string, string> {
    if (this.queryValue === null) {
      const built = Object.create(null) as Record<string, string>;
      for (const [k, v] of this.url.searchParams) built[k] = v;
      this.queryValue = built;
    }
    return this.queryValue;
  }

  set query(value: Record<string, string>) {
    this.queryValue = value;
  }

  /** Lazy: the vast majority of requests never attach middleware state. */
  get ctx(): Map<symbol, unknown> {
    if (this.ctxValue === null) this.ctxValue = new Map();
    return this.ctxValue;
  }

  /** Lazy: `server.requestIP` is a native call that most requests never need. */
  get ip(): string | undefined {
    if (!this.ipResolved) {
      this.ipValue = this.getIp?.();
      this.ipResolved = true;
    }
    return this.ipValue;
  }

  body(): Promise<B> {
    this.bodyPromise ??= this.bytes().then(
      (body) => parseBufferedBody(body, this.bodyOpts, this.contentType),
      (error) => {
        if (
          this.bodyReadFailed &&
          this.ct.startsWith("multipart/form-data") &&
          !(error instanceof HttpError)
        ) {
          throw new HttpError(400, "invalid_multipart", "Body is not valid multipart form data");
        }
        throw error;
      },
    ) as Promise<B>;
    return this.bodyPromise;
  }

  json(): Promise<unknown> {
    this.jsonPromise ??= this.bytes().then((body) => {
      try {
        const text = decoder.decode(body);
        return text === "" ? null : JSON.parse(text);
      } catch (error) {
        if (error instanceof HttpError) throw error;
        throw new HttpError(400, "invalid_json", "Body is not valid JSON");
      }
    });
    return this.jsonPromise;
  }

  text(): Promise<string> {
    this.textPromise ??= this.bytes().then((body) => decoder.decode(body));
    return this.textPromise;
  }

  form(): Promise<FormData> {
    this.formPromise ??= this.bytes().then((body) =>
      parseForm(body, this.bodyOpts, this.contentType),
    );
    return this.formPromise;
  }

  stream(): ReadableStream<Uint8Array> {
    if (
      this.streamClaimed ||
      this.bytesPromise !== null ||
      this.raw.bodyUsed ||
      this.raw.body?.locked
    ) {
      throw new TypeError("Request body has already been claimed by another reader");
    }
    this.streamClaimed = true;
    if (!this.raw.body) {
      return new ReadableStream<Uint8Array>({
        start(controller) {
          controller.close();
        },
      });
    }
    return this.raw.body.pipeThrough(limitStream(effectiveLimit(this.bodyOpts, this.ct)));
  }

  /** Buffers once with limits; all buffering helpers share the pending read,
   * bytes, and read failures. Streaming claims the raw body exclusively. */
  private bytes(): Promise<Uint8Array> {
    this.bytesPromise ??= this.streamClaimed
      ? Promise.reject(new TypeError("Request body has already been claimed by stream()"))
      : readBody(this.raw, effectiveLimit(this.bodyOpts, this.ct), () => {
          this.bodyReadFailed = true;
        });
    return this.bytesPromise;
  }
}

export function buildRequest<P, B = unknown>(
  raw: Request,
  params: P,
  bodyOpts: BodyOptions = DEFAULT_BODY,
  ip?: string,
  signal?: AbortSignal,
  // Pre-parsed URL from the dispatcher: avoids a second `new URL(raw.url)`
  // per request (the dispatcher needs one for routing anyway).
  url?: URL,
  // Lazy ip resolver (Bun's `server.requestIP`) — only invoked when `ip` is
  // actually read.
  getIp?: () => string | undefined,
): ZebraRequest<P, B> {
  return new ZebraRequestImpl<P, B>(raw, params, bodyOpts, ip, signal, url, getIp);
}

const decoder = new TextDecoder();
