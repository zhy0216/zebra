# Rate Limiting (@zebra/rate-limit)

`@zebra/rate-limit` provides fixed-window rate limiting middleware: per-key counters (lazy window rotation, atomic increments), a pluggable `RateLimitStore` (in-memory default), and 429 Problem+Json responses with `X-RateLimit-*` / `Retry-After` headers.

## Install

```sh
bun add @zebra/rate-limit
```

## Quick start

```ts
import { Zebra } from "@zebra/core";
import { rateLimit } from "@zebra/rate-limit";

const app = new Zebra();

app.use(rateLimit({ windowMs: 60_000, max: 100 })); // global: 100 req/min per IP
```

The key defaults to the socket peer IP (`req.ip`); without a socket (e.g. `app.dispatch()` in tests) it falls back to the shared `anonymous` key.

## Options

```ts
interface RateLimitOptions {
  windowMs: number;                        // window length (ms), required
  max: number;                             // max requests per key per window, required
  keyBy?: (req: ZebraRequest) => string | Promise<string>;
  store?: RateLimitStore;                  // default MemoryStore({ windowMs })
  trustProxy?: boolean;                    // default false
}
```

### Custom keys: per-user limiting

The key doesn't have to be an IP. For logged-in apps, limit by user (or session):

```ts
import { getSession } from "@zebra/session";

const writeLimit = rateLimit({
  windowMs: 60_000,
  max: 30,
  keyBy: async (req) => {
    const s = getSession(req);
    const userId = s === undefined ? undefined : await s.get("userId");
    return typeof userId === "number" ? `user:${userId}` : "anonymous";
  },
});

app.post("/api/posts", writeLimit, async (req) => { ... });
```

### trustProxy and x-forwarded-for

**Security warning**: `x-forwarded-for` is client-spoofable. By default `trustProxy: false` — the key uses the real socket IP (`req.ip`, from Bun `requestIP`, never derived from headers).

Only enable `trustProxy: true` when your deployment's edge proxy (reverse proxy / CDN / load balancer) **overwrites** the header:

- When on, the leftmost `x-forwarded-for` entry is used (the peer as seen by the edge).
- Requests without the header share the `anonymous` key, rather than being exempt from limiting.

```ts
app.use(rateLimit({ windowMs: 60_000, max: 100, trustProxy: true }));
// only when you're sure the proxy overwrites x-forwarded-for
```

## Response semantics

### Over the limit (429)

`next()` is never called; the middleware throws `HttpError(429, "rate_limit_exceeded", ...)`, which core's error middleware converts to Problem+Json:

```json
{
  "type": "https://errors.zebra.dev/rate_limit_exceeded",
  "status": 429,
  "title": "Too Many Requests",
  "detail": { "limit": 30, "retryAfterSeconds": 42 }
}
```

Response headers:

| Header | Meaning |
| --- | --- |
| `X-RateLimit-Limit` | the configured `max` |
| `X-RateLimit-Remaining` | `max - count` (floored at 0; 0 on a 429) |
| `X-RateLimit-Reset` | window expiry as epoch seconds |
| `Retry-After` | seconds until the window resets (rounded up, floored at 1) |

### Under the limit

The handler runs normally; the response is wrapped with `X-RateLimit-*` headers on the way out. A handler exception propagates unchanged (**never swallowed by the limiter**) — core's error middleware still sees the original error.

## Counting semantics (fixed window)

- One counter per key per window; the counter and window rotation belong to the store.
- **Lazy window opening**: only `store.increment(key, windowMs)` can open or rotate a window — no global timer, no background sweep.
- **Atomicity**: the read-modify-write for a key happens inside one `increment` call without crossing an `await` — on a single-threaded event loop, concurrent requests process serially, no update is lost, and no locks/CAS are needed for in-process stores.
- The count includes the current request: the first request in a window has count 1; `allowed` is `count <= max`, so the `(max+1)`-th request in a window is denied.

## Low-level primitives

```ts
import { checkLimit, createLimiter } from "@zebra/rate-limit";

// check a single key directly
const { allowed, count, remaining, resetAt } = await checkLimit(store, key, windowMs, max);

// or a store-bound limiter
const limiter = createLimiter(store);
const result = await limiter.check(key, windowMs, max);
```

`RateLimitResult = { allowed, count, remaining, resetAt }` (`resetAt` is epoch ms).

## RateLimitStore and the default implementation

```ts
interface RateLimitStore {
  increment(key: string, windowMs: number): Promise<IncrementResult>; // { count, resetAt }
  reset(key: string): Promise<void>;
}
```

- `MemoryStore({ windowMs })` — default, in-process Map.
- Roll your own backend (Redis) by implementing the interface; `@zebra/redis` ships `RedisRateLimitStore` (see [Redis](14-redis.md)).

## Facade exports

Imported from the `zebra` facade, `MemoryStore` is aliased to `RateLimitMemoryStore` (avoiding the collision with session's `MemoryStore`):

```ts
import { checkLimit, createLimiter, RateLimitMemoryStore, rateLimit } from "zebra";
```

## Next steps

- [Redis backend rate-limit store](14-redis.md)
- [Sessions: the `keyBy` dependency for per-user limiting](07-sessions.md)
- [Observability: monitoring 429s](13-observability.md)
