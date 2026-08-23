# Zebra

A Bun-first TypeScript web framework with first-class DI.

## Why Zebra

- **Bun-first.** Uses `Bun.serve`, `Bun.file`, and Web Standard `Request`/`Response`. No Node compat layer.
- **DI is mandatory, not bolted on.** Every app is built around a `Container`. Routes and middleware declare their dependencies; the container validates the full graph at boot.
- **Named-object route DI.** `app.get(path, { svc: Service }, (req, { svc }) => ...)` — explicit, type-safe, no string-parsing tricks.
- **Structured errors.** Default error responses follow RFC 9457 (Problem+Json).
- **Contract-first (oRPC style).** Define a contract once (`zc.get(path).params(s).query(s).body(s).output(s).status(n).errors(e).meta(m)`), implement it on the server with full type inference + runtime validation (`app.implement`), and derive a type-safe client from the same contract (`createClient` / `createTestClient`).

## Documentation

- [Docs](docs/README.md) — guides: getting started, routing, DI, middleware, HTTP, lifecycle, sessions, CORS, rate limiting, WebSocket, contract-first, testing, observability, Redis, production
- [API freeze](docs/api-freeze.md) — the frozen v1.0 surface and SemVer policy

## Install

```sh
bun add @zebra-web/zebra reflect-metadata
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

## Requirements

- **Bun ≥ 1.4.0** at runtime (the repo is pinned to `packageManager bun@1.4.0`;
  tests and CI run on the same Bun).
- **Typecheck** via `tsgo` — the native TypeScript compiler
  (`@typescript/native-preview`), configured in the root devDependencies.
- `reflect-metadata` imported once at the entry point, and
  `experimentalDecorators` + `emitDecoratorMetadata` enabled (see Install).

## Quick start

```ts
import "reflect-metadata";
import { Zebra } from "@zebra-web/zebra";

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
import { Zebra, injectable } from "@zebra-web/zebra";

@injectable() class Greeter { greet(n: string) { return `hi, ${n}`; } }

const z = new Zebra();
z.injectSingleton(Greeter);

z.get("/hi/:name", { g: Greeter }, async (req, { g }) => g.greet(req.params.name));

await z.listen({ port: 3000 });
```

### Advanced: bring your own Container

For tests that mock specific bindings or apps that share a container, construct one explicitly:

```ts
import { Container, Zebra } from "@zebra-web/zebra";

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
- **HTTP** — `ZebraRequest` with lazy body parsing, content-type-aware body parser with size limits, request helpers (`json()` / `text()` / `form()` / `stream()`), response helpers (`json` / `text` / `html` / `redirect` / `stream`), `HttpError` for structured failures.
- **Static files** — `app.static()` with path-traversal and symlink-escape defense (realpath containment), weak ETags, conditional requests, and byte ranges.
- **Lifecycle** — boot/ready/shutdown hooks, graceful draining, and disposable cleanup wired to `Bun.serve`.
- **Events** — unified async `EventBus` (`on` / `once` / `off` / `emit`, single payload per event, type-safe via a global `ZebraEvents` interface you extend), plus built-in request (`before.request` / `after.request` / `request.error`) and middleware (`before.middleware` / `after.middleware` / `middleware.error`) events.
- **Session-scoped DI** — session-id resolution, idle TTL, explicit `disposeSession()`, and request-local anonymous sessions.
- **Cookie sessions** — `@zebra-web/session` middleware: HMAC-SHA256 signed `sid` cookies, `req.ctx.session` read/write with `getSession(req)`, pluggable `SessionStore` (in-memory default), rolling TTL renewal, and session-fixation protection (destroyed/expired ids are never revived). Cookies are `HttpOnly` + `SameSite=Lax` by default; `cookie: { preset: "plain" }` restores a flag-free cookie.
- **CORS** — `@zebra-web/cors` middleware: origin allowlists (string/array/RegExp/predicate), preflight handling (204 + full header set), credentials with exact-origin echo, `Vary: Origin` on dynamic matches.
- **Rate limiting** — `@zebra-web/rate-limit` middleware: fixed-window per-key counters (lazy window rotation, atomic increments), pluggable `RateLimitStore` (in-memory default), 429 Problem+Json with `X-RateLimit-*` / `Retry-After` headers. Keys default to the socket peer IP (`req.ip`); `x-forwarded-for` is only trusted with `trustProxy: true` (required behind a proxy that overwrites it — otherwise clients can spoof their own budget).
- **WebSocket** — `app.ws(path, handler)`: upgrade path wired into `Bun.serve` with radix-router params, DI-resolved upgrade decision (`onUpgrade` + `upgrade()` → 401/500 on rejection), `open`/`message`/`close` aligned to Bun semantics, `ws.data.session` reachable via the session middleware's `wsSession` hook. Note: upgrade requests bypass `app.use` global middleware (upgrade runs before the composed middleware chain).
- **Testing** — `@zebra-web/testing` `createTestApp` runs requests in-process without opening sockets; `createTestClient` gives a typed contract client over that app.
- **Contract-first** — `@zebra-web/contract` (Standard Schema V1 builder + protocol), `app.implement` with input/output validation, `@zebra-web/client` (derived typed client, zero deps).

