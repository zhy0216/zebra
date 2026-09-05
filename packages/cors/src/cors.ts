import type { Middleware } from "@zebra-web/core";

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

function mergeVary(headers: Headers, field: string): void {
  const fields: string[] = [];
  const seen = new Set<string>();
  for (const entry of [...(headers.get("vary") ?? "").split(","), field]) {
    const value = entry.trim();
    if (value === "*") {
      headers.set("vary", "*");
      return;
    }
    const key = value.toLowerCase();
    if (value !== "" && !seen.has(key)) {
      seen.add(key);
      fields.push(value);
    }
  }
  headers.set("vary", fields.join(", "));
}

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
  const variesByOrigin = origin !== DEFAULT_ORIGIN || credentials;

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
      if (variesByOrigin) mergeVary(headers, "Origin");
      if (credentials) headers.set("access-control-allow-credentials", "true");
      headers.set("access-control-allow-methods", methods.join(", "));
      const requested = req.headers.get(PREFLIGHT_REQUEST_HEADERS);
      if (allowedHeaders !== undefined) {
        headers.set("access-control-allow-headers", allowedHeaders.join(", "));
      } else {
        // The absent-header response is a variant too: a cache must not
        // reuse it for a later request asking to send additional headers.
        mergeVary(headers, "Access-Control-Request-Headers");
        if (requested !== null) headers.set("access-control-allow-headers", requested);
      }
      if (maxAge !== undefined) headers.set("access-control-max-age", String(maxAge));
      return new Response(null, { status: 204, headers });
    }

    // C3: actual-request header injection.
    //
    // Only matching origins receive Access-Control headers. When the policy
    // varies by origin, every variant (including denied or absent Origin)
    // declares Vary so a cached response cannot suppress a later allowance.
    // Wrap the handler response to preserve its body/status and headers.
    const reflected = resolveAllowOrigin(req.headers.get("origin"), origin, credentials);
    if (reflected === null && !variesByOrigin) return next();

    const res = await next();
    const headers = new Headers(res.headers);
    if (variesByOrigin) mergeVary(headers, "Origin");
    if (reflected !== null) {
      headers.set("access-control-allow-origin", reflected);
      if (credentials) headers.set("access-control-allow-credentials", "true");
      if (exposedHeaders !== undefined) {
        headers.set("access-control-expose-headers", exposedHeaders.join(", "));
      }
    }
    return new Response(res.body, {
      status: res.status,
      statusText: res.statusText,
      headers,
    });
  };
}
