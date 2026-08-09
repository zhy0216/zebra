# Zebra Contract-First Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add oRPC-style contract-first to Zebra: `@zebra/contract` (contract builder, Standard Schema V1), `app.implement` (type-constrained + runtime-validated handlers), `@zebra/client` (derived type-safe client), `@zebra/testing.createTestClient` (socket-free loop).

**Architecture:** The contract is a frozen pure-data def (`version: 1` marker, `~zebra` protocol) produced by a chained immutable builder (`zc.get(path).params(s).query(s).body(s).output(s).status(n).errors(e).meta(m)`). Core wraps user handlers in a validating `RouteHandler` (params/query → 422 ValidationError with `params.`/`query.` prefixes; body validated then thunk replaced; output re-validated then serialized; raw Response passes through; 204 → empty body). Client is an eager recursive object builder, types only, throws `ClientError` on non-2xx. Contract/client are zero-dependency and vendor the protocol + Standard Schema interfaces; parity type tests guard drift. No OpenAPI generation (seams: `routeTable`, `RegisteredRoute.contract`, `def.meta/errors/status`).

**Tech Stack:** Bun 1.x · TypeScript 5.x · bun:test · Standard Schema V1 (`~standard`) · zod (devDep, tests only)

**Spec reference:** [`docs/superpowers/specs/2026-08-09-zebra-contract-first-design.md`](../specs/2026-08-09-zebra-contract-first-design.md)

---

## File Structure

**Create (packages):**
- `packages/contract/` — `package.json`, `tsconfig.json`, `src/index.ts`, `src/standard-schema.ts`, `src/path.ts`, `src/types.ts`, `src/builder.ts`, `src/prefix.ts`, `test/builder.test.ts`, `test/types.test.ts`, `test/prefix.test.ts`, `test/parity.test.ts`
- `packages/client/` — `package.json`, `tsconfig.json`, `src/index.ts`, `src/standard-schema.ts`, `src/protocol.ts`, `src/types.ts`, `src/error.ts`, `src/client.ts`, `test/client.test.ts`, `test/types.test.ts`
- `packages/core/src/contract/` — `protocol.ts`, `types.ts`, `implement.ts`

**Modify:**
- `packages/core/src/app/app.ts` — 4 `implement` overloads + impl, `get routeTable()`, `register(..., contract?)` param
- `packages/core/src/app/types.ts` — `RegisteredRoute.contract?: ContractProcedureDef`
- `packages/core/src/index.ts` — export contract types + `isContractProcedure`; `VERSION` → 0.2.0
- `packages/core/package.json` — version 0.2.0
- `packages/testing/src/index.ts` — `createTestClient`; `package.json` — version 0.2.0 + `@zebra/client` workspace dep
- `packages/zebra/package.json` — version 0.2.0
- `package.json` (root) — devDeps + `zod`
- `docs/superpowers/specs/2026-05-16-zebra-v2-design.md` — Addendum (2026-08-09)
- `README.md`, `llms.txt`

**Create (tests + example):**
- `packages/core/test/contract/implement.test.ts`, `implement-bulk.test.ts`, `types.test.ts`
- `packages/testing/test/test-client.test.ts`
- `examples/contract-blog/` — `package.json`, `tsconfig.json`, `src/contract.ts`, `src/services.ts`, `src/main.ts`, `src/client-demo.ts`

**Create (docs):**
- `docs/superpowers/specs/2026-08-09-zebra-contract-first-design.md`
- `docs/superpowers/plans/2026-08-09-zebra-contract-first.md` (this file)

---

## Phase 0: Documentation

### Task 1: Spec + plan + addendum

- [ ] **Step 1:** Write `docs/superpowers/specs/2026-08-09-zebra-contract-first-design.md` (design, API surface, runtime semantics, package layout, non-goals, risks).
- [ ] **Step 2:** Write this plan.
- [ ] **Step 3:** Append `## Addendum (2026-08-09)` to `docs/superpowers/specs/2026-05-16-zebra-v2-design.md`: v0.2 redefined to contract+client (validation/openapi superseded, openapi → v0.3); §8.1 inline-schema route form marked superseded by the contract path.
- [ ] **Step 4:** Commit `docs(spec): zebra contract-first design + plan; v2 addendum`.

