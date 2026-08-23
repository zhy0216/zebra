# Zebra Documentation

Zebra is a Bun-first TypeScript web framework with first-class dependency injection.

- **Bun-first** — built directly on `Bun.serve` / `Bun.file` and Web Standard `Request` / `Response`. No Node compat layer.
- **DI is mandatory, not bolted on.** Every app is built around a `Container`. Routes and middleware declare their dependencies; the container validates the full graph at boot.
- **Named-object route DI.** `app.get(path, { svc: Service }, (req, { svc }) => ...)` — explicit, type-safe, no string-parsing tricks.
- **Structured errors.** Default error responses follow RFC 9457 (Problem+Json).
- **Contract-first (oRPC style).** Define a contract once (`zc.get(path).params(s).query(s).body(s).output(s).status(n).errors(e).meta(m)`), implement it on the server with full type inference + runtime validation (`app.implement`), and derive a type-safe client from the same contract (`createClient` / `createTestClient`).

> 中文文档：[简体中文](zh/README.md)

## Guide Index

### Getting started

| Guide | What it covers |
| --- | --- |
| [01-getting-started](01-getting-started.md) | Installation, runtime requirements, quick start, first app |

### Core (`@zebra-web/core` / `@zebra-web/zebra`)

| Guide | What it covers |
| --- | --- |
| [02-routing](02-routing.md) | Routing: path params, wildcards, HTTP methods, groups, 405 / automatic OPTIONS |
| [03-di](03-di.md) | Dependency injection: `Container`, four scopes, `token`, boot-time graph validation |
| [04-middleware](04-middleware.md) | Middleware: Koa-style compose, dependency-aware `middleware()`, error middleware |
| [05-http](05-http.md) | HTTP: `ZebraRequest`, request body parsing, response helpers, `HttpError` / Problem+Json, static files, request timeout |
| [06-lifecycle](06-lifecycle.md) | Lifecycle: boot / ready / shutdown hooks, graceful shutdown, session scope reclamation |
| [10-websockets](10-websockets.md) | WebSocket: `app.ws()`, DI-resolved upgrade decision, ws sessions |

### Contract-first (`@zebra-web/contract` + `@zebra-web/client`)

| Guide | What it covers |
| --- | --- |
| [11-contract-first](11-contract-first.md) | Contract building, `app.implement`, type-safe client, error handling |
| [16-mcp](16-mcp.md) | MCP tools from the same contract (`@zebra-web/mcp`, `@zebra-web/schema-zod`) |

### Middleware packages

| Guide | What it covers |
| --- | --- |
| [07-sessions](07-sessions.md) | Cookie sessions (`@zebra-web/session`): HMAC-signed `sid`, pluggable store, session-fixation protection |
| [08-cors](08-cors.md) | CORS (`@zebra-web/cors`): preflight, origin allowlists, exact-origin credentials echo |
| [09-rate-limiting](09-rate-limiting.md) | Rate limiting (`@zebra-web/rate-limit`): fixed window, `X-RateLimit-*` headers, `trustProxy` |
| [13-observability](13-observability.md) | Observability (`@zebra-web/observability`): requestId / accessLog / errorReporter / metrics / health |
| [14-redis](14-redis.md) | Redis storage adapters (`@zebra-web/redis`): rate-limit store + session store |

### Testing & release

| Guide | What it covers |
| --- | --- |
| [12-testing](12-testing.md) | Testing (`@zebra-web/testing`): in-process `createTestApp` / `createTestClient` |
| [15-production](15-production.md) | Deployment & release: src-direct publishing, lockstep versions, benchmarks |
| [api-freeze](api-freeze.md) | v1 frozen API surface and SemVer version policy |

## Packages

| Package | What it is |
| --- | --- |
| `@zebra-web/zebra` | Public facade — re-exports `@zebra-web/core`, `@zebra-web/cors`, `@zebra-web/session`, and (aliased) `@zebra-web/rate-limit` |
| `@zebra-web/core` | App, DI container, router, HTTP, middleware, `implement` |
| `@zebra-web/contract` | Contract builder + protocol (Standard Schema V1, zero deps) |
| `@zebra-web/client` | Derived type-safe client (zero deps) |
| `@zebra-web/session` | Cookie sessions: HMAC `sid`, pluggable store, fixation-safe |
| `@zebra-web/cors` | CORS middleware: preflight, origin allowlists, credentials echo |
| `@zebra-web/rate-limit` | Fixed-window rate limiting: 429 Problem+Json, `X-RateLimit-*` headers, pluggable store |
| `@zebra-web/observability` | Observability middleware: requestId / accessLog / errorReporter / metrics / health |
| `@zebra-web/redis` | Redis backends: `RedisRateLimitStore` + `RedisSessionStore` (zero runtime deps) |
| `@zebra-web/testing` | In-process `createTestApp` / `createTestClient` |

## Examples

The repo ships a progression of runnable examples:

```sh
bun --filter example-hello start           # minimal app — http://localhost:3000
bun --filter example-blog start            # DI services + route groups + structured errors — http://localhost:3001
bun --filter example-contract-blog start   # contract-first: contract + implement + typed client
bun --filter example-forum start           # full-featured: contract API + sessions + rate limiting + CORS + WS + static frontend — http://localhost:3002
bun --filter example-better-auth start     # Better Auth integration — http://localhost:3003
```

See the repo [README](../README.md) for the full list.
