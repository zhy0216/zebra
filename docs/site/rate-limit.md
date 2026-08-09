# Rate limiting — `@zebra/rate-limit`

Fixed-window per-key counters (lazy window rotation, atomic increments),
pluggable `RateLimitStore`, and 429 Problem+Json responses with
`X-RateLimit-*` / `Retry-After` headers.

```sh
bun add @zebra/rate-limit
```

## Basic use

```ts
import { rateLimit } from "@zebra/rate-limit";

const z = new Zebra();
z.use(rateLimit({ windowMs: 60_000, max: 100 }));
```

## Options

| Option | Default | Description |
| ------ | ------- | ----------- |
| `windowMs` | required | Window length in milliseconds |
| `max` | required | Maximum requests per key per window |
| `keyBy` | socket peer IP (`req.ip`), else the shared `anonymous` key | Derives the per-request key; may be async |
| `store` | `MemoryStore({ windowMs })` | Pluggable counter storage |
| `trustProxy` | `false` | When `true`, the leftmost `x-forwarded-for` entry is used as the key |

> **WARNING — `x-forwarded-for` spoofing.** By default the key is the real
> socket peer address (`req.ip`, from Bun's `server.requestIP`), never a
> header. Only set `trustProxy: true` when your edge proxy (reverse proxy /
> CDN / load balancer) **overwrites** `x-forwarded-for`; otherwise clients can
> spoof the header to carve out their own unlimited budget. Behind a trusted
> proxy, the leftmost entry is used (the peer as seen by the edge). Requests
> without any usable address share the `anonymous` key rather than being
> exempt from limiting.

## Behavior

- Per request: derive the key via `keyBy`, then one atomic increment. Under
  the limit the handler runs and the response is wrapped with rate-limit
  headers; over the limit `next()` is never called and a 429 Problem+Json is
  returned.
- Header semantics:

| Header | Meaning |
| ------ | ------- |
| `X-RateLimit-Limit` | Configured `max` |
| `X-RateLimit-Remaining` | `max - count`, floored at 0 (0 on a 429) |
| `X-RateLimit-Reset` | Window expiry in epoch **seconds** |
| `Retry-After` | Seconds until the window resets, rounded up, never below 1 |

- The 429 error propagates through the composed chain untouched, so core's
  error middleware produces the RFC 9457 Problem+Json body and copies the
  `Retry-After` / `X-RateLimit-*` headers verbatim.

## Limiter API (lower level)

`createLimiter(store)` returns a `Limiter` with `checkLimit(store, key,
windowMs, max)`-style primitives and `RateLimitResult` / `IncrementResult`
shapes — useful for non-HTTP contexts or custom middleware.

## Stores

- `MemoryStore` (default, configurable via `MemoryStoreOptions`).
- `RateLimitStore` interface: implement to back counters with Redis, etc.
- Note: `MemoryStore` collides with `@zebra/session`'s `MemoryStore` on the
  `zebra` facade, where it is aliased. Import it unprefixed from
  `@zebra/rate-limit` directly when needed.

## Full frozen surface

See `docs/api-freeze.md` §3 `@zebra/rate-limit` — `rateLimit`, `checkLimit`,
`createLimiter`, `MemoryStore`, and the types `RateLimitOptions`, `Limiter`,
`RateLimitResult`, `IncrementResult`, `MemoryStoreOptions`, `RateLimitStore`.
