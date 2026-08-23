// Minimal duck-typed Redis client interface.
//
// `@zebra-web/redis` has zero runtime dependencies: the consumer passes their own
// Redis client (ioredis, node-redis, Bun.redis, ...) and the stores only need
// the subset of commands below, so any client implementing them works. The
// signatures mirror ioredis's variadic forms:
//
//   client.set(key, value, "PX", ms)        → "OK"
//   client.set(key, value, "PX", ms, "NX")  → "OK" | null (null when the key exists)
//   client.incr(key) / get(key) / del(...keys) / pexpire(key, ms)
//
// A node-redis v4 client uses an options object for `SET` (`{ PX, NX }`)
// instead of the variadic form; wrap its `set` in a tiny adapter, see README.

export interface RedisLike {
  get(key: string): Promise<string | null>;
  set(key: string, value: string, px: "PX", ms: number, nx?: "NX"): Promise<string | null>;
  incr(key: string): Promise<number>;
  del(...keys: string[]): Promise<number>;
  pexpire(key: string, ms: number): Promise<number>;
}
