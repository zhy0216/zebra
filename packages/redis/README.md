# @zebra/redis

Redis-backed stores for `@zebra/session` and `@zebra/rate-limit`, in one
dependency-free package: **you bring your own Redis client**.

- `RedisSessionStore` implements `SessionStore` (packages/session)
- `RedisRateLimitStore` implements `RateLimitStore` (packages/rate-limit)

**Zero runtime dependencies.** The package defines a minimal duck-typed
client interface (`RedisLike`, see `src/redis-like.ts`) and never imports a
Redis driver. Pass any client that satisfies it — an ioredis instance works
as-is. This is what makes the stores shared-state safe across instances:
every instance talks to the same Redis, so sessions and rate-limit budgets
are global rather than per-process.

## Install

```sh
bun add @zebra/redis          # alongside @zebra/session / @zebra/rate-limit
bun add ioredis               # your client of choice, not a dep of @zebra/redis
```

## Usage

### Sessions

```ts
import { Redis } from "ioredis";
import { Zebra } from "zebra";
import { sessionMiddleware } from "@zebra/session";
import { RedisSessionStore } from "@zebra/redis";

const client = new Redis(process.env.REDIS_URL);

const store = new RedisSessionStore(client, {
  ttl: 30 * 60 * 1000,        // session lifetime, same unit as MemoryStoreOptions.ttl
  prefix: "app:session:",     // optional, defaults to "zebra:session:"
});

const mw = sessionMiddleware({ secret: process.env.SESSION_SECRET!, store });
const app = new Zebra({ session: { resolver: mw.resolver } });
app.use(mw);
```

### Rate limiting

```ts
import { rateLimit } from "@zebra/rate-limit";
import { RedisRateLimitStore } from "@zebra/redis";

const store = new RedisRateLimitStore(client, {
  prefix: "app:rl:",          // optional, defaults to "zebra:rate-limit:"
});

app.use(rateLimit({ windowMs: 60_000, max: 100, store }));
```

### Other clients (node-redis v4)

`RedisLike` mirrors ioredis's variadic form `set(key, value, "PX", ms, "NX")`.
A node-redis v4 client spells `SET` with an options object; wrap its `set`
with a tiny adapter and the rest of the commands match:

```ts
import { createClient } from "redis";

const raw = createClient({ url: process.env.REDIS_URL });
const client: RedisLike = {
  get: raw.get.bind(raw),
  incr: raw.incr.bind(raw),
  del: raw.del.bind(raw),
  pexpire: raw.pExpire.bind(raw),
  set: (key, value, _px, ms, nx) =>
    raw.set(key, value, nx === "NX" ? { PX: ms, NX: true } : { PX: ms }),
};
```

## Semantics

### `RedisSessionStore`

- **Key layout**: `{prefix}{id}` holds the JSON-encoded session data;
  `{prefix}{id}:tomb` is a short-TTL tombstone written on `destroy`.
- **TTL**: data expiry is delegated to Redis (`SET ... PX`), so expired keys
  are reclaimed by Redis itself — nothing to sweep client-side.
- **Anti-revival** (mirrors `MemoryStore`): `destroy` deletes the data key
  and writes a tombstone that lives for the store TTL; `get`/`set`/`touch`
  treat a tombstoned id as missing, so an in-flight request can never
  resurrect a destroyed session (session-fixation protection). `get`
  re-checks the tombstone on every read, which also masks any record a
  racing `set` left behind. The residual race — the tombstone check in
  `set`/`touch` is a separate round trip, so a `destroy` can slip in between
  the check and the write — is bounded: the stale record carries the same
  TTL as the tombstone and can at worst briefly resurface (masked by `get`)
  for up to one round trip after the tombstone expires; closing it fully
  needs a Lua script (intentionally out of scope: the interface speaks
  plain commands).
- **Serialization**: session data is JSON-encoded, so it must be
  JSON-serializable (always true for what `@zebra/session` persists). A
  corrupt payload reads as missing rather than failing every request.

### `RedisRateLimitStore`

- **Fixed windows with lazy start** — identical semantics to the rate-limit
  `MemoryStore`: the window opens on the first request, `count` includes the
  current request, and an expired window is replaced on the next increment.
- **Key layout**: `{prefix}{key}` is the counter, `{prefix}{key}:start` the
  window start in epoch ms.
- **Atomicity without MULTI/EVAL**: the window claim is one
  `SET {key}:start <now> PX {windowMs} NX` — at most one request per window
  wins the NX and opens the fresh window with count 1; every other request
  advances the counter with `INCR` (never read-modify-write), so no
  increment can be dropped. The `INCR` path also `PEXPIRE`s the counter, so
  counters can never leak. Residual boundary races (both bounded to one
  request's view at a window boundary, self-correcting on the next request):
  an `INCR` landing exactly between a claim and its `SET count 1` is counted
  in the *previous* window — a one-request under-count; and a request whose
  claim loses to a rotating start key may briefly read the old window's
  count with the new window's reset time — a one-request stale view (spurious
  429 or under-count). Inherent to fixed windows without a Lua script.
- **reset**: deletes both keys; the next increment opens a fresh window.

### Network failures: fail closed

Neither store swallows client errors. A Redis outage rejects the store
call, which propagates through the middleware into core's error handling —
`@zebra/session` and `@zebra/rate-limit` will respond `500` rather than
silently continuing without session state or rate-limit enforcement.

## When not to use this package

> ⚠️ `MemoryStore` — the default store of both `@zebra/session` and
> `@zebra/rate-limit` — keeps all state in the process's memory. It is
> **single-process / development / testing only** and is **not suitable for
> multi-instance shared state**:
>
> - with more than one instance serving traffic, a session created on one
>   instance is unknown to the others, and each instance counts its own
>   rate-limit budget — limiting is per-instance, not global;
> - a restart drops every session and every counter.
>
> Use `RedisSessionStore` / `RedisRateLimitStore` whenever multiple instances
> serve traffic, or when state must survive restarts. `MemoryStore` remains a
> fine default for a single-process deployment, development, and tests.

## Testing

The store logic is fully exercised against an in-memory fake Redis
(`test/fake-redis.ts`) that honors the exact command semantics the stores
issue (PX expiry against an injectable clock, `NX`, `INCR`, `DEL`,
`PEXPIRE`, plus a per-command failure switch for the network-error paths) —
no live Redis required:

```sh
bun test packages/redis
```
