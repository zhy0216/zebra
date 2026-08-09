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

import { HttpError, type Middleware, type ZebraRequest } from "@zebra/core";

import { checkLimit } from "./limiter.ts";
import { MemoryStore, type RateLimitStore } from "./store.ts";

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

// C3: fixed-window enforcement.
//
// Per request: derive the key via `keyBy`, then one atomic
// `checkLimit(store, key, windowMs, max)` increment. Under the limit the
// handler runs and the response is wrapped with `X-RateLimit-*` headers on
// the way out (the "after hook": `await next()` first, wrap afterwards, so a
// handler exception propagates to core's error middleware untouched — never
// caught, never swallowed). Over the limit `next()` is never called and an
// `HttpError(429)` is thrown instead: core's error middleware
// (`packages/core/src/middleware/error.ts`) turns it into an RFC 9457
// Problem+Json response (`application/problem+json`, `toProblemJson` copies
// `detail`), and it copies `err.headers` verbatim — which is how the
// `Retry-After` plus `X-RateLimit-*` headers ride along on the 429.
//
// Header semantics: `X-RateLimit-Limit` = configured `max`,
// `X-RateLimit-Remaining` = `max - count` floored at 0 (0 on a 429),
// `X-RateLimit-Reset` = window expiry in epoch *seconds*
// (`Math.floor(resetAt / 1000)`), `Retry-After` = seconds until the window
// resets, rounded up and floored at 1.

/** Seconds until `resetAt` (epoch ms), rounded up, never below 1. */
function retryAfterSeconds(resetAt: number): number {
  return Math.max(1, Math.ceil((resetAt - Date.now()) / 1000));
}

function rateLimitHeaders(
  limit: number,
  remaining: number,
  resetAt: number,
): Record<string, string> {
  return {
    "x-rate-limit-limit": String(limit),
    "x-rate-limit-remaining": String(remaining),
    // Epoch seconds — the fixed window expires at `resetAt` ms.
    "x-rate-limit-reset": String(Math.floor(resetAt / 1000)),
  };
}

/** Wraps `res` with extra headers, preserving status/statusText/body. */
function withHeaders(res: Response, headers: Record<string, string>): Response {
  const merged = new Headers(res.headers);
  for (const [name, value] of Object.entries(headers)) merged.set(name, value);
  return new Response(res.body, {
    status: res.status,
    statusText: res.statusText,
    headers: merged,
  });
}

export function rateLimit(options: RateLimitOptions): Middleware {
  if (typeof options.windowMs !== "number" || options.windowMs <= 0) {
    throw new Error("rateLimit: windowMs must be a positive number");
  }
  if (typeof options.max !== "number" || options.max <= 0) {
    throw new Error("rateLimit: max must be a positive number");
  }
  const windowMs = options.windowMs;
  const max = options.max;
  const keyBy = options.keyBy ?? clientIp;
  const store = options.store ?? new MemoryStore({ windowMs });

  return async (req, next) => {
    const key = await keyBy(req);
    const { allowed, remaining, resetAt } = await checkLimit(store, key, windowMs, max);

    // Over the limit: never call `next()`, throw so core's error middleware
    // emits the Problem+Json 429. The headers ride on the HttpError — core
    // copies `err.headers` onto the response — so the 429 also carries
    // `Retry-After` and the `X-RateLimit-*` headers (remaining is 0 here).
    if (!allowed) {
      const retryAfter = retryAfterSeconds(resetAt);
      throw new HttpError(
        429,
        "rate_limit_exceeded",
        "Too Many Requests",
        { limit: max, retryAfterSeconds: retryAfter },
        {
          ...rateLimitHeaders(max, remaining, resetAt),
          "retry-after": String(retryAfter),
        },
      );
    }

    // Under the limit: run the handler, then inject the headers on the
    // response path. A handler exception propagates unchanged — it is never
    // caught here, so core's error middleware still sees the original error.
    const res = await next();
    return withHeaders(res, rateLimitHeaders(max, remaining, resetAt));
  };
}
