# Quick start

Zebra is a **Bun-first** TypeScript web framework with first-class DI. It
runs on `Bun.serve` and Web Standard `Request`/`Response` — no Node compat
layer.

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

## Hello world

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

## With DI

Register services on the `Zebra` instance and pull them into routes by name:

```ts
import "reflect-metadata";
import { Zebra, injectable } from "zebra";

@injectable() class Greeter { greet(n: string) { return `hi, ${n}`; } }

const z = new Zebra();
z.injectSingleton(Greeter);

z.get("/hi/:name", { g: Greeter }, async (req, { g }) => g.greet(req.params.name));

await z.listen({ port: 3000 });
```

## Advanced: bring your own Container

For tests that mock specific bindings or apps that share a container,
construct one explicitly:

```ts
import { Container, Zebra } from "zebra";

const container = new Container();
container.bind(IRepo).to(MockRepo);
const z = new Zebra({ container });
```

`z.inject*` methods write to whichever container the `Zebra` instance owns.

## Examples in this repo

- `examples/hello` — minimal Zebra app.
- `examples/blog` — DI services, route groups, structured errors.
- `examples/contract-blog` — contract-first: shared contract, `app.implement`,
  typed client round-trip.

Run them from the repo root:

```sh
bun --filter example-hello start
bun --filter example-blog start
bun --filter example-contract-blog start      # contract-first server
bun --filter example-contract-blog client     # typed client round-trip
```
