# Contract-first APIs

Zebra's contract-first pattern (oRPC style): **define the contract once**, then implement it server-side (`app.implement`) and call it client-side (`createClient` / `createTestClient`) — both derive types and runtime validation from the same contract.

- `@zebra/contract` — the `zc` contract builder (Standard Schema V1, zero deps)
- `@zebra/core` — `app.implement` (input/output validation)
- `@zebra/client` — the derived type-safe client (zero deps)

## Building a contract

```ts
import { zc } from "@zebra/contract";
import { z } from "zod";

export const Blog = z.object({ id: z.number(), title: z.string(), content: z.string() });

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

### Builder methods (chainable, immutable)

| Method | Purpose | Constraint |
| --- | --- | --- |
| `zc.get/post/put/patch/delete/head/options(path)` | create a procedure (method + path) | — |
| `.params(schema)` | path-params schema | — |
| `.query(schema)` | query-params schema | — |
| `.body(schema)` | request-body schema | **not allowed on GET/HEAD** (rejected at compile time and runtime) |
| `.output(schema)` | response-body schema | — |
| `.status(n)` | response status (default 200) | — |
| `.errors({ code: { status } })` | declare error codes | documentation / type-level error contract |
| `.meta(record)` | arbitrary metadata (OpenAPI summary, etc.) | — |
| `.mcp(name, description, options?)` | expose as an MCP tool (see [MCP Tools](16-mcp.md)) | — |

Schemas are **Standard Schema V1**-compatible validators (zod 4, valibot, ...). Every call returns a new frozen procedure — safe to share and compose.

### Composition: nested routers and `prefix()`

```ts
import { prefix } from "@zebra/contract";

const postContract = {
  list: zc.get("/"),
  get: zc.get("/:id"),
};

const api = {
  posts: prefix("/posts", postContract),   // /posts, /posts/:id
  users: prefix("/users", { list: zc.get("/") }),
};
```

### Type inference

```ts
import type { InferBody, InferOutput, InferParams, InferQuery } from "@zebra/contract";

type CreateBody = InferBody<typeof blogContract.create>;   // { title: string; content: string }
type BlogOut = InferOutput<typeof blogContract.get>;        // Blog
```

## Server-side: `app.implement`

```ts
import { Zebra } from "@zebra/core";
import { blogContract } from "./contract";

const app = new Zebra();
app.injectSingleton(BlogService);

app.implement(blogContract, { blog: BlogService }, {
  list: async (req, { blog }) => blog.list(req.query.page),
  get: async (req, { blog }) => {
    const b = await blog.find(req.params.id);
    if (b === undefined) throw new HttpError(404, "blog_not_found", "No such blog");
    return b;
  },
  create: async (req, { blog }) => blog.create(await req.body()),
  remove: async (req, { blog }) => {
    await blog.remove(req.params.id);
  }, // status 204 → return undefined
});
```

Signature:

```ts
implement(procOrRouter, handlerOrImpls);
implement(procOrRouter, deps, handlerOrImpls, opts?);
```

### Runtime validation flow

The handler is wrapped by `buildContractHandler`, which runs in spec order:

1. **params** validation → failures recorded
2. **query** validation → aggregated with params; all failures throw `ValidationError` (422, `errors` array with `params.*` / `query.*` prefixes)
3. **body** validation → failure throws 422; on success `req.body()` is replaced by the validated value
4. **handler** runs
5. **output** validation (`validateOutput: true` by default) → failure throws 500 `output_validation_failed`
6. serialization: `JSON.stringify(payload)` + the contract-declared `status` (default 200)

A handler returning a `Response` is passed through unchanged (skipping output validation and serialization); with `status: 204`, the handler must return `undefined` (returning a `Response` throws `invalid_contract_response`).

### Route-level middleware

A procedure-level impl can be `{ middlewares, handler }`, or middleware can be passed via `opts.middlewares`:

```ts
app.implement(
  blogContract,
  { blog: BlogService },
  {
    create: {
      middlewares: [requireAuth(), writeLimit],
      handler: async (req, { blog }) => blog.create(await req.body()),
    },
  },
);
```

### Implementation completeness check

`implement` walks the **whole** contract tree exhaustively; missing / extra / malformed leaves in the impl throw at registration time (a `missing:` / `extra:` / `invalid:` manifest) — a missed endpoint surfaces at boot, not after deploy.

## Client-side: `createClient`

```ts
import { createClient } from "@zebra/client";
import { blogContract } from "./contract";

const client = createClient(blogContract, {
  baseUrl: "http://localhost:3001",
  headers: () => ({ authorization: `Bearer ${token()}` }), // dynamic headers
});

const blogs = await client.list({ query: { page: 1 } });   // Blog[]
const blog = await client.get({ params: { id: 1 } });      // Blog
const created = await client.create({ body: { title: "T", content: "C" } }); // Blog, 201
await client.remove({ params: { id: 1 } });                // undefined (204)
```

Type safety:

- Arguments appear per declaration: `list` requires `{ query }`, `get` requires `{ params }`, `create` requires `{ body }` (not required when undeclared).
- Return type = the `output` schema's `InferOutput`; `status: 204` → `undefined`.

### Argument shape

```ts
interface ClientArgs<Def> = {
  params?: ...;   // only when the contract declares a params schema
  query?: ...;    // only when it declares query
  body?: ...;     // only when it declares body (no GET/HEAD)
  headers?: Record<string, string>; // per-call header overrides
  signal?: AbortSignal;             // cancellation
};
```

`createClient(router, opts)` options: `baseUrl` (required), `fetch` (custom fetch, for test injection), `headers` (static or function).

### Error handling

Non-2xx responses throw `ClientError`:

```ts
import { ClientError } from "@zebra/client";

try {
  await client.get({ params: { id: 999 } });
} catch (e) {
  if (e instanceof ClientError) {
    e.status;    // 404
    e.code;      // "blog_not_found" (derived from the Problem+Json type)
    e.problem;   // full Problem+Json
    e.response;  // the raw Response
  }
}
```

Code derivation: prefer `type: "https://errors.zebra.dev/<code>"`, else map from status (`bad_request` / `unauthorized` / `forbidden` / `not_found` / `validation_failed` / `http_<status>`). Non-JSON error bodies fall back to `request_failed`.

## Testing: `createTestClient`

[`@zebra/testing`](12-testing.md)'s `createTestClient` connects the same contract to an in-process `TestApp`, zero sockets:

```ts
import { createTestApp, createTestClient } from "@zebra/testing";

const app = createTestApp();  // or a composition root like buildForumApp()
// ... register routes/contracts ...
const client = createTestClient(app, blogContract);

const blogs = await client.list({ query: { page: 1 } });
```

## Hand-written routes vs contract-first

| | Hand-written | Contract-first |
| --- | --- | --- |
| Validation | manual | params/query/body/output fully automatic |
| Client types | hand-written | derived from the contract |
| Error-code contract | doc convention | typed via `errors()` |
| Runtime guarantees | none | implement completeness check + input/output validation |

## Next steps

- [Testing: in-process contract clients](12-testing.md)
- [forum example: contract + sessions + rate limiting + ws](README.md#examples)
- [contract-blog example: contract definition + typed client round-trip](README.md#examples)