---

## Phase 1: `@zebra/contract`

### Task 2: Bootstrap package + type-level scaffold test (risk #1: builder generic chain)

**Files:** Create: `packages/contract/package.json`, `tsconfig.json`, `src/index.ts` (stub), `test/types.test.ts`

- [ ] **Step 1:** `package.json` (name `@zebra/contract`, version `0.2.0`, `main`/`types` → `./src/index.ts`, scripts test/typecheck/build) + `tsconfig.json` (extends base, include src+test). Root `package.json` devDeps += `zod`.
- [ ] **Step 2:** Write failing `test/types.test.ts`:
  - `expectTypeOf` on `zc.get("/blogs/:id").params(z.object({ id: z.coerce.number().int() })).output(Blog)` — literal path preserved, `InferParams` = `{ id: number }` (coerce output), `InferOutput` = Blog.
  - Full chain: `.query(...)`, `.body(...)`, `.status(201)`, `.errors({ a: { status: 404 } })` accumulate and preserve literals (8 slots).
  - `@ts-expect-error` on `.body(z.object({}))` after `zc.get(...)` (GET body = never).
- [ ] **Step 3:** Run `bun test packages/contract/test/types.test.ts` — RED (`zc` undefined).
- [ ] **Step 4:** Implement `src/standard-schema.ts` (vendored official interface + `StandardSchemaV1.InferInput` / `InferOutput` type helpers), `src/path.ts` (vendored `PathParams`/`JoinPath` from core), `src/types.ts` (Method, ErrorSpec, ProcedureMeta, `ContractProcedureDef`, `ContractProcedure`, `ContractRouter`, `InferParams/Query/Body/Output`).
- [ ] **Step 5:** Run test — GREEN.
- [ ] **Step 6:** Commit `feat(contract): procedure def types + Infer helpers`.

### Task 3: Builder runtime

**Files:** Modify: `packages/contract/src/builder.ts` (new), `src/index.ts`; Create: `test/builder.test.ts`

- [ ] **Step 1:** Write failing `test/builder.test.ts`: def shape (version/method/path literals, undefined schemas, status 200 default, errors {}, meta undefined); immutability (calling `.params` twice returns distinct objects, first unchanged); frozen (mutating def throws in strict mode); GET `.body()` throws at runtime; `.errors` merges.
- [ ] **Step 2:** Run — RED.
- [ ] **Step 3:** Implement builder: private-ctor frozen `ContractProcedure` class, `zc = { get, post, put, patch, delete }`, `baseDef` factory, chain methods returning new frozen procedures; `.body` type guard `Def["method"] extends "GET" ? never : S` + runtime throw.
- [ ] **Step 4:** Run — GREEN; then `bun test` (whole repo) no regression.
- [ ] **Step 5:** Commit `feat(contract): zc chainable immutable builder`.

### Task 4: `prefix` + parity

**Files:** Modify: `src/prefix.ts` (new); Create: `test/prefix.test.ts`, `test/parity.test.ts`

- [ ] **Step 1:** Failing tests:
  - `prefix.test.ts`: `prefix("/api", router)` rewrites paths (`/blogs` → `/api/blogs`, `:id` preserved); nested routers; original untouched.
  - `parity.test.ts`: contract `PathParams<"/a/:id/*rest">` ≡ core `PathParams` (type-level via expectTypeOf); a `ContractProcedure`'s def is assignable to core's `ContractProcedureLike` (structural).
- [ ] **Step 2:** Run — RED (no `prefix`, core type missing).
- [ ] **Step 3:** Implement `prefix`: type-level `PrefixedRouter` mapped type (JoinPath on leaf defs) + runtime recursive walk (needs internal factory from builder).
- [ ] **Step 4:** Run — GREEN. Typecheck package.
- [ ] **Step 5:** Commit `feat(contract): prefix() path rewriting`.