## Examples

- [`examples/hello`](examples/hello) — minimal Zebra app — http://localhost:3000
- [`examples/blog`](examples/blog) — DI services, route groups, structured errors — http://localhost:3001
- [`examples/contract-blog`](examples/contract-blog) — contract-first: shared contract, `app.implement`, typed client round-trip — http://localhost:3001
- [`examples/forum`](examples/forum) — full-featured: contract-first API, DI, signed-cookie sessions, per-user rate limiting, CORS, WebSocket live feed, static frontend, integration tests — http://localhost:3002
- [`examples/better-auth`](examples/better-auth) — Better Auth integration: one middleware mounts `/api/auth/*`, protected routes via server-side session checks, `bun:sqlite` storage, integration tests — http://localhost:3003

Run an example from the repo root:

```sh
bun --filter example-hello start
bun --filter example-blog start
bun --filter example-contract-blog start      # contract-first server
bun --filter example-contract-blog client     # typed client round-trip
bun --filter example-forum start              # forum: http://localhost:3002
bun --filter example-forum client             # typed client round-trip
bun --filter example-forum test               # in-process integration tests
bun --filter example-better-auth start        # better-auth: http://localhost:3003
bun --filter example-better-auth test         # in-process integration tests
```

## Packages

| Package           | What it is                                          |
| ----------------- | --------------------------------------------------- |
| `@zebra-web/zebra`           | Public facade — re-exports `@zebra-web/core`, `@zebra-web/session` |
| `@zebra-web/core`     | App, DI container, router, HTTP, middleware, `implement`, event bus |
| `@zebra-web/contract` | Contract builder + protocol (Standard Schema V1, zero deps) |
| `@zebra-web/client`   | Derived type-safe client (zero deps)                |
| `@zebra-web/session`  | Cookie sessions: HMAC-signed `sid`, pluggable store, fixation-safe |
| `@zebra-web/cors`     | CORS middleware: preflight, origin allowlists, credentials echo |
| `@zebra-web/rate-limit` | Fixed-window rate limiting: 429 Problem+Json, `X-RateLimit-*` headers, pluggable store |
| `@zebra-web/testing`  | `createTestApp` / `createTestClient` in-process     |

## Status

**v1.0.0 is in preparation: API freeze is complete.** The public API surface of
all packages (`@zebra-web/zebra` facade, `@zebra-web/core`, `@zebra-web/contract`, `@zebra-web/client`,
`@zebra-web/testing`, `@zebra-web/session`, `@zebra-web/cors`, `@zebra-web/rate-limit`) is frozen
as of [docs/api-freeze.md](docs/api-freeze.md) — that document defines the v1
stability promise and the SemVer version policy (what requires a major). The
framework includes DI (singleton / request / session / transient scopes), radix
router, middleware, lifecycle, static files, WebSocket (`app.ws()` with DI
upgrade decision), contract-first (`@zebra-web/contract`, `app.implement`,
`@zebra-web/client`, `createTestClient`), cookie sessions, CORS, rate limiting, and
testing helpers. Final v1.0.0 release tracks the remaining C2–C4 items (docs
site, benchmarks, release pipeline).

## Release & packaging

All packages publish `src` **directly**: `main`, `types`, and `exports["."]`
point at `./src/index.ts`, and the tarball ships only `src/` (`files: ["src"]`).
No build step runs on publish — consumers get the TypeScript sources and Bun's
native TS support runs them directly (bundler-resolution consumers get the
same files).

`bun run build` produces `dist/` bundles (`--target bun --packages external`)
for bundler/edge consumers who prefer prebuilt artifacts, but `dist/` is **not
part of the published tarball** (`files: ["src"]` excludes it).

`bun run verify:packages` packs every publishable package into a tarball and
smoke-tests each one from a fresh install: contents (`src/index.ts` present,
no `dist/` leakage), exports/types resolution, runtime imports, and a tsgo
typecheck of the installed packages. It guards the src-direct strategy above.

Versions are bumped in lockstep across all packages by
[`scripts/release.ts`](scripts/release.ts). For a public npm release, pass the
official registry explicitly:

```sh
bun run release -- --version X.Y.Z --registry https://registry.npmjs.org
bun run release -- --version X.Y.Z --prepare
bun run release -- --version X.Y.Z --registry https://registry.npmjs.org --publish
```

For the recommended GitHub flow, run `--prepare`, push the commit and tag with
`git push origin master --follow-tags`, then create and publish a GitHub Release
for that tag. The `Publish npm packages` workflow runs the checks and publishes
all `@zebra-web/*` packages automatically. Configure the repository secret
`NPM_TOKEN` with a granular npm token that has package read/write access for the
`@zebra-web` scope and 2FA bypass enabled. See [CONTRIBUTING.md](CONTRIBUTING.md)
and [SECURITY.md](SECURITY.md).

## License

MIT
