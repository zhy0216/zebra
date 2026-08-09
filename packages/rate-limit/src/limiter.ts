// C2: fixed-window limiter primitive. Each key gets one counter per window
// of `windowMs`; the counter and the window rotation belong to the store
// (C4 `RateLimitStore`), not to this module.
//
// Lazy window opening: `store.increment(key, windowMs)` is the only place a
// window can start or rotate — it resets the counter when the current window
// is already past (`Date.now() >= resetAt`). There is no global timer
// scanning keys, no `setInterval`, no background sweep: a key's window
// advances purely on the next request for that key.
//
// Atomicity: the read-modify-write for a key's counter happens entirely
// inside one `store.increment` call, i.e. within a single synchronous segment
// that never crosses an `await`. Node/Bun run on a single-threaded event
// loop, so a synchronous RMW cannot be interleaved with another request's
// RMW — concurrent requests are processed serially and no update is lost,
// with no locks or CAS needed for in-process stores. This limiter only
// *consumes* the result of one increment and never re-reads/writes the
// counter itself, so it cannot introduce a race either.
//
// Result semantics (matches C2): `count` is the number of requests already
// counted in the current window (incremented before checking, so the current
// request is included — first request in a window has count 1), `remaining`
// is `max(0, max - count)`, and `allowed` is `count <= max`, i.e. the
// (max+1)-th request in a window is denied.

import type { RateLimitStore } from "./store.ts";

export interface RateLimitResult {
  /** True when the request may proceed: `count <= max`. */
  allowed: boolean;
  /** Requests counted inside the current window, including this one. */
  count: number;
  /** `max(0, max - count)` — requests still available in this window. */
  remaining: number;
  /** Epoch ms when the current window expires and the count resets. */
  resetAt: number;
}

/**
 * Fixed-window check for one key: increments the key's counter in `store`
 * (one atomic call, no cross-`await` RMW) and derives the result.
 */
export async function checkLimit(
  store: RateLimitStore,
  key: string,
  windowMs: number,
  max: number,
): Promise<RateLimitResult> {
  if (typeof windowMs !== "number" || windowMs <= 0) {
    throw new TypeError("checkLimit: windowMs must be a positive number");
  }
  if (typeof max !== "number" || max <= 0) {
    throw new TypeError("checkLimit: max must be a positive number");
  }
  const { count, resetAt } = await store.increment(key, windowMs);
  return {
    allowed: count <= max,
    count,
    remaining: Math.max(0, max - count),
    resetAt,
  };
}

export interface Limiter {
  /**
   * Fixed-window check for one key; same semantics as {@link checkLimit} with
   * the store already bound.
   */
  check(key: string, windowMs: number, max: number): Promise<RateLimitResult>;
}

/** Binds a store to the check primitive so callers pass only key/window/max. */
export function createLimiter(store: RateLimitStore): Limiter {
  return {
    check: (key, windowMs, max) => checkLimit(store, key, windowMs, max),
  };
}