---

## Phase 2: core single-procedure `implement`

### Task 5: Cross-package structural assignability scaffold (risk #2)

**Files:** Create: `packages/core/src/contract/protocol.ts`, `packages/core/test/contract/types.test.ts`

- [ ] **Step 1:** Failing `test/contract/types.test.ts` using `@zebra/contract` (devDep on core for parity; core test imports contract via workspace dep — add `"@zebra/contract": "workspace:*"` to core devDependencies):
  - `implement(proc, handler)` — handler sees `req.params` as coerce output, `req.query`, `await req.body()` typed; return type must satisfy output `InferInput`.
  - Hand-written minimal `~standard` schema (object with `"~standard": { version: 1, vendor, validate, types }`) also flows (both zod and hand-rolled assignable under `exactOptionalPropertyTypes`).
- [ ] **Step 2:** Run — RED.
- [ ] **Step 3:** Implement `src/contract/protocol.ts` (vendored `StandardSchemaV1` + `ContractProcedureDef` + `isContractProcedure`), `src/contract/types.ts` (`ContractHandler`, `ContractParams/Query/Body`, `ImplementOptions`, single-proc overload types). Wire `implement` signatures into `app.ts` (delegate impl to `contract/implement.ts` — stub throws).
- [ ] **Step 4:** Run — GREEN. Commit `feat(core): implement() type surface (single proc)`.

### Task 6: Validation wrapper runtime

**Files:** Modify: `packages/core/src/contract/implement.ts`; Create: `packages/core/test/contract/implement.test.ts`

- [ ] **Step 1:** Failing dispatch-level tests (via `app.dispatch(new Request(...))`):
  1. params+query both invalid → single 422, `errors[].path` prefixed `params.`/`query.`, nested segments dotted (object seg uses `key`).
  2. coerce visible: `/blogs/1` with `z.coerce.number()` → handler sees `number`; `/blogs/abc` → 422.
  3. body: invalid → 422 `body.title`; valid → handler `await req.body()` returns typed value; thunk replaced (calling `req.body()` twice returns validated value, parser not re-run).
  4. 201 status; 204 empty body; output strip (handler returns extra field, wire excludes it); output failure → 500 `output_validation_failed`, issues in `detail` only when `errors.exposeStack` (app-level), no `detail` otherwise.
  5. raw `Response` passthrough (skips output validation + status).
  6. frozen after listen: `implement` after boot throws.
  7. deps flow into `validateGraph` (unbound token → boot error).
  8. single-proc with `{}` deps + `opts.middlewares` runs middleware.
- [ ] **Step 2:** Run — RED.
- [ ] **Step 3:** Implement `runStandardValidate` (`let r = schema["~standard"].validate(v); if (r instanceof Promise) r = await r;`), issue mapping (`typeof seg === "object" ? seg.key : seg`, join `.`, prefix `params.`/`query.`/`body.`), `buildContractHandler` per spec §4 (order: params → query → aggregate throw; body → thunk replace; handler; Response passthrough; output validate/serialize; 204/status/content-type).
- [ ] **Step 4:** Run — GREEN. Full `bun test` + `bun run typecheck`.
- [ ] **Step 5:** Commit `feat(core): contract validation wrapper (single proc)`.

---

## Phase 3: bulk `implement` + introspection

### Task 7: Bulk overloads + router walk

**Files:** Modify: `packages/core/src/contract/types.ts`, `implement.ts`, `app.ts`; Create: `packages/core/test/contract/implement-bulk.test.ts`

- [ ] **Step 1:** Failing tests:
  - bulk with shared deps: handler receives `ResolvedDeps`; nested routers; `{ handler, middlewares }` entry; opts middlewares per-proc.
  - missing key at call time → runtime error listing missing keys + method/path (dotted keys for nested); extra keys → same.
  - `@ts-expect-error`: missing impl key (non-optional mapped type), wrong handler param type, wrong deps type.
