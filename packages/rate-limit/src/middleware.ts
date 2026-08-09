// C1: `rateLimit()` factory — signature only. The middleware body is a
// pass-through stub; enforcement lands in C3 (429 + X-RateLimit-* headers,
// RFC 9457 Problem+Json via `HttpError`) on top of the C2 fixed-window
// counting.
//
// Default key derivation (client IP). Trade-off: core's `ZebraRequest`
// exposes no socket/peer address (`packages/core/src/http/request.ts` only
// carries `raw: Request` plus parsed fields), so the client IP can only come
// from the `x-forwarded-for` header — `req.remoteAddress` does not exist.
// That header is client-spoofable unless the deployment's edge proxy
// (reverse proxy / CDN / load balancer) overwrites it, so the default is only
// safe behind a trusted proxy that sets `x-forwarded-for`; it takes the
// leftmost entry (the address appended by the client's first hop, i.e. the
// peer as seen by the edge). Requests without the header share the
// `anonymous` key rather than being exempt from limiting.

import type { Middleware, ZebraRequest } from "@zebra/core";

import type { RateLimitStore } from "./store.ts";

export interface RateLimitOptions {
  /** Window length in milliseconds. Required. */
  windowMs: number;
  /** Maximum requests per key per window. Required. */
  max: number;
  /**
   * Derives the rate-limit key for a request. May be async. Default: the
   * client IP from `x-forwarded-for` (see module comment for the trade-off).
   */
  keyBy?: (req: ZebraRequest) => string | Promise<string>;
  /** Pluggable counter storage. Defaults to `MemoryStore({ windowMs })` (C2). */
  store?: RateLimitStore;
}

const DEFAULT_KEY = "anonymous";

/** Leftmost entry of `x-forwarded-for` (the client as seen by the edge proxy). */
function clientIp(req: { headers: Headers }): string {
  const forwarded = req.headers.get("x-forwarded-for");
  if (forwarded === null || forwarded === "") return DEFAULT_KEY;
  const first = forwarded.split(",")[0]?.trim();
  return first === undefined || first === "" ? DEFAULT_KEY : first;
}

export function rateLimit(options: RateLimitOptions): Middleware {
  if (typeof options.windowMs !== "number" || options.windowMs <= 0) {
    throw new Error("rateLimit: windowMs must be a positive number");
  }
  if (typeof options.max !== "number" || options.max <= 0) {
    throw new Error("rateLimit: max must be a positive number");
  }
  const keyBy = options.keyBy ?? clientIp;
  // C3: fixed-window enforcement — default store `MemoryStore({ windowMs })`,
  // per-key increment via `store.increment(key, windowMs)` with `keyBy`
  // (above), 429 on `count > max` with `Retry-After`, `X-RateLimit-*` headers
  // injected on the response path (after hook, without swallowing handler
  // exceptions).
  void keyBy; // consumed by the C3 enforcement below
  return async (_req, next) => next();
}
