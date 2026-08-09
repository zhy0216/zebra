// C3: `SessionStore` interface + `MemoryStore` default implementation.
//
// The interface is deliberately independent of any storage backend so that
// later adapter packages (e.g. `@zebra/session-redis`) can implement it
// without touching this module.

export interface MemoryStoreOptions {
  /** Session lifetime in milliseconds. */
  ttl: number;
}

/**
 * Pluggable session storage. All methods are async so backends with I/O
 * (Redis, Postgres, ...) can implement it; `data` is any serializable value.
 */
export interface SessionStore {
  /** Returns the stored data for `id`, or `undefined` when missing or expired. */
  get(id: string): Promise<unknown | undefined>;
  /** Stores `data` for `id`, resetting its expiration. */
  set(id: string, data: unknown): Promise<void>;
  /**
   * Refreshes the expiration of `id`. `ttl` overrides the store default when
   * given, otherwise the constructor `ttl` is used. Missing sessions are a no-op.
   */
  touch(id: string, ttl?: number): Promise<void>;
  /**
   * Removes `id` from the store. Implementations SHOULD refuse `set`/`touch`
   * for a recently destroyed id (anti-revival / session-fixation protection):
   * a request still in flight must not resurrect a session that was
   * destroyed server-side. `MemoryStore` does this with a short-lived
   * tombstone.
   */
  destroy(id: string): Promise<void>;
}

interface Entry {
  data: unknown;
  expiresAt: number;
  /**
   * Destroyed ids keep a tombstone entry (until `expiresAt`) so concurrent
   * `set`/`touch` from in-flight requests cannot revive them. `get` treats
   * a tombstoned id as missing.
   */
  tombstoneUntil?: number;
}

/**
 * Default in-memory implementation backed by a `Map`. Expired entries are
 * removed lazily: `get`/`set`/`touch` sweep already-expired keys in bounded
 * passes (at most `SWEEP_BUDGET` per call, oldest first) so a single access
 * never pays an O(n) scan over a large store. Correctness never depends on
 * the sweep — every read re-checks its entry's expiry. No timers are used,
 * so nothing can leak. TTL is in milliseconds.
 */
export class MemoryStore implements SessionStore {
  private readonly ttl: number;
  private readonly entries = new Map<string, Entry>();

  constructor(options: MemoryStoreOptions) {
    this.ttl = options.ttl;
  }

  async get(id: string): Promise<unknown | undefined> {
    this.sweep();
    const entry = this.entries.get(id);
    if (entry === undefined) return undefined;
    if (Date.now() >= entry.expiresAt) {
      this.entries.delete(id);
      return undefined;
    }
    if (entry.tombstoneUntil !== undefined) return undefined;
    return entry.data;
  }

  async set(id: string, data: unknown): Promise<void> {
    this.sweep();
    // Refuse to revive a session destroyed within the tombstone window.
    if (this.entries.get(id)?.tombstoneUntil !== undefined) return;
    this.entries.set(id, { data, expiresAt: Date.now() + this.ttl });
  }

  async touch(id: string, ttl?: number): Promise<void> {
    this.sweep();
    const entry = this.entries.get(id);
    if (entry === undefined) return;
    if (entry.tombstoneUntil !== undefined) return;
    entry.expiresAt = Date.now() + (ttl ?? this.ttl);
  }

  async destroy(id: string): Promise<void> {
    const until = Date.now() + this.ttl;
    this.entries.set(id, { data: undefined, expiresAt: until, tombstoneUntil: until });
  }

  /**
   * Removes already-expired entries, scanning at most `SWEEP_BUDGET` per call.
   * Entries are inserted in creation order, so the head of the Map holds the
   * oldest (most likely expired) ids first; entries behind the budget are
   * reclaimed by later accesses or on direct `get`. Small stores (≤ budget)
   * are fully swept, identical to the historical behavior.
   */
  private sweep(): void {
    const now = Date.now();
    let scanned = 0;
    for (const [id, entry] of this.entries) {
      if (++scanned > SWEEP_BUDGET) break;
      if (now >= entry.expiresAt) this.entries.delete(id);
    }
  }
}

/** Max entries scanned per `sweep()` call; keeps per-access cost bounded. */
const SWEEP_BUDGET = 512;
