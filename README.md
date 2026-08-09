# Zebra

A Bun-first TypeScript web framework with first-class DI.

> v2 is a rewrite. v1 (2019) is archived on the `v1-archive` tag.

## Why Zebra

- **Bun-first.** Uses `Bun.serve`, `Bun.file`, and Web Standard `Request`/`Response`. No Node compat layer.
- **DI is mandatory, not bolted on.** Every app is built around a `Container`. Routes and middleware declare their dependencies; the container validates the full graph at boot.
- **Named-object route DI.** `app.get(path, { svc: Service }, (req, { svc }) => ...)` — explicit, type-safe, no string-parsing tricks.
- **Structured errors.** Default error responses follow RFC 9457 (Problem+Json).
- **Contract-first (oRPC style).** Define a contract once (`zc.get(path).params(s).query(s).body(s).output(s).status(n).errors(e).meta(m)`), implement it on the server with full type inference + runtime validation (`app.implement`), and derive a type-safe client from the same contract (`createClient` / `createTestClient`).

## Install

```sh
bun add zebra reflect-metadata
```

Decorator support is required in your `tsconfig.json`:

```json
{
  "compilerOptions": {
    "experimentalDecorators": true,
    "emitDecoratorMetadata": true
  }
}
```

Import `reflect-metadata` once at your entry point, before anything else.

## Quick start

```ts
import "reflect-metadata";
import { Zebra } from "zebra";

const z = new Zebra();

z.get("/hello/:name", async (req) => new Response(`hello, ${req.params.name}`));

await z.listen({ port: 3000 });
```

```sh
bun run src/main.ts
curl http://localhost:3000/hello/world
# hello, world
```

With dependencies, register them on the `Zebra` instance and pull them into routes by name:

```ts
import "reflect-metadata";
import { Zebra, injectable } from "zebra";

@injectable() class Greeter { greet(n: string) { return `hi, ${n}`; } }

const z = new Zebra();
z.injectSingleton(Greeter);

z.get("/hi/:name", { g: Greeter }, async (req, { g }) => g.greet(req.params.name));

await z.listen({ port: 3000 });
```

### Advanced: bring your own Container

For tests that mock specific bindings or apps that share a container, construct one explicitly:

```ts
import { Container, Zebra } from "zebra";

const container = new Container();
container.bind(IRepo).to(MockRepo);
const z = new Zebra({ container });
```

`z.inject*` methods write to whichever container the `Zebra` instance owns.

## Features

- **DI container** — `@injectable` classes, token bindings, four scopes (singleton / request / session / transient), boot-time circular-dependency and scope checks.
- **Routing** — radix-tree router with params (`/:id`) and wildcards; `app.get` / `post` / `put` / `patch` / `delete`.
- **Groups** — `app.group("/blogs", g => { ... })` with prefix and per-group middleware scoping.
- **Middleware** — Koa-style compose, dep-aware `middleware()` helper, default Problem+Json error middleware.
- **HTTP** — `ZebraRequest` with lazy body parsing, content-type-aware body parser with size limits, `HttpError` for structured failures.
- **Static files** — `app.static()` with path-traversal defense, weak ETags, conditional requests, and byte ranges.
- **Lifecycle** — boot/ready/shutdown hooks, graceful draining, and disposable cleanup wired to `Bun.serve`.
- **Session-scoped DI** — session-id resolution, idle TTL, explicit `disposeSession()`, and request-local anonymous sessions.
- **Cookie sessions** — `@zebra/session` middleware: HMAC-SHA256 signed `sid` cookies, `req.ctx.session` read/write with `getSession(req)`, pluggable `SessionStore` (in-memory default), rolling TTL renewal, and session-fixation protection (destroyed/expired ids are never revived).
- **CORS** — `@zebra/cors` middleware: origin allowlists (string/array/RegExp/predicate), preflight handling (204 + full header set), credentials with exact-origin echo, `Vary: Origin` on dynamic matches.
- **Rate limiting** — `@zebra/rate-limit` middleware: fixed-window per-key counters (lazy window rotation, atomic increments), pluggable `RateLimitStore` (in-memory default), 429 Problem+Json with `X-RateLimit-*` / `Retry-After` headers.
- **WebSocket** — `app.ws(path, handler)`: upgrade path wired into `Bun.serve` with radix-router params, DI-resolved upgrade decision (`onUpgrade` + `upgrade()` → 401/500 on rejection), `open`/`message`/`close` aligned to Bun semantics, `ws.data.session` reachable via the session middleware's `wsSession` hook. Note: upgrade requests bypass `app.use` global middleware (upgrade runs before the composed middleware chain).
- **Testing** — `@zebra/testing` `createTestApp` runs requests in-process without opening sockets; `createTestClient` gives a typed contract client over that app.
- **Contract-first** — `@zebra/contract` (Standard Schema V1 builder + protocol), `app.implement` with input/output validation, `@zebra/client` (derived typed client, zero deps).

## Examples

- [`examples/hello`](examples/hello) — minimal Zebra app.
- [`examples/blog`](examples/blog) — DI services, route groups, structured errors.
- [`examples/contract-blog`](examples/contract-blog) — contract-first: shared contract, `app.implement`, typed client round-trip.

Run an example from the repo root:

```sh
bun --filter example-hello start
bun --filter example-blog start
bun --filter example-contract-blog start      # contract-first server
bun --filter example-contract-blog client     # typed client round-trip
```

## Packages

| Package           | What it is                                          |
| ----------------- | --------------------------------------------------- |
| `zebra`           | Public facade — re-exports `@zebra/core`, `@zebra/session` |
| `@zebra/core`     | App, DI container, router, HTTP, middleware, `implement` |
| `@zebra/contract` | Contract builder + protocol (Standard Schema V1, zero deps) |
| `@zebra/client`   | Derived type-safe client (zero deps)                |
| `@zebra/session`  | Cookie sessions: HMAC-signed `sid`, pluggable store, fixation-safe |
| `@zebra/cors`     | CORS middleware: preflight, origin allowlists, credentials echo |
| `@zebra/rate-limit` | Fixed-window rate limiting: 429 Problem+Json, `X-RateLimit-*` headers, pluggable store |
| `@zebra/testing`  | `createTestApp` / `createTestClient` in-process     |

## Status

v0.2.0 is released: core (DI, radix router, middleware, lifecycle, static files) + contract-first (`@zebra/contract`, `app.implement`, `@zebra/client`, `createTestClient`) + testing helpers + examples. v0.3 is complete: `@zebra/session`, `@zebra/cors`, and `@zebra/rate-limit` middleware shipped with tests. v0.4 in progress: WebSocket (`app.ws()` with DI upgrade decision and session-scope integration) is implemented in core with end-to-end tests; v1.0 tracks API freeze, docs site, and benchmarks.

## License

MIT
