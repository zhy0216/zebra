import type { RedisLike } from "../src/redis-like.ts";

// In-memory `RedisLike` used by the test suites — every store test runs
// through this fake, no live Redis needed. It honors PX expiry against an
// injectable clock, `NX` set semantics, the `INCR`/`DEL`/`PEXPIRE` return
// conventions, and a per-command failure switch to simulate network errors.

export class FakeRedis implements RedisLike {
  /** Mutable clock; PX expiries are computed against it. Advance to age keys. */
  now = Date.now();

  // Public for test assertions on the underlying key material.
  readonly values = new Map<string, string>();
  readonly expiresAt = new Map<string, number>();
  private readonly failing = new Set<string>();

  /** Every subsequent `command` call throws (simulated network error). */
  fail(command: string): void {
    this.failing.add(command);
  }

  /** Stops `command` from failing again. */
  recover(command: string): void {
    this.failing.delete(command);
  }

  /** Writes a raw value directly (no TTL), bypassing the store — test setup. */
  seed(key: string, value: string): void {
    this.values.set(key, value);
  }

  private throwIfFailing(command: string): void {
    if (this.failing.has(command)) throw new Error(`simulated network error: ${command}`);
  }

  /** Lazy expiry: an expired key is treated as absent and dropped. */
  private alive(key: string): boolean {
    const at = this.expiresAt.get(key);
    if (at === undefined) return true;
    if (this.now >= at) {
      this.values.delete(key);
      this.expiresAt.delete(key);
      return false;
    }
    return true;
  }

  async get(key: string): Promise<string | null> {
    this.throwIfFailing("get");
    if (!this.alive(key)) return null;
    return this.values.get(key) ?? null;
  }

  async set(key: string, value: string, _px: "PX", ms: number, nx?: "NX"): Promise<string | null> {
    this.throwIfFailing("set");
    if (nx === "NX" && this.alive(key) && this.values.has(key)) return null;
    this.values.set(key, value);
    this.expiresAt.set(key, this.now + ms);
    return "OK";
  }

  async incr(key: string): Promise<number> {
    this.throwIfFailing("incr");
    if (!this.alive(key) || !this.values.has(key)) {
      this.values.set(key, "1");
      return 1;
    }
    const next = Number(this.values.get(key) ?? "0") + 1;
    this.values.set(key, String(next));
    return next;
  }

  async del(...keys: string[]): Promise<number> {
    this.throwIfFailing("del");
    let deleted = 0;
    for (const key of keys) {
      if (this.alive(key) && this.values.delete(key)) {
        this.expiresAt.delete(key);
        deleted += 1;
      }
    }
    return deleted;
  }

  async pexpire(key: string, ms: number): Promise<number> {
    this.throwIfFailing("pexpire");
    if (!this.alive(key) || !this.values.has(key)) return 0;
    this.expiresAt.set(key, this.now + ms);
    return 1;
  }
}
