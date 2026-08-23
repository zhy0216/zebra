# Redis Storage Adapters (@zebra-web/redis)

`@zebra-web/redis` provides Redis-backed stores for `@zebra-web/session` and `@zebra-web/rate-limit`. **Zero runtime dependencies**: it doesn't bind to any Redis client — your client only needs to implement a tiny duck-typed interface (`RedisLike`). ioredis, node-redis, and Bun.redis all work.

## Install

```sh
bun add @zebra-web/redis
```

## The RedisLike interface

The stores only use these commands (signatures mirror ioredis's variadic forms):

```ts
interface RedisLike {
  set(key, value, "PX", ms): Promise<unknown>;             // → "OK"
  set(key, value, "PX", ms, "NX"): Promise<unknown>;       // → "OK" | null (null when the key exists)
  incr(key): Promise<number>;
  get(key): Promise<string | null>;
  del(...keys): Promise<unknown>;
  pexpire(key, ms): Promise<unknown>;
}
```

ioredis works directly. node-redis v4 uses an options object for `SET` (`{ PX, NX }`) instead of the variadic form — wrap its `set` in a small adapter:

```ts
import { createClient } from "redis";

const client = createClient();
await client.connect();

const adapted = {
  ...client,
  set: (key, value, px, ms, nx) =>
    client.set(key, value, { PX: ms, ...(nx === "NX" ? { NX: true } : {}) }),
};
```

## RedisRateLimitStore

A Redis implementation of `RateLimitStore` with the exact same semantics as `MemoryStore` (fixed window, lazy window opening, the count includes the current request):

```ts
import { rateLimit } from "@zebra-web/rate-limit";
import { RedisRateLimitStore } from "@zebra-web/redis";

const store = new RedisRateLimitStore(redisClient, { prefix: "myapp:rl:" });

app.use(rateLimit({ windowMs: 60_000, max: 100, store }));
```

Options: `prefix` (default `zebra:rate-limit:`), `now` (clock override, a test hook).

Key layout:

```
{prefix}{key}        — request counter (advanced with INCR only)
{prefix}{key}:start  — window start (epoch ms, SET ... PX ... NX wins once per window)
```

Atomicity design:

- The window claim is a single `SET key:start <now> PX windowMs NX` — at most one request per window wins the NX, so concurrent increments can never open two windows or disagree on the reset time; a fresh window starts with count 1.
- The counter is only advanced with `INCR` (never read-modify-write), so no increment can be dropped and no MULTI/EVAL is needed.
- Every `INCR` is followed by `PEXPIRE`, so the count key can never leak.
- Known boundary race: an `INCR` landing exactly between a claim and its `SET count 1` is counted in the *previous* window (an under-count of one at a window boundary — inherent to fixed windows without a Lua script).

## RedisSessionStore

A Redis implementation of `SessionStore`:

```ts
import { sessionMiddleware } from "@zebra-web/session";
import { RedisSessionStore } from "@zebra-web/redis";

const store = new RedisSessionStore(redisClient, { ttl: 30 * 60 * 1000 });
const session = sessionMiddleware({ secret, store });
```

Options: `ttl` (required, ms), `prefix` (default `zebra:session:`).

Key layout (all keys carry a Redis TTL — data expiry is delegated to Redis `PX`, nothing is swept client-side):

```
{prefix}{id}         — JSON-encoded session data
{prefix}{id}:tomb    — tombstone marker, present for `ttl` after destroy
```

Anti-revival (mirrors the `MemoryStore` contract):

- `destroy` deletes the data key and writes a short-TTL tombstone; `get` / `set` / `touch` treat a tombstoned id as missing — an in-flight request can never resurrect a destroyed session.
- `get` re-checks the tombstone on every read, which also masks records a racing `set` may have left behind (they expire with their TTL).
- Data is JSON-encoded, so session data must be JSON-serializable (everything `@zebra-web/session` persists is); a corrupt payload reads as missing rather than failing every request.

> vs. `MemoryStore`: `MemoryStore`'s check-and-write runs in one synchronous section of the event loop, so it's atomic within a single process. Across Redis, the tombstone check in `set`/`touch` is a separate round trip — a concurrent `destroy` can slip between check and write. Readers are still safe (`get` re-checks the tombstone); fully closing the write window would need a Lua script, intentionally out of scope (the interface speaks plain commands).

## Combining them

```ts
const rateStore = new RedisRateLimitStore(redis);
const sessionStore = new RedisSessionStore(redis, { ttl: 30 * 60 * 1000 });

const session = sessionMiddleware({ secret, store: sessionStore });

const app = new Zebra({
  session: { resolver: session.resolver, wsSession: session.wsSession, ttl: 30 * 60 * 1000 },
});
app.use(session);
app.use(rateLimit({ windowMs: 60_000, max: 100, store: rateStore }));
```

In a multi-instance deployment, both sessions and rate-limit counters live in the shared Redis instead of per-instance memory.

## Next steps

- [Sessions: the SessionStore interface and persistence semantics](07-sessions.md#sessionstore-interface-and-default-implementation)
- [Rate limiting: the RateLimitStore interface and counting semantics](09-rate-limiting.md#ratelimitstore-and-the-default-implementation)