- [ ] **Step 2:** Run — RED.
- [ ] **Step 3:** Implement `RouterImpl<R, D>` non-optional mapped type, `walkRouterImpl` (recursive, coverage check with dotted keys + method/path, matches impls to defs, per-entry middlewares).
- [ ] **Step 4:** Run — GREEN. Typecheck.
- [ ] **Step 5:** Commit `feat(core): bulk implement + exhaustive router impl`.

### Task 8: Introspection seam

**Files:** Modify: `packages/core/src/app/app.ts`, `types.ts`, `index.ts`

- [ ] **Step 1:** Failing test: `app.routeTable` returns array of frozen copies with `method/path/deps/handler/middlewares`; contract-implemented routes carry `contract` def (method/path/status/errors/meta); mutating returned object doesn't mutate internal state; registered route count matches.
- [ ] **Step 2:** Run — RED.
- [ ] **Step 3:** Implement: `register(..., contract?)`, `RegisteredRoute.contract`, `get routeTable()` (map + freeze), export from `index.ts`.
- [ ] **Step 4:** Run — GREEN. Full suite + typecheck.
- [ ] **Step 5:** Commit `feat(core): routeTable introspection + RegisteredRoute.contract`.

---

## Phase 4: `@zebra/client`

### Task 9: Type scaffold (risk #3: ClientInput key existence/optionality)

**Files:** Create: `packages/client/package.json`, `tsconfig.json`, `src/types.ts`, `test/types.test.ts`

- [ ] **Step 1:** Write failing `test/types.test.ts`:
  - `ClientArgs<Def>`: declared params/query/body keys exist and are required; undeclared key passing → `@ts-expect-error`; all-optional proc → whole arg omittable; wrong body type → `@ts-expect-error`; return type = `InferOutput`; `status 204` → `undefined`.
- [ ] **Step 2:** Run — RED.
- [ ] **Step 3:** Implement `src/types.ts`: `ClientArgs` (intersection of per-key groups; `{} extends` for all-optional detection), `ClientProcedure`, `ContractClient` (mapped type), `ClientOptions`. Stub `createClient` throwing.
- [ ] **Step 4:** Run — GREEN. Commit `feat(client): typed client surface`.

### Task 10: Client runtime

**Files:** Modify: `src/client.ts`, `src/error.ts`, `src/protocol.ts`, `src/standard-schema.ts`; Create: `test/client.test.ts`

- [ ] **Step 1:** Failing `test/client.test.ts` with fake fetch (captures url/init, returns canned Response):
  - URL building: baseUrl + path; `:id` encodeURIComponent'd; `*splat` segment-encoded preserving `/`; missing param → throws.
  - query: only declared-and-present values appended; `undefined`/`null` skipped; `String(v)`.
  - body: JSON stringified + `content-type: application/json`; merged headers (static + per-call); thunk headers.
  - 200 → parsed JSON; 204/empty → `undefined`; 404 with problem+json → `ClientError` (status/code/problem/response); non-JSON error body → synthesized problem.
- [ ] **Step 2:** Run — RED.
- [ ] **Step 3:** Implement per spec §2.5: eager recursive walk (no Proxy), call factory, `ClientError`.
- [ ] **Step 4:** Run — GREEN. Typecheck. Commit `feat(client): createClient runtime`.

---

## Phase 5: `@zebra/testing` integration

### Task 11: `createTestClient`

**Files:** Modify: `packages/testing/src/index.ts`, `package.json`; Create: `packages/testing/test/test-client.test.ts`

- [ ] **Step 1:** Failing full-loop test: contract (list/get/create) → `app.implement` → `createTestClient` → typed result; 422 on invalid body; 404 ClientError on missing blog; 201 on create.
- [ ] **Step 2:** Run — RED.
- [ ] **Step 3:** Implement `createTestClient(app, router)` = `createClient(router, { baseUrl: "http://test.local", fetch: (u, i) => app.request(u, i) })`. Add `@zebra/client` dep.
- [ ] **Step 4:** Run — GREEN. Commit `feat(testing): createTestClient full-loop`.

