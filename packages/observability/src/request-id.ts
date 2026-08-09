import type { Middleware } from "@zebra/core";

/** `req.ctx` key under which the request id is stored. */
export const REQUEST_ID_KEY: symbol = Symbol("zebra.requestId");

export interface RequestIdOptions {
  /** Incoming header name. Default `"x-request-id"`. */
  headerName?: string;
  /** Generates an id when the incoming header is absent. Default `crypto.randomUUID`. */
  generator?: () => string;
  /** Echo the id on the response header. Default `true`. */
  propagate?: boolean;
}

const DEFAULT_HEADER = "x-request-id";

/** Reads the request id previously stored by the `requestId` middleware. */
export function getRequestId(req: { ctx: Map<symbol, unknown> }): string | undefined {
  const id = req.ctx.get(REQUEST_ID_KEY);
  return typeof id === "string" ? id : undefined;
}

/**
 * Request id middleware: keeps a client-provided `x-request-id` (or the
 * configured header) or generates one, stores it on `req.ctx` (readable via
 * `getRequestId`) and echoes it on the response header when `propagate` is on.
 *
 * Register it first so later middlewares (access log, error reporter, metrics)
 * can correlate on the id via `getRequestId`.
 */
export function requestId(options: RequestIdOptions = {}): Middleware {
  const headerName = options.headerName ?? DEFAULT_HEADER;
  const generator = options.generator ?? (() => crypto.randomUUID());
  const propagate = options.propagate ?? true;

  return async (req, next) => {
    const incoming = req.headers.get(headerName);
    const id = incoming === null || incoming === "" ? generator() : incoming;
    req.ctx.set(REQUEST_ID_KEY, id);
    const res = await next();
    if (!propagate) return res;
    const headers = new Headers(res.headers);
    if (!headers.has(headerName)) headers.set(headerName, id);
    return new Response(res.body, { status: res.status, statusText: res.statusText, headers });
  };
}
