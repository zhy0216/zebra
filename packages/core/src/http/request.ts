import { type BodyOptions, parseBody } from "./body.ts";

export interface ZebraRequest<P = Record<string, string>, Q = Record<string, string>> {
  raw: Request;
  params: P;
  query: Q;
  headers: Headers;
  url: URL;
  body: () => Promise<unknown>;
  ctx: Map<symbol, unknown>;
}

const DEFAULT_BODY: BodyOptions = {
  maxSize: 1024 * 1024,
  json: { limit: 1024 * 1024 },
  form: { limit: 1024 * 1024 },
  multipart: { limit: 16 * 1024 * 1024, maxFiles: 10, maxFileSize: 8 * 1024 * 1024 },
};

export function buildRequest<P>(
  raw: Request,
  params: P,
  bodyOpts: BodyOptions = DEFAULT_BODY,
): ZebraRequest<P> {
  const url = new URL(raw.url);
  const query: Record<string, string> = {};
  for (const [k, v] of url.searchParams) query[k] = v;
  let bodyCache: { v: unknown } | null = null;
  return {
    raw,
    params,
    query,
    headers: raw.headers,
    url,
    body: async () => {
      if (bodyCache) return bodyCache.v;
      const v = await parseBody(raw, bodyOpts);
      bodyCache = { v };
      return v;
    },
    ctx: new Map(),
  };
}
