import { HttpError } from "./errors.ts";

/**
 * App-level request body limits, enforced inside the body parser when
 * `req.body()` is read. These are independent of — and composed with — Bun's
 * transport-level `maxRequestBodySize` (`listen({ maxRequestBodySize })`):
 *
 * - Transport (Bun): rejects the request *before* any handler runs when the
 *   declared/streamed size exceeds `maxRequestBodySize`; the response is a
 *   bare 413 without a Problem+Json body. Default 128MB.
 * - App (here): rejects inside `parseBody` with a 413 Problem+Json
 *   (`payload_too_large`), enforced per content-type (`json.limit`,
 *   `form.limit`, `multipart.limit`/`maxFiles`/`maxFileSize`) and capped by
 *   `maxSize`, via content-length and while streaming.
 *
 * Both layers answer 413. Keep `maxRequestBodySize` ≥ the largest app limit
 * so the app parser's more specific per-type limits stay authoritative;
 * otherwise the transport limit wins first and truncates large uploads into
 * a bare 413 before the parser can produce its structured error. App limits
 * work regardless of the transport limit.
 */
export interface BodyOptions {
  maxSize: number;
  json: { limit: number };
  form: { limit: number };
  multipart: { limit: number; maxFiles: number; maxFileSize: number };
}

const decoder = new TextDecoder();

export function effectiveLimit(opts: BodyOptions, contentType: string): number {
  if (contentType.startsWith("application/json")) return Math.min(opts.maxSize, opts.json.limit);
  if (contentType.startsWith("application/x-www-form-urlencoded")) {
    return Math.min(opts.maxSize, opts.form.limit);
  }
  if (contentType.startsWith("multipart/form-data")) {
    return Math.min(opts.maxSize, opts.multipart.limit);
  }
  return opts.maxSize;
}

function assertDeclaredSize(req: Request, limit: number): void {
  const value = req.headers.get("content-length");
  if (value === null) return;
  const length = Number(value);
  if (!Number.isFinite(length) || length < 0) {
    throw new HttpError(400, "invalid_content_length", "Invalid Content-Length header");
  }
  if (length > limit) {
    throw new HttpError(413, "payload_too_large", "Payload too large", { limit });
  }
}

export async function readBody(req: Request, limit: number): Promise<Uint8Array> {
  assertDeclaredSize(req, limit);
  if (req.bodyUsed) throw new TypeError("Request body has already been consumed");
  if (!req.body) return new Uint8Array();

  const reader = req.body.getReader();
  const chunks: Uint8Array[] = [];
  let size = 0;

  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      size += value.byteLength;
      if (size > limit) {
        await reader.cancel();
        throw new HttpError(413, "payload_too_large", "Payload too large", { limit });
      }
      chunks.push(value);
    }
  } finally {
    reader.releaseLock();
  }

  const result = new Uint8Array(size);
  let offset = 0;
  for (const chunk of chunks) {
    result.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return result;
}

export async function parseBody(req: Request, opts: BodyOptions): Promise<unknown> {
  const contentType = req.headers.get("content-type") ?? "";
  const bytes = await readBody(req, effectiveLimit(opts, contentType.toLowerCase()));
  return parseBufferedBody(bytes, opts, contentType);
}

/** Internal: content-type parsing after the shared, size-limited byte read. */
export async function parseBufferedBody(
  bytes: Uint8Array,
  opts: BodyOptions,
  contentType: string,
): Promise<unknown> {
  const ct = contentType.toLowerCase();
  if (ct.startsWith("multipart/form-data")) return parseMultipart(bytes, opts, contentType);
  if (ct.startsWith("application/json")) {
    try {
      const text = decoder.decode(bytes);
      return text === "" ? null : JSON.parse(text);
    } catch (e) {
      if (e instanceof HttpError) throw e;
      throw new HttpError(400, "invalid_json", "Body is not valid JSON");
    }
  }

  if (ct.startsWith("application/x-www-form-urlencoded")) {
    const text = decoder.decode(bytes);
    return Object.fromEntries(new URLSearchParams(text));
  }

  return bytes;
}

async function parseMultipart(bytes: Uint8Array, opts: BodyOptions, contentType: string) {
  try {
    const parsedRequest = new Request("http://x", {
      method: "POST",
      headers: { "content-type": contentType },
      body: bytes,
    });
    const form = await parsedRequest.formData();
    checkForm(form, opts);
    return form as FormData;
  } catch (error) {
    if (error instanceof HttpError) throw error;
    throw new HttpError(400, "invalid_multipart", "Body is not valid multipart form data");
  }
}

/**
 * Parses already-buffered body bytes into a `FormData`: multipart bodies are
 * re-parsed via `Request.formData()` (the buffered bytes preserve the
 * boundary in the content-type; `maxFiles` / `maxFileSize` still apply),
 * urlencoded bodies become string entries, anything else yields an empty
 * `FormData`. Used by `req.form()`; the size limits were already enforced
 * while buffering.
 */
export async function parseForm(
  bytes: Uint8Array,
  opts: BodyOptions,
  contentType: string,
): Promise<FormData> {
  const ct = contentType.toLowerCase();
  if (ct.startsWith("multipart/form-data")) {
    if (bytes.byteLength === 0) return new FormData();
    return parseMultipart(bytes, opts, contentType);
  }
  if (ct.startsWith("application/x-www-form-urlencoded")) {
    const params = new URLSearchParams(decoder.decode(bytes));
    const form = new FormData();
    for (const [key, value] of params) form.append(key, value);
    return form;
  }
  return new FormData();
}

function checkForm(form: { values(): IterableIterator<unknown> }, opts: BodyOptions): void {
  let files = 0;
  for (const value of form.values()) {
    // `Request.formData()` yields undici's `FormDataEntryValue`; the runtime
    // value is Bun's global `File`, so the instanceof check applies.
    if (value !== null && typeof value === "object" && value instanceof File) {
      files++;
      if (files > opts.multipart.maxFiles) {
        throw new HttpError(413, "too_many_files", "Too many uploaded files", {
          limit: opts.multipart.maxFiles,
        });
      }
      if (value.size > opts.multipart.maxFileSize) {
        throw new HttpError(413, "file_too_large", "Uploaded file is too large", {
          limit: opts.multipart.maxFileSize,
          file: value.name,
        });
      }
    }
  }
}

export function limitStream(limit: number): TransformStream<Uint8Array, Uint8Array> {
  let size = 0;
  return new TransformStream<Uint8Array, Uint8Array>({
    transform(chunk, controller) {
      size += chunk.byteLength;
      if (size > limit) {
        // Erroring the stream with the HttpError (spec-equal to
        // `controller.error`) delivers the 413 to the consumer's read()
        // as a clean rejection.
        throw new HttpError(413, "payload_too_large", "Payload too large", { limit });
      }
      controller.enqueue(chunk);
    },
  });
}
