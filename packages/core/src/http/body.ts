import { HttpError } from "./errors.ts";

export interface BodyOptions {
  maxSize: number;
  json: { limit: number };
  form: { limit: number };
  multipart: { limit: number; maxFiles: number; maxFileSize: number };
}

export async function parseBody(req: Request, opts: BodyOptions): Promise<unknown> {
  const len = Number(req.headers.get("content-length") ?? "0");
  if (len > opts.maxSize) {
    throw new HttpError(413, "payload_too_large", "Payload too large", { limit: opts.maxSize });
  }
  const ct = (req.headers.get("content-type") ?? "").toLowerCase();

  if (ct.startsWith("application/json")) {
    try {
      const text = await req.text();
      if (text.length > opts.json.limit) {
        throw new HttpError(413, "payload_too_large", "JSON body too large");
      }
      return text === "" ? null : JSON.parse(text);
    } catch (e) {
      if (e instanceof HttpError) throw e;
      throw new HttpError(400, "invalid_json", "Body is not valid JSON");
    }
  }

  if (ct.startsWith("application/x-www-form-urlencoded")) {
    const text = await req.text();
    if (text.length > opts.form.limit) {
      throw new HttpError(413, "payload_too_large", "Form body too large");
    }
    return Object.fromEntries(new URLSearchParams(text));
  }

  if (ct.startsWith("multipart/form-data")) {
    return req.formData();
  }

  return req.arrayBuffer();
}
