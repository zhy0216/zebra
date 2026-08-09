# Zebra Contract-First (oRPC 风格) Design Spec

**Date**: 2026-08-09
**Status**: Approved — claims the v0.2 version slot (replaces the originally planned `@zebra/validation` + `@zebra/openapi`; OpenAPI slips to v0.3)
**Scope**: Contract + server implementation + type-safe client. No OpenAPI generation (seams left), no inline-schema route form (v2 spec §8.1 is superseded).

---

## 1. Background

Zebra v0.1 MVP is complete: DI container, radix router, middleware chain, boot validation. The next step is oRPC-style **contract-first**: a contract (method/path + params/query/body/output schemas) is defined independently → the server implementation is constrained and runtime-validated by the contract → the client is derived type-safely from the same contract.

Schema layer: **Standard Schema V1** (`~standard` key; Zod / Valibot / ArkType / any compliant validator; zero runtime dependencies for us).

### Verified seams (all read from source)

- `RouteHandler<D, P, B, Q>` / `ZebraRequest<P, B, Q>` have dormant B/Q generics never inferred (`packages/core/src/app/types.ts:33`, `http/request.ts:3`) — the injection point for contract types.
- `ValidationError(issues)` → 422 Problem+Json channel exists, exported, but core never throws it (`http/errors.ts:18,50`) — the landing spot for input validation failures.
- `toResponse` (`app.ts:465`) passes `Response` instances through — a wrapping handler can build its own Response to control status; `dispatch`/`toResponse` need zero changes.
- `buildRequest` returns a mutable object literal (`http/request.ts:29`) — the body thunk can be replaced, params/query rewritten.
- `protected register(method, path, deps, handler, extraMws)` (`app.ts:272`) + `assertNotFrozen`; `performPrepare`'s `validateGraph` automatically covers contract routes' deps.
- `@zebra/testing` `request()` accepts full URLs (`testing/src/index.ts:11`) — `createTestClient` needs zero core changes.
- Workspace wildcard `packages/*` auto-adopts new packages.

## 2. Design decisions

### 2.1 Protocol layer: `~zebra` marker key

Each contract procedure carries a **frozen pure-data def**:

```ts
interface ContractProcedureDef {
  readonly version: 1;
  readonly method: Method;                      // "GET" | "POST" | "PUT" | "PATCH" | "DELETE"
  readonly path: string;
  readonly params: StandardSchemaV1 | undefined;
  readonly query: StandardSchemaV1 | undefined;
  readonly body: StandardSchemaV1 | undefined;
  readonly output: StandardSchemaV1 | undefined;
  readonly status: number;
  readonly errors: Readonly<Record<string, ErrorSpec>>;   // ErrorSpec = { status: number }
  readonly meta: Readonly<Record<string, unknown>> | undefined;
}
```

- `@zebra/contract` (producer), `@zebra/core` (server consumer), `@zebra/client` (browser consumer) each vendor a ~60-line protocol interface + ~90-line `StandardSchemaV1` interface (standard-schema officially allows copy/paste).
- Result: core's only runtime dependency remains `reflect-metadata`; contract/client are zero-dependency and browser-safe.
- Drift between the three copies is guarded by monorepo **parity type tests** (devDep cross-references, test/ only).
- Def fields are **required-but-undefined** (`params: StandardSchemaV1 | undefined`, not `params?:`) to sidestep `exactOptionalPropertyTypes` variance issues.

### 2.2 Contract builder: chained, immutable, no terminal call

```ts
zc.get(path)     // const generic keeps the literal path; a bare call is already a valid procedure
  .params(s) .query(s) .body(s) .output(s) .status(n) .errors(e) .meta(m)
```

- Each call returns a new frozen procedure. `zc` naming avoids zod's `z` and the Zebra variable convention `z`.
- `.body()` on GET is `never` at the type level (compile error) with a runtime throw fallback.
- Router = nested plain object: `{ list: proc, nested: { ... } }`.
- Contract holds the full path (single source of truth shared with the client). DRY via pure contract-side `prefix("/api", router)` — type-level `JoinPath` mapping + runtime rewrite. No server-side mount prefix, no Group integration.
- Type accumulation through the chain: method/path/status stay literals; params/query/body/output carry the exact schema types; errors accumulate (`E & Es`).

### 2.3 Server: `app.implement`, 4 arity-disambiguated overloads

1. `implement(proc, handler)`
2. `implement(proc, deps, handler, opts?)` — mirrors existing `(path, deps, handler)` style
3. `implement(router, impls)`
4. `implement(router, deps, impls, opts?)` — shared deps

