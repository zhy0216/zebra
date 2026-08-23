# API Freeze · v1.0

> Status: **frozen as of v1.0.0** (2026-08-09, extended 2026-08-11 to cover
> `@zebra-web/observability` and `@zebra-web/redis`). This document is the authoritative
> record of the v1 stable API surface. Everything listed here ships with a
> stability promise; anything not listed here is internal and may change at any
> time without a major version bump.

## 1. Stability promise

The following is stable across `1.x` releases and can be relied on by
downstream consumers:

1. **Exports are stable.** Every export listed in §3 keeps its name, its
   declared type/signature, and its runtime semantics for the whole `1.x` line.
   New exports may be added (minor); removals or renames are breaking (major).
2. **Class and interface members listed in §3 are stable.** Methods and
   properties documented on `Zebra`, `GroupApi`, `RequestSession`, and the
   store / middleware interfaces are part of the contract. Members not listed
   (including anything marked `protected`/`private`/`internal`) are not.
3. **Behavioral semantics are stable.** Request routing, validation outcomes
   (422 prefixing, output re-validation/stripping), Problem+Json shape, status
   codes, cookie semantics, rate-limit header names, and observability
   middleware behavior behave as documented and tested. Bug fixes that change
   observable behavior are treated as breaking when they change documented
   semantics, and shipped in majors.
4. **Runtime requirements are stable for the `1.x` line:** Bun runtime, TypeScript
   with `experimentalDecorators` + `emitDecoratorMetadata`, and `reflect-metadata`
   imported once at the entry point. A change to these requirements is breaking.

### What is NOT covered by the freeze

- Anything exported from `src/` paths other than the package `index.ts`
  (`packages/*/src/**` internals are reachable in the repo but not published
  API — imports like `@zebra-web/core/src/...` are not supported).
- Types and helpers marked `Internal` in their doc comments (e.g. the session
  package's `RequestSessionInternal`, which is used by `@zebra-web/session`'s
  middleware but is not part of the public index).
- `VERSION`'s value: the string constant tracks the package version; its mere
  presence is stable, its value is not (it changes every release).
- Error message *text* (but not error classes, `name`, or `status` fields).
- Diagnostic/Dev-only helpers, `console` output, and logging internals.

## 2. Version policy (SemVer)

All packages (and the `@zebra-web/zebra` facade) are released in lockstep at the same
version number. The policy below applies to each package and to the facade.

### Requires a **major** (2.0)

Any change that can break a consumer who uses the API as documented:

- **Signature changes**: removing, renaming, reordering, or changing the type
  of any parameter, return type, or generic parameter of a listed export.
- **Export changes**: removing or renaming any listed export; changing an
  export from a value to a type or vice versa; changing a type-only export to
  require runtime support (or the reverse).
- **Behavioral semantics**: changing documented runtime behavior — request
  routing outcomes, validation behavior, status codes, cookie/header semantics,
  error class thrown, DI resolution or scope rules, lifecycle ordering,
  observability middleware semantics.
- **Requirement changes**: dropping Bun / decorator / `reflect-metadata`
  support, or requiring a newer Bun or TypeScript than the documented minimum.
- **Type-leak fixes that change inference**: e.g. a parameter previously typed
  `any` now being strictly typed, if consumers relied on the looser type.

### Minor (1.x) is allowed for

- Adding new exports, overloads, optional parameters, or widening accepted
  input types (e.g. accepting `string | undefined` where `string` was accepted
  before).
- Adding new members to interfaces and classes (additive only).
- New packages published under the `@zebra-web/*` scope.
- Backwards-compatible additions to error classes (new fields, new subclasses).

### Patch (1.x.y) is allowed for

- Bug fixes that only change behavior in cases that were previously broken
  (crashes, wrong-but-clearly-buggy output) and that do not change documented
  semantics.
- Internal refactors with no observable change.
- Documentation, typo fixes, and dependency patch updates.

### Rules of thumb

- If you are unsure whether a change is breaking, it is a major.
- Internal code that is not in the frozen surface can change freely at any
  time (a change to `packages/*/src/**` that does not touch the index exports
  or documented behavior is never itself a breaking change — unless it leaks
  into observable behavior of the frozen surface).
