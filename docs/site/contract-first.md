# Contract-first

Contract-first (oRPC style): define a contract once with the chained,
immutable `zc` builder, implement it on the server with full type inference +
runtime validation (`app.implement`), and derive a type-safe client from the
same contract (`createClient` / `createTestClient`).

Packages: `@zebra/contract` (builder + protocol), `@zebra/client` (derived
client), plus `app.implement` in `@zebra/core`. `@zebra/contract` and
`@zebra/client` are **not** re-exported by the `zebra` facade — import them
from their own packages.

## 1. Define the contract

```ts
import { zc } from "@zebra/contract";
import { z } from "zod";

export const blogContract = {
  list: zc
    .get("/blogs")
    .query(z.object({ page: z.coerce.number().min(1).default(1) }))
    .output(z.array(Blog)),
  get: zc
    .get("/blogs/:id")
    .params(z.object({ id: z.coerce.number().int() }))
    .output(Blog)
    .errors({ blog_not_found: { status: 404 } }),
  create: zc
    .post("/blogs")
    .body(z.object({ title: z.string().min(1), content: z.string() }))
    .output(Blog)
    .status(201)
    .meta({ summary: "Create a blog post", tags: ["blogs"] }),
  remove: zc
    .delete("/blogs/:id")
    .params(z.object({ id: z.coerce.number().int() }))
    .status(204),
};
```

The chain is immutable — each step returns a new procedure definition.
Schemas use **Standard Schema V1** (`~standard`), so Zod, Valibot, and
ArkType all work. Contracts are frozen, pure-data definitions. `prefix()` can
rewrite a contract's paths for reuse under a mount point.

## 2. Implement it on the server

Bulk form with shared deps; per-procedure middlewares via
`{ handler, middlewares }`:

```ts
import "reflect-metadata";
import { HttpError, Zebra } from "zebra";

const z = new Zebra();
z.injectSingleton(BlogRepo);
z.injectSingleton(BlogService);

z.implement(
  blogContract,
  { blog: BlogService },
  {
    list: async (_req, { blog }) => blog.list(),
    get: async (req, { blog }) => {
      const found = await blog.find(req.params.id);
      if (!found) throw new HttpError(404, "blog_not_found", `blog ${req.params.id} not found`);
      return found;
    },
    create: async (req, { blog }) => {
      const body = await req.body();
      return blog.create(body.title, body.content);
    },
    remove: async (req, { blog }) => {
      await blog.remove(req.params.id);
    },
  },
);
```

Single form with per-procedure deps + opts:

```ts
z.implement(blogContract.get, { blog: BlogService }, handler, { middlewares: [mw] });
```

### Implementation semantics

- `params` / `query` / `body` are validated at runtime — failures answer
  **422** with prefixed issues.
- `output` is re-validated and **stripped** (extra fields removed) before
  sending.
- A raw `Response` return passes through untouched (escape hatch).
- `status(204)` procedures answer with an empty body.
- `z.routeTable` and `RegisteredRoute.contract` expose the registered
  routes — the OpenAPI / introspection seam.

## 3. Derive a type-safe client

```ts
import { createClient } from "@zebra/client";

// The client depends only on the contract — no server code.
const api = createClient(blogContract, { baseUrl: "http://localhost:3001" });

const created = await api.create({
  body: { title: "contract-first", content: "hello from the typed client" },
});
const list = await api.list({ query: { page: 1 } });
const got = await api.get({ params: { id: created.id } });
```

- Non-2xx responses throw `ClientError { status, code, problem, response }`.
- Zero runtime deps, browser-safe (`fetch` and headers are injectable).

## 4. In-process testing

`createTestClient` from `@zebra/testing` derives a typed client over an
in-process test app (see [Testing](testing.md)).

## Full example

See `examples/contract-blog` — shared contract, `app.implement`, typed client
round-trip (`bun --filter example-contract-blog start` / `client`).
