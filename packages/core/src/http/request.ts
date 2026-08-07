import { type BodyOptions, parseBody } from "./body.ts";

export interface ZebraRequest<P = Record<string, string>, B = unknown, Q = Record<string, string>> {
  raw: Request;
  params: P;
  query: Q;
  headers: Headers;
  url: URL;
  body: () => Promise<B>;
  ctx: Map<symbol, unknown>;
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
): ZebraRequest<P, B> {
  const url = new URL(raw.url);
  const query: Record<string, string> = {};
  for (const [k, v] of url.searchParams) query[k] = v;
  let bodyPromise: Promise<B> | null = null;
  return {
    raw,
    params,
    query,
    headers: raw.headers,
    url,
    body: () => {
      bodyPromise ??= parseBody(raw, bodyOpts) as Promise<B>;
      return bodyPromise;
    },
    ctx: new Map(),
  };
}
