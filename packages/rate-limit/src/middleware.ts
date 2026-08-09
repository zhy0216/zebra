// C1: `rateLimit()` factory — signature only. The middleware body is a
// pass-through stub; enforcement lands in C3 (429 + X-RateLimit-* headers,
// RFC 9457 Problem+Json via `HttpError`) on top of the C2 fixed-window
// counting.
//
// Default key derivation (client IP) — hardened in 07: core's
// `ZebraRequest.ip` carries the real socket peer address from Bun's
// `server.requestIP(req)` (never derived from headers), so by default the
// key is that socket IP, falling back to the shared `anonymous` key when no
// server socket is involved (e.g. `app.dispatch()` in tests).
//
// The `x-forwarded-for` header is only consulted with `trustProxy: true` —
// it is client-spoofable unless the deployment's edge proxy (reverse proxy /
// CDN / load balancer) overwrites it. When trusted, the leftmost entry wins
// (the address appended by the client's first hop, i.e. the peer as seen by
// the edge); requests without the header share the `anonymous` key rather
// than being exempt from limiting. WARNING: with `trustProxy: false`
// (default), spoofed `x-forwarded-for` values do NOT create per-IP buckets —
// every request from the same socket shares one budget.

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
   * socket peer IP (`req.ip`), falling back to the shared `anonymous` key —
   * or the leftmost `x-forwarded-for` entry when `trustProxy` is set.
   */
  keyBy?: (req: ZebraRequest) => string | Promise<string>;
  /** Pluggable counter storage. Defaults to `MemoryStore({ windowMs })` (C2). */
  store?: RateLimitStore;
  /**
   * Trust the `x-forwarded-for` header, using its leftmost entry as the
   * client address. Only set when the deployment's edge proxy overwrites the
   * header (reverse proxy / CDN / load balancer); otherwise clients can
   * spoof it to carve out their own unlimited budget. Default: false — the
   * socket IP (`req.ip`) is used instead.
   */
  trustProxy?: boolean;
}

const DEFAULT_KEY = "anonymous";

/** Leftmost entry of `x-forwarded-for` — only valid behind a trusted proxy that overwrites the header. */
function forwardedIp(req: ZebraRequest): string {
  const forwarded = req.headers.get("x-forwarded-for");
  if (forwarded === null || forwarded === "") return DEFAULT_KEY;
  const first = forwarded.split(",")[0]?.trim();
  return first === undefined || first === "" ? DEFAULT_KEY : first;
}

/** Real socket peer address (`server.requestIP` via `ZebraRequest.ip`), else anonymous. */
function socketIp(req: ZebraRequest): string {
  return req.ip ?? DEFAULT_KEY;
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
  const trustProxy = options.trustProxy ?? false;
  const keyBy = options.keyBy ?? (trustProxy ? forwardedIp : socketIp);
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
