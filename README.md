# Zebra

A Bun-first TypeScript web framework with first-class DI.

> v2 is a rewrite. v1 (2019) is archived on the `v1-archive` tag.

## Why Zebra

- **Bun-first.** Uses `Bun.serve`, `Bun.file`, and Web Standard `Request`/`Response`. No Node compat layer.
- **DI is mandatory, not bolted on.** Every app is built around a `Container`. Routes and middleware declare their dependencies; the container validates the full graph at boot.
- **Named-object route DI.** `app.get(path, { svc: Service }, (req, { svc }) => ...)` — explicit, type-safe, no string-parsing tricks.
- **Structured errors.** Default error responses follow RFC 9457 (Problem+Json).

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
- **Routing** — radix-tree router with params (`/:id`) and wildcards; `app.get` / `post` / `put` / `delete`.
- **Groups** — `app.group("/blogs", g => { ... })` with prefix and per-group middleware scoping.
- **Middleware** — Koa-style compose, dep-aware `middleware()` helper, default Problem+Json error middleware.
- **HTTP** — `ZebraRequest` with lazy body parsing, content-type-aware body parser with size limits, `HttpError` for structured failures.
- **Static files** — `app.static()` with path-traversal defense, weak ETags, conditional requests, and byte ranges.
- **Lifecycle** — boot/ready/shutdown hooks, graceful draining, and disposable cleanup wired to `Bun.serve`.
- **Session-scoped DI** — session-id resolution, idle TTL, explicit `disposeSession()`, and request-local anonymous sessions.
- **Testing** — `@zebra/testing` `createTestApp` runs requests in-process without opening sockets.

## Examples

- [`examples/hello`](examples/hello) — minimal Zebra app.
- [`examples/blog`](examples/blog) — DI services, route groups, structured errors.

Run an example from the repo root:

```sh
bun --filter example-hello start
bun --filter example-blog start
```

## Packages

| Package          | What it is                                          |
| ---------------- | --------------------------------------------------- |
| `zebra`          | Public facade — re-exports `@zebra/core`            |
| `@zebra/core`    | App, DI container, router, HTTP, middleware         |
| `@zebra/testing` | `createTestApp` for in-process integration tests    |

## Status

v0.1 MVP is implemented. The core, testing helper, facade, examples, and all v0.1 behaviors are covered by the repository test suite. See the [design spec](docs/superpowers/specs/2026-05-16-zebra-v2-design.md) for the full v0.1 → v1.0 surface; validation, OpenAPI, cookie-session middleware, WebSocket, CORS, and rate-limit remain planned packages.

## License

MIT
