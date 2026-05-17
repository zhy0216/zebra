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
import { Container, Zebra } from "zebra";

const app = new Zebra({ container: new Container() });

app.get("/hello/:name", async (req) => `hello, ${req.params.name}`);

await app.listen({ port: 3000 });
```

```sh
bun run src/main.ts
curl http://localhost:3000/hello/world
# hello, world
```

## Features

- **DI container** — `@injectable` classes, token bindings, four scopes (singleton / request / session / transient), boot-time circular-dependency and scope checks.
- **Routing** — radix-tree router with params (`/:id`) and wildcards; `app.get` / `post` / `put` / `delete`.
- **Groups** — `app.group("/blogs", g => { ... })` with prefix and per-group middleware scoping.
- **Middleware** — Koa-style compose, dep-aware `middleware()` helper, default Problem+Json error middleware.
- **HTTP** — `ZebraRequest` with lazy body parsing, content-type-aware body parser with size limits, `HttpError` for structured failures.
- **Static files** — `app.static()` with path-traversal defense.
- **Lifecycle** — boot/start/stop hooks wired to `Bun.serve`.
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

v0.1 MVP — under construction. Today: DI container, radix router, middleware, app + lifecycle, static files, testing helpers. See the [design spec](docs/superpowers/specs/2026-05-16-zebra-v2-design.md) for the full v0.1 → v1.0 surface (validation, OpenAPI, session, WebSocket, CORS, rate-limit are planned packages).

## License

MIT