- The facade `@zebra-web/zebra` inherits the breakage rules of everything it re-exports:
  a breaking change in any dependency package is a breaking change of the
  facade, hence a major for all.

## 3. Frozen surface (per package)

### `@zebra-web/zebra` (facade)

Re-exports the full surfaces of `@zebra-web/core`, `@zebra-web/cors`, and
`@zebra-web/session`, plus `rateLimit`, `checkLimit`, `createLimiter`,
`RateLimitMemoryStore` (aliased `MemoryStore`), and the rate-limit types
`IncrementResult`, `Limiter`, `RateLimitMemoryStoreOptions` (aliased
`MemoryStoreOptions`), `RateLimitOptions`, `RateLimitResult`, `RateLimitStore`.

Known asymmetry (documented, frozen): rate-limit's `MemoryStore` /
`MemoryStoreOptions` collide with `@zebra-web/session`'s re-exports and are
aliased in the facade. Import them unprefixed from `@zebra-web/rate-limit` directly
when needed.

`@zebra-web/contract`, `@zebra-web/client`, `@zebra-web/testing`, `@zebra-web/observability`,
and `@zebra-web/redis` are intentionally NOT re-exported by the facade (keeps the
facade tree-shakeable and dependency-light); import them from their own
packages.

### `@zebra-web/core`

- App: `Zebra`, type `ZebraOptions`, `RouteHandler`, `DepsSpec`, `ResolvedDeps`,
  `RegisteredRoute`, `GroupApi`, `LifecycleEvent`, `LifecycleHandler`,
  `PathParams`, `JoinPath`, `SessionOptions`, `validateGraph`, `VERSION`.
  `Zebra` instance members: `use`, `on`, `listen`, `stop`, `disposeSession`,
  `injectValue`, `injectSingleton`, `injectRequest`, `injectTransient`,
  `injectSession`, `injectFactorySingleton`, `injectFactoryRequest`,
  `injectFactoryTransient`, `injectFactorySession`, `implement`, `get`, `post`,
  `put`, `patch`, `delete`, `head`, `options`, `route`, `group`, `static`, `ws`,
  `dispatch`, `routeTable`.
- Contract (implement): `isContractProcedure`, types `ContractProcedureDef`,
  `ContractHandler`, `ContractRequest`, `ContractParams`, `ContractQuery`,
  `ContractBody`, `ContractReturn`, `ContractProcedure`, `ContractRouter`,
  `ProcedureImpl`, `RouterImpl`, `ImplementOptions`, `Method`, `ErrorSpec`,
  `StandardSchemaV1`.
- DI: `Container`, `token`, `isToken`, `injectable`, `inject`, `isInjectable`,
  `getConstructorDeps`, `ScopeKind`, `scopeRank`, `canDependOn`, `Disposable`,
  `isDisposable`, `CircularDependencyError`, `UnboundTokenError`,
  `ScopeMismatchError`, types `Token`, `Identifier`, `ClassConstructor`,
  `AbstractConstructor`.
- HTTP: `ZebraRequest`, `buildRequest`, `HttpError`, `ValidationError`,
  `toProblemJson`, `json`, `text`, `html`, `redirect`, `stream`, types
  `ProblemJson`, `ValidationIssue`.
- Middleware: `middleware`, `getMiddlewareDeps`, type `Middleware`.
- WebSocket: types `WsHandler`, `WsData`, `WsRoute` (upgrade/handler surface
  wired to `app.ws`).

> Note: `head` / `options` / `route` are listed as stable `Zebra` members —
> they have been part of the routing surface since the freeze audit (C1).

### `@zebra-web/contract`

`zc`, `prefix`, `METHODS`, types `StandardSchemaV1`, `ContractProcedure`,
`ContractProcedureDef`, `ContractRouter`, `ErrorSpec`, `Method`,
`ProcedureMeta`, `InferParams`, `InferQuery`, `InferBody`, `InferOutput`,
`PathParams`, `JoinPath`.

### `@zebra-web/client`