- Bulk: shared deps only (TS cannot infer handler params from sibling properties — verified dead end); per-procedure deps fall back to the single form.
- Entry shape: `handler | { handler, middlewares? }`.
- Missing implementation = compile error (non-optional mapped type) **and** a call-time runtime error listing missing/extra keys with method/path.
- `opts.middlewares` applies per implementation; `opts.validateOutput?` (default `true`). Want opts but not deps? Pass `{}` (documented rule).
- `RegisteredRoute` gains `contract?: ContractProcedureDef`; new public read-only `get routeTable()` returns a frozen copy — the future OpenAPI/introspection seam.

### 2.4 Type flow

- Server handler sees `InferOutput` of params/query/body (post-coerce/transform), returns `InferInput` of the output schema (the wrapper re-validates; wire transmits `InferOutput`; schema strip prevents field leakage).
- Client sends `InferInput`, receives output's `InferOutput` (`status 204 → undefined`).
- Undeclared schemas fall back: params → `PathParams<Path>`, query → `Record<string, string>`, body → `unknown`.
- Reuses the dormant RouteHandler B/Q slots; `RouteHandler` itself is unchanged.

### 2.5 Client

- Non-2xx throws; types only, no runtime validation; plain recursive object (no Proxy).
- `createClient(contract, { baseUrl, fetch?, headers? })`.
- Call shape: single options object `{ params?, query?, body?, headers?, signal? }` — keys exist/are required per contract declaration; when all keys are optional the whole arg can be omitted.
- Non-2xx → `throw new ClientError { status, code, problem, response }` (mirrors Zebra's structured-error philosophy; rejects ts-rest-style status unions since Zebra's error line format is unique).
- No browser-unavailable APIs. `fetch` signature `(url, init) => Promise<Response>` for injection.
- `@zebra/testing` gains `createTestClient(app, contract) = createClient(contract, { baseUrl: "http://test.local", fetch: (u, i) => app.request(u, i) })` — full-loop without sockets.

## 3. Public API surface (target)

```ts
// contract.ts —— shared, zero server code
import { zc } from "@zebra/contract";
import { z } from "zod";

const Blog = z.object({ id: z.number(), title: z.string(), content: z.string() });

export const blogContract = {
  list:   zc.get("/blogs").query(z.object({ page: z.coerce.number().min(1).default(1) }))
            .output(z.array(Blog)),
  get:    zc.get("/blogs/:id").params(z.object({ id: z.coerce.number().int() }))
            .output(Blog).errors({ blog_not_found: { status: 404 } }),
  create: zc.post("/blogs").body(z.object({ title: z.string().min(1), content: z.string() }))
            .output(Blog).status(201).meta({ summary: "Create a blog post", tags: ["blogs"] }),
};

// main.ts —— server (bulk + shared deps + per-entry middleware)
z.implement(blogContract, { blog: BlogService }, {
  list:   async (req, { blog }) => blog.list(req.query.page),      // req.query.page: number
  get:    async (req, { blog }) => { ... req.params.id ... },       // coerce'd number
  create: async (req, { blog }) => blog.create(await req.body()),   // validated + typed
});
// Single form: z.implement(blogContract.get, { blog: BlogService }, handler, { middlewares: [mw] })

// client.ts —— depends only on contract
const api = createClient(blogContract, { baseUrl: "http://localhost:3001" });
const created = await api.create({ body: { title: "hi", content: "..." } }); // Promise<Blog>, 404 → ClientError

// test.ts —— no sockets
const tapi = createTestClient(app, blogContract);
```

## 4. Runtime semantics

The wrapper (a `RouteHandler` registered via `register`, running after the middleware chain):

1. Validate params (if declared), then query; aggregate both issue sets into one `ValidationError` (paths prefixed `params.` / `query.`; standard-schema path segments joined with `.`, object segments use `seg.key`) → thrown as 422 by the existing error middleware (errors.ts untouched).
2. Body (if declared): `await req.body()` (existing 400/413 pass through) → validate (prefix `body.`) → on success replace the thunk: `req.body = () => Promise.resolve(validated)`.
3. Rewrite `req.params` / `req.query` with validated values, then call the user handler.
4. `Response` instance → pass through (escape hatch: skips output validation and status override). Otherwise, output validation (unless `validateOutput: false`): failure → `HttpError(500, "output_validation_failed", ...)`, issues in `detail` only when `exposeStack` is on; success → serialize the validated value (strip applies).
5. Build response: `status === 204` → `new Response(null, { status: 204 })`; else `JSON.stringify` + `def.status` + JSON content-type.

### Boundary semantics (documented)

- Query single-value **last-wins** (URLSearchParams iteration order).
- Multipart: don't declare `.body` (FormData isn't Standard Schema–validatable).
- Duplicate method+path keeps existing radix overwrite behavior.

