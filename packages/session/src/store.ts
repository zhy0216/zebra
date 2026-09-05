// C3: `SessionStore` interface + `MemoryStore` default implementation.
//
// The interface is deliberately independent of any storage backend so that
// later adapter packages (e.g. `@zebra-web/session-redis`) can implement it
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
 * passes (at most `SWEEP_BUDGET` per call, resuming the previous pass) so a
 * single access never pays an O(n) scan over a large store. Correctness never
 * depends on the sweep — every read re-checks its entry's expiry. No timers
 * are used, so nothing can leak. TTL is in milliseconds.
 */
export class MemoryStore implements SessionStore {
  private readonly ttl: number;
  private readonly entries = new Map<string, Entry>();
  private sweepCursor = this.entries.entries();

  constructor(options: MemoryStoreOptions) {
    this.ttl = options.ttl;
  }

  async get(id: string): Promise<unknown | undefined> {
    const now = Date.now();
    this.sweep(now);
    const entry = this.activeEntry(id, now);
    if (entry === undefined) return undefined;
    if (entry.tombstoneUntil !== undefined) return undefined;
    return entry.data;
  }

  async set(id: string, data: unknown): Promise<void> {
    const now = Date.now();
    this.sweep(now);
    // Refuse to revive a session destroyed within the tombstone window.
    if (this.activeEntry(id, now)?.tombstoneUntil !== undefined) return;
    this.entries.set(id, { data, expiresAt: now + this.ttl });
  }

  async touch(id: string, ttl?: number): Promise<void> {
    const now = Date.now();
    this.sweep(now);
    const entry = this.activeEntry(id, now);
    if (entry === undefined) return;
    if (entry.tombstoneUntil !== undefined) return;
    entry.expiresAt = now + (ttl ?? this.ttl);
  }

  async destroy(id: string): Promise<void> {
    const until = Date.now() + this.ttl;
    this.entries.set(id, { data: undefined, expiresAt: until, tombstoneUntil: until });
  }

  /** Expiration checks on the requested id never depend on sweep progress. */
  private activeEntry(id: string, now: number): Entry | undefined {
    const entry = this.entries.get(id);
    if (entry !== undefined && now >= entry.expiresAt) {
      this.entries.delete(id);
      return undefined;
    }
    return entry;
  }

  /**
   * Removes already-expired entries, scanning at most `SWEEP_BUDGET` per call.
   * Retaining the live Map iterator prevents long-lived entries at the head
   * from starving the tail. Wrap within the budget so small stores are still
   * fully swept on each call, even after deletions or newly appended keys.
   */
  private sweep(now: number): void {
    const budget = Math.min(SWEEP_BUDGET, this.entries.size);
    if (budget === 0) {
      this.sweepCursor = this.entries.entries();
      return;
    }
    for (let scanned = 0; scanned < budget; scanned++) {
      let next = this.sweepCursor.next();
      if (next.done) {
        this.sweepCursor = this.entries.entries();
        next = this.sweepCursor.next();
      }
      if (next.done) break;
      const [id, entry] = next.value;
      if (now >= entry.expiresAt) this.entries.delete(id);
    }
  }
}

/** Max entries scanned per `sweep()` call; keeps per-access cost bounded. */
const SWEEP_BUDGET = 512;
