# Getting Started

Zebra is a Bun-first TypeScript web framework. This guide covers installation, configuration, and your first app.

## Install

```sh
bun add zebra reflect-metadata
```

`zebra` is the public facade — it re-exports `@zebra/core`, `@zebra/session`, `@zebra/cors`, and (aliased) `@zebra/rate-limit`. You can also install individual sub-packages directly:

```sh
bun add @zebra/contract @zebra/client @zebra/testing
bun add @zebra/session @zebra/cors @zebra/rate-limit
bun add @zebra/observability @zebra/redis
```

## Runtime requirements

- **Bun ≥ 1.1.30** (runtime). The repo's test suite uses APIs added in Bun 1.3 (`expectTypeOf`, WebSocket client helpers), so tests and CI run on Bun ≥ 1.3.
- **TypeScript ≥ 5.6**.
- `reflect-metadata` imported once at the entry point, and decorators enabled in `tsconfig.json`:

```json
{
  "compilerOptions": {
    "experimentalDecorators": true,
    "emitDecoratorMetadata": true
  }
}
```

Import `reflect-metadata` once, before anything else:

```ts
import "reflect-metadata";
import { Zebra } from "zebra";
```

## First app

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

`z.listen()` performs, in order:

1. runs all `boot` hooks;
2. validates the whole dependency graph (every DI binding plus the deps declared by routes and middleware) — unbound tokens, circular dependencies, and scope violations fail fast with an error;
3. precompiles a per-route execution plan (middleware chain, dep indices, scope requirement) so dispatch does zero per-request inspection.

Once validation passes, the app is `ready` (the `ready` hooks run after) and starts accepting connections.

## App with dependencies

Declare dependencies with the `@injectable()` decorator, register them on the `Zebra` instance, and pull them into routes by name:

```ts
import "reflect-metadata";
import { Zebra, injectable } from "zebra";

@injectable()
class Greeter {
  greet(n: string) {
    return `hi, ${n}`;
  }
}

const z = new Zebra();
z.injectSingleton(Greeter);

z.get("/hi/:name", { g: Greeter }, async (req, { g }) => g.greet(req.params.name));

await z.listen({ port: 3000 });
```

`{ g: Greeter }` is **named-object route DI**: the second argument declares the route's dependencies, and the third (the handler) receives a second argument with exactly those dependencies resolved. Both `req.params` and the deps are fully type-inferred.

## Value encoding rules

A handler's return value is encoded by `Zebra.toResponse`:

| Return value | Result |
| --- | --- |
| `Response` | passed through unchanged (never wrapped or modified) |
| `undefined` | empty 204 response |
| anything else (objects, strings, numbers, `null`) | `JSON.stringify` encoded, `content-type: application/json; charset=utf-8`, status 200 |

> Note: plain strings are also JSON-encoded (a `"hi"` comes back quoted). Use the `text()` response helper or construct a `Response` when you need the raw string. Use the [response helpers](05-http.md#response-helpers) when you want explicit control.

## Bring your own Container

For tests that mock specific bindings, or apps that share a container, construct one explicitly:

```ts
import { Container, Zebra } from "zebra";

const container = new Container();
container.bind(IRepo).to(MockRepo);
const z = new Zebra({ container });
```

`z.inject*` methods write to whichever container the `Zebra` instance owns.

## Constructor options

`new Zebra(opts)` supports:

| Option | Description |
| --- | --- |
| `container` | custom `Container` (a fresh one is created by default) |
| `body` | request body size limit overrides (see [HTTP](05-http.md#request-body)) |
| `errors.exposeStack` | include `stack` in Problem+Json responses (default `false`) |
| `session` / `sessionResolver` / `sessionTtl` | session-scoped DI resolver and TTL (see [Session scope](03-di.md#session-scope)) |
| `gracePeriod` | graceful shutdown wait (ms, default `10_000`) |
| `requestTimeout` | per-request deadline (ms); a timeout answers 504 `request_timeout` (see [HTTP](05-http.md#request-timeout)) |
| `trustProxy` | app-level statement that `x-forwarded-for` may be trusted (default `false`) |

## Next steps

- [Routing & groups](02-routing.md)
- [Dependency injection](03-di.md)
- [Middleware](04-middleware.md)
- [Contract-first APIs](11-contract-first.md)

The repo ships a minimal example at `examples/hello`:

```sh
bun --filter example-hello start
```
