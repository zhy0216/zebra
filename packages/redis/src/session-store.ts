// `RedisSessionStore`: `SessionStore` backed by Redis.
//
// Key layout (all keys carry a Redis TTL — data expiry is delegated to Redis
// `PX`, nothing is swept client-side):
//
//   `{prefix}{id}`      — JSON-encoded session data
//   `{prefix}{id}:tomb` — tombstone marker, present for `ttl` after destroy
//
// Anti-revival (mirrors `MemoryStore`, see the `SessionStore` contract):
// `destroy` deletes the data key and writes a short-TTL tombstone; `get` /
// `set` / `touch` treat a tombstoned id as missing, so an in-flight request
// can never resurrect a destroyed session. `get` re-checks the tombstone on
// every read, which also masks records a racing `set` may have left behind
// (they expire with their TTL).
//
// Trade-off vs. `MemoryStore`: `MemoryStore`'s check-and-write runs in one
// synchronous section of the event loop, so it is atomic within a single
// process. Across Redis instances the tombstone check in `set`/`touch` is a
// separate round trip — between the check and the write a concurrent
// `destroy` can slip in. Readers are still safe (`get` re-checks the
// tombstone); closing the write window fully would need a Lua script, which
// is intentionally out of scope (the interface speaks plain commands).
//
// Data is JSON-encoded, so session data must be JSON-serializable (true for
// everything `@zebra-web/session` persists). A corrupt payload reads as missing
// rather than failing every request that touches it.

import type { SessionStore } from "@zebra-web/session";

import type { RedisLike } from "./redis-like.ts";

export interface RedisSessionStoreOptions {
  /** Session lifetime in milliseconds (same unit as `MemoryStoreOptions.ttl`). */
  ttl: number;
  /** Key prefix for every key this store owns. Defaults to `"zebra:session:"`. */
  prefix?: string;
}

const DEFAULT_PREFIX = "zebra:session:";
const TOMBSTONE_SUFFIX = ":tomb";

export class RedisSessionStore implements SessionStore {
  private readonly client: RedisLike;
  private readonly ttl: number;
  private readonly prefix: string;

  constructor(client: RedisLike, options: RedisSessionStoreOptions) {
    this.client = client;
    this.ttl = options.ttl;
    this.prefix = options.prefix ?? DEFAULT_PREFIX;
  }

  private dataKey(id: string): string {
    return `${this.prefix}${id}`;
  }

  private tombstoneKey(id: string): string {
    return `${this.prefix}${id}${TOMBSTONE_SUFFIX}`;
  }

  private async isTombstoned(id: string): Promise<boolean> {
    return (await this.client.get(this.tombstoneKey(id))) !== null;
  }

  async get(id: string): Promise<unknown | undefined> {
    // A tombstoned id reads as missing even if a racing `set` left a record
    // behind (see header); Redis TTL handles expiry.
    if (await this.isTombstoned(id)) return undefined;
    const raw = await this.client.get(this.dataKey(id));
    if (raw === null) return undefined;
    try {
      return JSON.parse(raw);
    } catch {
      // Corrupt payloads are treated as missing (like a destroyed record).
      return undefined;
    }
  }

  async set(id: string, data: unknown): Promise<void> {
    if (await this.isTombstoned(id)) return;
    const json = JSON.stringify(data);
    if (json === undefined) return; // JSON.stringify(undefined) — nothing to store
    await this.client.set(this.dataKey(id), json, "PX", this.ttl);
  }

  async touch(id: string, ttl?: number): Promise<void> {
    if (await this.isTombstoned(id)) return;
    // `pexpire` on a missing key returns 0 — a no-op, matching `MemoryStore`.
    await this.client.pexpire(this.dataKey(id), ttl ?? this.ttl);
  }

  async destroy(id: string): Promise<void> {
    await this.client.del(this.dataKey(id));
    await this.client.set(this.tombstoneKey(id), "1", "PX", this.ttl);
  }
}