## 5. Package & file layout

### New: `packages/contract` (`@zebra/contract@0.2.0`, zero deps; devDeps: `@zebra/core` (parity tests), `zod` (tests))

- `src/index.ts` — exports `zc`, `prefix`, types, `StandardSchemaV1`
- `src/standard-schema.ts` — vendored interface
- `src/path.ts` — vendored `PathParams` / `JoinPath`
- `src/types.ts` — `ProcedureDef`/`ContractProcedure`/`ContractRouter`/`ErrorSpec`/`ProcedureMeta`/Infer helpers
- `src/builder.ts` — the `zc` chain
- `src/prefix.ts`
- `test/`: `builder.test.ts` (def content/immutability/freeze/GET-body throw), `types.test.ts` (expectTypeOf accumulation, literal paths, `@ts-expect-error`), `prefix.test.ts`, `parity.test.ts` (core PathParams consistency; procedure assignable to core `ContractProcedureLike`)

### New: `packages/client` (`@zebra/client@0.2.0`, zero deps)

- `src/index.ts`, `src/standard-schema.ts` + `src/protocol.ts` (vendored, incl. minimal ProblemJson), `src/types.ts` (`ContractClient`/`ClientInput`/`ClientOutput`/`ClientProcedure`/`ClientOptions`), `src/error.ts` (`ClientError`), `src/client.ts` (eager recursive build; `:p` → `encodeURIComponent`, `*splat` segment-wise encoding preserving `/`, missing param → throw; query skips `undefined`/`null`, `String(v)`; JSON body; static/thunk headers merge; 204/empty → `undefined`, else `res.json()`; non-2xx → parse problem+json or synthesize → throw)
- `test/`: `client.test.ts` (fake fetch: URL building/encoding/body/headers/ClientError paths), `types.test.ts` (`@ts-expect-error`: missing body, wrong arg type, required/optional)

### Modified: `packages/core` (minimal touch; dispatch/toResponse/boot-validation/group/middleware/http/router untouched)

- New `src/contract/protocol.ts` (vendored interfaces + `isContractProcedure`)
- New `src/contract/types.ts` (`ContractHandler`, `ContractParams/Query/Body/Result`, `ProcedureImpl`, `RouterImpl` (non-optional mapped → exhaustive), `ImplementOptions`)
- New `src/contract/implement.ts` (`buildContractHandler` validation wrapper, `walkRouterImpl` recursion + coverage check with dotted keys + method/path in errors, `runStandardValidate`: `let r = schema["~standard"].validate(v); if (r instanceof Promise) r = await r;`)
- `src/app/app.ts`: 4 `implement` overloads + ~25-line impl delegating to `contract/implement.ts` (`this.register(def.method, def.path, deps, wrapped, mws, def)`); `get routeTable()`; `register()` gains trailing optional `contract?` param
- `src/app/types.ts`: `RegisteredRoute.contract?: ContractProcedureDef`
- `src/index.ts`: export new types + `isContractProcedure`
- New tests: `test/contract/implement.test.ts`, `implement-bulk.test.ts`, `types.test.ts`

### Modified: `packages/testing`

- `src/index.ts` + `createTestClient`; `package.json` + `"@zebra/client": "workspace:*"`; new `test/test-client.test.ts` (full-loop: contract → implement → testClient → typed result / 422 / 404 ClientError)

### New: `examples/contract-blog` (`example-contract-blog`; deps: zebra/contract/client/zod; scripts: `start`, `client`)

- `src/contract.ts`, `src/services.ts` (copied from blog), `src/main.ts`, `src/client-demo.ts`. `examples/blog` stays as a comparison baseline.

## 6. Explicitly not doing (seams left) & accepted risks

**Not doing:** OpenAPI generation (seam = `def.meta/errors/status` + `routeTable` + `RegisteredRoute.contract`), inline-schema route form, headers schema, per-status output schemas, client retry/timeout/cookies, Group integration, server-side mount prefix.

**Accepted risks:** three vendored copies may drift (parity type tests mitigate); `z.coerce` input-side types are post-coerce types (client String()-ifies; harmless, documented); output transforms make handler return type ≠ wire format (intentional); Date etc. JSON round-trip fidelity is the contract author's responsibility (no Jsonify mapping this round); bulk shared deps resolve request-scoped services even for routes that don't use them (single form fallback; documented).

## 7. Version slots

| Version | Originally planned | Revised (this addendum) |
|---|---|---|
| v0.2 | `@zebra/validation`, `@zebra/openapi` | `@zebra/contract`, `@zebra/client` (+ core `implement`, testing `createTestClient`) |
| v0.3 | `@zebra/session`… | `@zebra/openapi` (was v0.2) + `@zebra/session`… |
