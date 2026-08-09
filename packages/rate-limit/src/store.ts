// C1: `RateLimitStore` interface — minimal placeholder; the contract is
// finalized in C4 (`packages/rate-limit/src/store.ts`).
//
// C4 contract (from todos/03-rate-limit.md): pluggable storage with
// `increment(key, windowMs)` → `{ count, resetAt }` and `reset(key)`. The
// interface stays independent of the in-memory implementation so a later
// adapter (e.g. `@zebra/rate-limit-redis`) can implement it without touching
// this module. Semantics: `count` is the number of requests already counted
// inside the current window — *not* the remaining budget (a fixed-window
// counter, see C2); `resetAt` is the epoch ms when the window expires and the
// count resets. C4 settles whether `windowMs` is passed per call (as below)
// or only at `MemoryStore({ windowMs })` construction (C1's default-store
// wording).

export interface IncrementResult {
  /** Requests counted inside the current window (not the remaining budget). */
  count: number;
  /** Epoch ms at which the current window expires and the count resets. */
  resetAt: number;
}

/**
 * Pluggable rate-limit counter storage. All methods are async so backends
 * with I/O (Redis, Postgres, ...) can implement it. Per-key counters expire
 * with their window; expired keys may be dropped lazily.
 */
export interface RateLimitStore {
  /**
   * Counts one request for `key` inside the current window. `windowMs`
   * overrides the store default when given. Returns the new in-window count
   * and the window reset time.
   */
  increment(key: string, windowMs?: number): Promise<IncrementResult>;
  /** Drops the counter for `key`; the next increment starts a fresh window. */
  reset(key: string): Promise<void>;
}
