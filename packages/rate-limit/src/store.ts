// C4: `RateLimitStore` interface + `MemoryStore` default implementation.
//
// The interface is deliberately independent of any storage backend so that a
// later adapter package (e.g. `@zebra-web/rate-limit-redis`) can implement it
// without touching this module. It only speaks string keys and number
// windows — no Map, no entries — and the count semantics are pinned: the
// return value is the number of requests counted *inside* the current
// window, never the remaining budget (the middleware derives
// `remaining = max - count`, see C2/C3).

export interface MemoryStoreOptions {
  /**
   * Default window length in milliseconds. Used when `increment` is called
   * without an explicit `windowMs`.
   */
  windowMs?: number;
}

export interface IncrementResult {
  /**
   * Requests counted inside the current window, this request included (the
   * first request of a window returns count 1). Not the remaining budget.
   */
  count: number;
  /** Epoch ms at which the current window expires and the count resets. */
  resetAt: number;
}

/**
 * Pluggable rate-limit counter storage. All methods are async so backends
 * with I/O (Redis, Postgres, ...) can implement it.
 *
 * Semantics (pinned by C2/C3): `count` is the number of requests already
 * counted *inside* the current window — never the remaining budget, which
 * callers derive as `max - count`. `windowMs` is passed per call so one
 * store can serve keys with different windows; implementations may also
 * carry their own default. Per-key counters expire with their window;
 * expired keys may be dropped lazily.
 */
export interface RateLimitStore {
  /**
   * Counts one request for `key` inside the current window of `windowMs`
   * milliseconds, returning the new in-window count and the window reset
   * time in epoch ms. When the current window is already past, a fresh
   * window starts with count 1.
   */
  increment(key: string, windowMs: number): Promise<IncrementResult>;
  /** Drops the counter for `key`; the next increment starts a fresh window. */
  reset(key: string): Promise<void>;
}

interface Entry {
  count: number;
  resetAt: number;
}

/**
 * Default in-memory implementation backed by a `Map`. Fixed windows are
 * opened lazily: the first `increment` for a key starts a window expiring at
 * `Date.now() + windowMs`; once past, the next `increment` replaces it with a
 * fresh one. No timers are used, so nothing can leak.
 *
 * Atomicity: the check-and-update below runs entirely in one synchronous
 * section of the async body — no `await` sits between reading `buckets` and
 * writing it back — so on the single-threaded event loop the read-modify-
 * write is atomic: concurrent increments cannot interleave and drop a count,
 * no locks or CAS needed.
 */
export class MemoryStore implements RateLimitStore {
  private readonly windowMs: number | undefined;
  private readonly buckets = new Map<string, Entry>();

  constructor(options: MemoryStoreOptions = {}) {
    this.windowMs = options.windowMs;
  }

  async increment(key: string, windowMs?: number): Promise<IncrementResult> {
    const ms = windowMs ?? this.windowMs;
    if (ms === undefined) {
      throw new Error(
        "MemoryStore: increment requires windowMs (constructor option or per-call argument)",
      );
    }
    this.sweep();
    const now = Date.now();
    const entry = this.buckets.get(key);
    if (entry === undefined || now >= entry.resetAt) {
      const fresh: Entry = { count: 1, resetAt: now + ms };
      this.buckets.set(key, fresh);
      return { count: fresh.count, resetAt: fresh.resetAt };
    }
    entry.count += 1;
    return { count: entry.count, resetAt: entry.resetAt };
  }

  async reset(key: string): Promise<void> {
    this.buckets.delete(key);
  }

  /**
   * Removes already-expired buckets, scanning at most `SWEEP_BUDGET` per call
   * so per-increment cost stays bounded. Without this, a long-lived process
   * under an ever-changing key space (e.g. per-IP keys behind `trustProxy`)
   * would grow the map without limit.
   */
  private sweep(): void {
    const now = Date.now();
    let scanned = 0;
    for (const [key, entry] of this.buckets) {
      if (++scanned > SWEEP_BUDGET) break;
      if (now >= entry.resetAt) this.buckets.delete(key);
    }
  }
}

/** Max entries scanned per `sweep()` call; keeps per-access cost bounded. */
const SWEEP_BUDGET = 512;
