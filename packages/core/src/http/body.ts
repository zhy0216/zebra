import { HttpError } from "./errors.ts";

export interface BodyOptions {
  maxSize: number;
  json: { limit: number };
  form: { limit: number };
  multipart: { limit: number; maxFiles: number; maxFileSize: number };
}

const decoder = new TextDecoder();

function effectiveLimit(opts: BodyOptions, contentType: string): number {
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

async function readBody(req: Request, limit: number): Promise<Uint8Array> {
  assertDeclaredSize(req, limit);
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
  const ct = (req.headers.get("content-type") ?? "").toLowerCase();
  const bytes = await readBody(req, effectiveLimit(opts, ct));

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

  if (ct.startsWith("multipart/form-data")) {
    try {
      const parsedRequest = new Request(req.url, {
        method: req.method,
        headers: req.headers,
        body: bytes,
      });
      const form = await parsedRequest.formData();
      let files = 0;
      for (const value of form.values()) {
        if (value instanceof File) {
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
      return form;
    } catch (error) {
      if (error instanceof HttpError) throw error;
      throw new HttpError(400, "invalid_multipart", "Body is not valid multipart form data");
    }
  }

  return bytes;
}