`createClient`, `ClientError`, types `StandardSchemaV1`, `ContractProcedureDef`,
`Method`, `ErrorSpec`, `ProblemJson`, `isProcedure`, `ClientArgs`,
`ClientOutput`, `ClientProcedure`, `ContractClient`, `ClientOptions`,
`ContractProcedure`, `ContractRouter`.

### `@zebra-web/testing`

`createTestApp`, `createTestClient`, type `TestApp`.

### `@zebra-web/session`

`sessionMiddleware`, `createSession`, `getSession`, `SESSION_KEY`, `MemoryStore`,
`sign`, `verify`, `parseCookies`, `parseSignedCookie`, `serializeCookie`, types
`SessionCookieOptions`, `SessionMiddleware`, `SessionMiddlewareOptions`,
`SessionResolver`, `RequestSession`, `MemoryStoreOptions`, `SessionStore`,
`CookieSerializeOptions`.

> `RequestSessionInternal` was removed from the public index during the C1
> freeze audit (v1.0.0): it is middleware-internal and was exported by accident.

### `@zebra-web/cors`

`cors`, `DEFAULT_ORIGIN`, `matchOrigin`, `resolveAllowOrigin`, types
`CorsOptions`, `CorsOrigin`.

### `@zebra-web/rate-limit`

`rateLimit`, `checkLimit`, `createLimiter`, `MemoryStore`, types
`RateLimitOptions`, `Limiter`, `RateLimitResult`, `IncrementResult`,
`MemoryStoreOptions`, `RateLimitStore`.

### `@zebra-web/observability` *(frozen 2026-08-11)*

`requestId`, `getRequestId`, `REQUEST_ID_KEY`, `accessLog`, `errorReporter`,
`metrics`, `health`, types `RequestIdOptions`, `AccessLogEntry`,
`AccessLogOptions`, `ErrorReporterInfo`, `MetricsOptions`, `LatencyHistogram`,
`MetricsHandle`, `MetricsMiddleware`, `MetricsSnapshot`, `HealthOptions`,
`Probe`.

### `@zebra-web/redis` *(frozen 2026-08-11)*

`RedisRateLimitStore`, `RedisSessionStore`, types `RedisRateLimitStoreOptions`,
`RedisSessionStoreOptions`, `RedisLike`.

## 4. Freeze status

| Package               | Version | Status |
| --------------------- | ------- | ------ |
| @zebra-web/zebra       | 1.0.0   | frozen |
| @zebra-web/core           | 1.0.0   | frozen |
| @zebra-web/contract       | 1.0.0   | frozen |
| @zebra-web/client         | 1.0.0   | frozen |
| @zebra-web/testing        | 1.0.0   | frozen |
| @zebra-web/session        | 1.0.0   | frozen |
| @zebra-web/cors           | 1.0.0   | frozen |
| @zebra-web/rate-limit     | 1.0.0   | frozen |
| @zebra-web/observability  | 1.0.0   | frozen (2026-08-11) |
| @zebra-web/redis          | 1.0.0   | frozen (2026-08-11) |

All packages are frozen at v1.0.0 (see §2 for the version policy). The
`@zebra-web/zebra` facade is the only place where aliasing intentionally deviates from
dependency-package names (rate-limit `MemoryStore` collision, §3 `@zebra-web/zebra`).

## 5. Audit record

### C1 (2026-08-09)

- README / llms.txt export lists reconciled against the actual `index.ts`
  exports of all eight packages (at the time: @zebra-web/zebra, core, contract, client,
  testing, session, cors, rate-limit).
- Removed `RequestSessionInternal` from `@zebra-web/session`'s public index
  (internal type leak).

### C5 (2026-08-11)

- Freeze extended to the two packages added by the 07-lightweight-http work:
  `@zebra-web/observability` (middleware suite: requestId / accessLog /
  errorReporter / metrics / health) and `@zebra-web/redis` (Redis session &
  rate-limit stores). Export lists reconciled against their `index.ts`.
- `head` / `options` / `route` and the response helpers (`json` / `text` /
  `html` / `redirect` / `stream`) recorded explicitly in the `@zebra-web/core`
  frozen surface.
