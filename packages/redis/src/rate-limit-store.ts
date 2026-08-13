// `RedisRateLimitStore`: `RateLimitStore` backed by Redis.
//
// Fixed-window counting with a lazy window start — the same semantics as the
// rate-limit `MemoryStore` (count includes the current request, window opens
// on first request, expired windows are replaced lazily). Key layout:
//
//   `{prefix}{key}`      — request counter (advanced with INCR only)
//   `{prefix}{key}:start` — window start in epoch ms, set once per window
//
// Atomicity: the window claim is a single `SET key:start <now> PX windowMs
// NX` — at most one request per window wins the NX, so concurrent increments
// can never open two windows or disagree on the reset time, and the fresh
// window is created with count 1. The counter itself is only ever advanced
// with `INCR` (never read-modify-write), so no increment can be dropped and
// no MULTI/EVAL is needed. Residual boundary race: an `INCR` landing exactly
// between a claim and its `SET count 1` is counted in the *previous* window
// (an under-count of one at a window boundary, inherent to fixed windows
// without a Lua script). Every `INCR` is followed by `PEXPIRE` so the count
// key can never leak.

import type { IncrementResult, RateLimitStore } from "@zebra/rate-limit";

import type { RedisLike } from "./redis-like.ts";

export interface RedisRateLimitStoreOptions {
  /** Key prefix for every key this store owns. Defaults to `"zebra:rate-limit:"`. */
  prefix?: string;
  /**
   * Clock override (test hook): the window start and `resetAt` are computed
   * from this clock instead of `Date.now()`. Point it at a fake client's
   * clock for deterministic fake-time tests.
   */
  now?: () => number;
}

const DEFAULT_PREFIX = "zebra:rate-limit:";
const START_SUFFIX = ":start";

export class RedisRateLimitStore implements RateLimitStore {
  private readonly client: RedisLike;
  private readonly prefix: string;
  private readonly now: () => number;

  constructor(client: RedisLike, options: RedisRateLimitStoreOptions = {}) {
    this.client = client;
    this.prefix = options.prefix ?? DEFAULT_PREFIX;
    this.now = options.now ?? Date.now;
  }

  private countKey(key: string): string {
    return `${this.prefix}${key}`;
  }

  private startKey(key: string): string {
    return `${this.prefix}${key}${START_SUFFIX}`;
  }

  async increment(key: string, windowMs: number): Promise<IncrementResult> {
    const now = this.now();
    const countKey = this.countKey(key);
    const startKey = this.startKey(key);

    // Atomically claim the window start: exactly one request per window wins,
    // opening a fresh window with count 1.
    const claimed = await this.client.set(startKey, String(now), "PX", windowMs, "NX");
    if (claimed === "OK") {
      await this.client.set(countKey, "1", "PX", windowMs);
      return { count: 1, resetAt: now + windowMs };
    }

    const count = await this.client.incr(countKey);
    await this.client.pexpire(countKey, windowMs);
    const start = await this.client.get(startKey);
    if (start === null) {
      // The start key expired between the claim attempt and the read — the
      // window rotated mid-flight. Re-claim so `resetAt` is never derived
      // from a dead window; the stale counter is overwritten by the winner.
      const reclaimed = await this.client.set(startKey, String(now), "PX", windowMs, "NX");
      if (reclaimed === "OK") {
        await this.client.set(countKey, "1", "PX", windowMs);
        return { count: 1, resetAt: now + windowMs };
      }
    }
    // `start` can still be null here when the re-claim above lost to a
    // concurrent writer: derive a best-effort resetAt from now. The window
    // owner's clock is authoritative and overwrites the counter on rotation.
    const resetAt = start === null ? Number.NaN : Number(start) + windowMs;
    return { count, resetAt: Number.isNaN(resetAt) ? now + windowMs : resetAt };
  }

  async reset(key: string): Promise<void> {
    await this.client.del(this.countKey(key), this.startKey(key));
  }
}
