import type { Middleware } from "@zebra/core";

import { DEFAULT_ORIGIN, resolveAllowOrigin } from "./origin.ts";

export type CorsOrigin = string | string[] | RegExp | ((origin: string) => boolean);

export interface CorsOptions {
  /** Allowed origins; default `*` (any origin). */
  origin?: CorsOrigin;
  /** Reflect credentials. When true the origin is echoed exactly, never `*`. */
  credentials?: boolean;
  /** Methods advertised in preflight; default the common set. */
  methods?: string[];
  /** Headers advertised in preflight; default echoes `Access-Control-Request-Headers`. */
  allowedHeaders?: string[];
  /** Response headers exposed to the browser. */
  exposedHeaders?: string[];
  /** Preflight cache TTL in seconds. */
  maxAge?: number;
}

const DEFAULT_METHODS = ["GET", "HEAD", "POST", "PUT", "PATCH", "DELETE", "OPTIONS"];

const PREFLIGHT_REQUEST_HEADERS = "access-control-request-headers";

// C2: preflight handling.
//
// An `OPTIONS` request carrying `Access-Control-Request-Method` is a CORS
// preflight: verify the origin and answer 204 with the full header set the
// browser will enforce. A disallowed origin gets the plain 204 *without* any
// CORS header — the browser then blocks the actual request on its side (no
// 403 needed). Other `OPTIONS` requests (no ACRM header) pass through; C3
// injects headers on the actual-request path below.
export function cors(opts: CorsOptions = {}): Middleware {
  const credentials = opts.credentials ?? false;
  const methods = opts.methods ?? DEFAULT_METHODS;
  const allowedHeaders = opts.allowedHeaders;
  const exposedHeaders = opts.exposedHeaders;
  const maxAge = opts.maxAge;
  const origin = opts.origin ?? DEFAULT_ORIGIN;

  return async (req, next) => {
    const isPreflight =
      req.headers.get("access-control-request-method") !== null && req.raw?.method === "OPTIONS";
    if (isPreflight) {
      const reflected = resolveAllowOrigin(req.headers.get("origin"), origin, credentials);
      if (reflected === null) {
        // The rejection decision depends on the Origin: a shared cache must
        // never reuse this 204 for a different origin (cache poisoning).
        return new Response(null, { status: 204, headers: { vary: "Origin" } });
      }

      const headers = new Headers();
      headers.set("access-control-allow-origin", reflected);
      // A concrete echoed origin must be matched per-request; `*` needs no Vary.
      if (reflected !== "*") headers.set("vary", "Origin");
      if (credentials) headers.set("access-control-allow-credentials", "true");
      headers.set("access-control-allow-methods", methods.join(", "));
      const requested = req.headers.get(PREFLIGHT_REQUEST_HEADERS);
      if (allowedHeaders !== undefined) {
        headers.set("access-control-allow-headers", allowedHeaders.join(", "));
      } else if (requested !== null) {
        headers.set("access-control-allow-headers", requested);
      }
      if (maxAge !== undefined) headers.set("access-control-max-age", String(maxAge));
      return new Response(null, { status: 204, headers });
    }

    // C3: actual-request header injection.
    //
    // Only a request carrying a *matching* Origin is cross-origin and gets
    // CORS headers; no Origin header (same-origin / non-browser) or a
    // disallowed origin passes the response through untouched. The handler's
    // response is wrapped, never mutated, so its body/status semantics are
    // preserved (see the session package's appendSetCookie pattern).
    const reflected = resolveAllowOrigin(req.headers.get("origin"), origin, credentials);
    if (reflected === null) return next();

    const res = await next();
    const headers = new Headers(res.headers);
    headers.set("access-control-allow-origin", reflected);
    // A concrete echoed origin must be matched per-request; `*` needs no Vary.
    // Append rather than set: a handler-supplied Vary must be preserved.
    if (reflected !== "*") headers.append("vary", "Origin");
    if (credentials) headers.set("access-control-allow-credentials", "true");
    if (exposedHeaders !== undefined) {
      headers.set("access-control-expose-headers", exposedHeaders.join(", "));
    }
    return new Response(res.body, {
      status: res.status,
      statusText: res.statusText,
      headers,
    });
  };
}