---

## Phase 6: Example + docs + versions

### Task 12: `examples/contract-blog`

**Files:** Create: `examples/contract-blog/` (package.json `example-contract-blog`, tsconfig, `src/contract.ts`, `src/services.ts` (from blog), `src/main.ts` (bulk implement + single-form get), `src/client-demo.ts` (create → list → get, prints JSON, catches ClientError))

- [ ] **Step 1:** Write files; deps: zebra, @zebra/contract, @zebra/client, zod.
- [ ] **Step 2:** Verify: `bun --filter example-contract-blog start` + curls (see Final verification); `bun --filter example-contract-blog client` prints round-trip JSON.
- [ ] **Step 3:** Commit `docs(example): contract-blog end-to-end`.

### Task 13: README / llms.txt / versions

- [ ] **Step 1:** README: Features bullet (contract-first: contract/client/testing), Packages table (+@zebra/contract, @zebra/client), Examples (+contract-blog), Status (v0.2).
- [ ] **Step 2:** llms.txt: principles bullet (contract-first, Standard Schema V1, zero-dep vendor), Packages, Public API surface (zc builder, implement, createClient, createTestClient, isContractProcedure), Source layout.
- [ ] **Step 3:** Versions: core/testing/zebra `package.json` + core `VERSION` → 0.2.0 (contract/client already 0.2.0).
- [ ] **Step 4:** Commit `docs(readme): contract-first v0.2` + `chore(release): v0.2.0`.
- [ ] **Step 5:** GitMemo: archive this design to `~/.gitmemo/notes/manual/`.

---

## Final verification

- [ ] `bun test` — full suite green (bunfig preloads reflect-metadata).
- [ ] `bun run typecheck` — mandatory: expectTypeOf/`@ts-expect-error` only bite under tsc.
- [ ] `bun run lint` — Biome clean.
- [ ] Manual: `bun --filter example-contract-blog start`, then:
  - `curl -s localhost:3001/blogs` → `[]`
  - `curl -s -X POST localhost:3001/blogs -H 'content-type: application/json' -d '{"title":"","content":"x"}' | jq '.errors[0].path'` → `"body.title"`
  - `curl -s -X POST localhost:3001/blogs -H 'content-type: application/json' -d '{"title":"hi","content":"x"}' -w '%{http_code}'` → `201`
  - `curl -s localhost:3001/blogs/abc | jq .status` → `422` (params.id coerce failure)
  - `curl -s localhost:3001/blogs/1 | jq .id` → `1` (number)
  - `bun --filter example-contract-blog client` → typed client round-trip output.

## Notes for the implementing engineer

- **TDD discipline:** every task writes the failing test first, runs it to see it fail, then implements.
- **No `git add .`:** commit exact paths only.
- **exactOptionalPropertyTypes is ON:** def fields are required-but-undefined; when building def objects always pass every key; when assigning `contract?` to RegisteredRoute use spread (`...(contract ? { contract } : {})`).
- **GET `.body()`:** type guard is `Def["method"] extends "GET" ? never : S` — the runtime throw is a fallback, not the primary defense.
- **Overload disambiguation:** implementation signature `implement(a, b, c?, d?)`; `isContractProcedure(a)` splits single vs bulk; arg count splits handler vs deps forms. 2-arg = (proc, handler) | (router, impls); 3-arg = (proc, deps, handler) | (router, deps, impls); 4-arg = same + opts.
- **Vendored interfaces must match standard-schema official copy verbatim** (readonly modifiers included) so zod/valibot/arktype assign structurally.
- **Parity tests import across packages** (contract ↔ core) — that's devDep-only; runtime stays zero-dep.
- The wrapper replaces `req.body` — the original body() must be called exactly once by the wrapper (parser memoizes).
