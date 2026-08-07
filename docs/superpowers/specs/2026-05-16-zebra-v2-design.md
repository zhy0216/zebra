# Zebra v2 — Design Spec

**Date**: 2026-05-16
**Status**: Approved — v0.1 MVP implemented; v0.2+ package APIs remain advisory
**Scope**: Full API surface for v0.1 → v1.0. Implementation plan (writing-plans) targets v0.1 MVP only.

---

## 1. Background

Zebra v1 (2019) is a TypeScript web framework on Node `http`. Its differentiator was parameter-name-based DI via `f.toString()` parsing. After 7 years of dormancy, several constraints have changed:

- Bun has shipped and is production-viable for HTTP servers
- TS 5.x standard decorators exist but lack parameter decorator support
- Hono / Elysia occupy the "lightweight, Bun-friendly" space, but neither ships a first-class DI container
- The original `f.toString()` approach is fundamentally fragile (breaks on minification, destructuring, rest params)

v2 is a ground-up rewrite. There is no migration path from v1.

## 2. Goals

- **Bun-first**: no Node compat layer. Use `Bun.serve`, `Bun.file`, Web Standard `Request`/`Response`.
- **Type-safe end-to-end DI**: decorators + tokens with `reflect-metadata`, four scopes, startup-time dependency graph validation.
- **Functional routes with named-object DI**: `app.get(path, { svc: Service }, (req, { svc }) => ...)`.
- **Class services with constructor injection**: `@injectable` + `@inject(TOKEN) param`.
- **Lightweight**: small, focused packages; no megalith framework feel.
- **Testable**: tests run without opening sockets; full isolation between tests.

## 3. Non-Goals (v0.x)

- Node.js compatibility
- Cluster / multi-process orchestration (Bun runs single-process; users can run multiple instances behind a load balancer)
- ORM or query builder integration (users bring their own)
- Built-in template engines

## 4. Architecture Overview

```
┌──────────────────────────────────────────────────────┐
│  Bun.serve  ←  entry, Web Standard Request/Response  │
└──────────────────────────┬───────────────────────────┘
                           ▼
┌──────────────────────────────────────────────────────┐
│  Zebra App                                           │
│  ┌────────────┐  ┌──────────────┐  ┌─────────────┐   │
│  │ DI         │  │  Middleware  │  │  Router     │   │
│  │ Container  │  │  chain       │  │  (radix)    │   │
│  └────────────┘  └──────────────┘  └─────────────┘   │
└──────────────────────────┬───────────────────────────┘
                           ▼
                ┌─────────────────────┐
                │  Route handler      │
                │  + injected deps    │
                └─────────────────────┘
```

### Design principles

1. **No global singleton.** `new Zebra({ container })` creates an isolated app. Tests can run multiple apps in one process.
2. **Bun-only.** Direct use of `Bun.serve`, `Bun.file`, `bun:sqlite` patterns; Web Standard `Request`/`Response`.
3. **DI container is mandatory.** App construction requires a `Container`. Routes declare deps; container validates them at boot.
4. **Route table is frozen after `listen()`.** Boot-time toposort validates the full dependency graph; failures prevent server start.
5. **Errors are structured.** Default error responses follow RFC 9457 (Problem Details for HTTP APIs). No `e.toString()` echoes.

## 5. Monorepo Structure

```
zebra/                            (bun workspace)
├── packages/
│   ├── zebra/                    zebra               facade, re-exports core
│   ├── core/                     @zebra/core         App, DI, Router, HTTP
│   ├── testing/                  @zebra/testing      createTestApp, helpers
│   ├── validation/               @zebra/validation   standard-schema adapter
│   ├── openapi/                  @zebra/openapi      OpenAPI 3.1 + Swagger UI
│   ├── session/                  @zebra/session      cookie session, session scope
│   ├── websocket/                @zebra/websocket    Bun WS upgrade
│   ├── cors/                     @zebra/cors         CORS middleware
│   └── rate-limit/               @zebra/rate-limit   rate limiter
├── examples/
│   ├── hello/
│   ├── blog/
│   └── auth/
├── apps/
│   └── docs/                     VitePress docs site
├── package.json                  workspaces field
├── biome.json                    linter + formatter
└── tsconfig.base.json
```

Build orchestration: `bun --filter <pkg> <script>`. Add Turbo later if cache-aware orchestration becomes needed.

## 6. Public API Surface

### 6.1 App creation

```typescript
import "reflect-metadata";
import { Zebra, Container } from "@zebra/core";

const container = new Container();
container.bind(Db).toFactory(() => new SqliteDatabase(":memory:"));
container.bind(BlogService).toSelf();

const app = new Zebra({
  container,
  body: {
    maxSize: 1024 * 1024,
    json: { limit: 1024 * 1024 },
    form: { limit: 1024 * 1024 },
    multipart: { limit: 16 * 1024 * 1024, maxFiles: 10, maxFileSize: 8 * 1024 * 1024 },
  },
  errors: { exposeStack: process.env.NODE_ENV !== "production" },
  session: {
    resolver: (req) => req.headers.get("x-session-id") ?? undefined,
    ttl: 30 * 60 * 1000,
  },
});

await app.listen({ port: 3000 });
```

### 6.2 DI container

**Tokens.** Two forms, both supported:

```typescript
// Form A: class is its own token (concrete classes)
class BlogService { ... }
container.bind(BlogService).toSelf();

// Form B: explicit Token<T> for interfaces or primitives
const Db = token<Database>("Db");
container.bind(Db).toFactory(() => new SqliteDatabase(":memory:"));
```

`Token<T>` is a branded `Symbol` carrying phantom type `T`. `container.resolve(Db)` returns `Database`.

**Service declaration.** `@injectable` plus `@inject(TOKEN)` on parameters:

```typescript
interface ILogger { info(msg: string): void }
const LoggerToken = token<ILogger>("Logger");

@injectable()
class BlogService {
  constructor(
    private db: Database,                         // class type → auto-resolved via reflect-metadata
    @inject(LoggerToken) private logger: ILogger, // interface → explicit token required
  ) {}
}
```

Rule: when the constructor parameter type is a **concrete class** that is bound in the container, no `@inject` needed (reflect-metadata recovers the class reference at runtime). For **interfaces, type aliases, or primitive values** — which are erased at runtime — an explicit `@inject(Token)` is required.

Requires `tsconfig`: `experimentalDecorators: true`, `emitDecoratorMetadata: true`. Entry file must `import "reflect-metadata"`.

**Container methods.**

```typescript
container.bind(Token).to(ClassImpl);           // class binding
container.bind(Token).toSelf();                // class binding to itself
container.bind(Token).toFactory(fn);           // factory binding
container.bind(Token).toValue(literal);        // value binding

// Scope is chained
container.bind(Token).toSelf().inSingletonScope();   // default
container.bind(Token).toSelf().inRequestScope();
container.bind(Token).toSelf().inSessionScope();
container.bind(Token).toSelf().inTransientScope();

container.resolve(Token);                      // returns T
container.rebind(Token).toValue(mock);         // for testing
container.snapshot() / container.restore();    // for testing
container.createChildScope(kind);              // internal, for request/session
```

**Scope semantics.**

| Scope | Lifetime | Use case |
|---|---|---|
| Singleton (default) | App lifetime | Stateless services, db pool, config, logger |
| Request | One HTTP request | Per-request user, DB transaction, request cache |
| Session | One session (by session id) | Long-lived state across requests (WebSocket, SSE, cart) |
| Transient | New each resolve | UUID generators, one-shot builders |

Request scope: each request creates a child scope; instances cached in child; child disposed at request end (triggers `Disposable.dispose()` if present).

Session scope: session id is resolved by `session.resolver(req): string | undefined` (the top-level `sessionResolver` alias is also accepted). Session-scoped instances live in a session-keyed map with an idle TTL. `app.disposeSession(id)` triggers cleanup (used on logout). Default TTL: 30 min idle. Requests without a session id receive an isolated, request-local session scope that is disposed at request end.

### 6.3 Route registration

**Basic.**

```typescript
app.get("/hello/:name", async (req) => `hello, ${req.params.name}`);
```

**With dependencies (named object).**

```typescript
app.get(
  "/blogs/:id",
  { blog: BlogService },
  async (req, { blog }) => blog.find(req.params.id),
);
```

**With schema (v0.2+).**

```typescript
app.post(
  "/blogs",
  { blog: BlogService },
  { body: BlogSchema, query: PaginationSchema },
  async (req, { blog }) => blog.create(await req.body()),
);
```

**Groups (v0.1).**

```typescript
app.group("/admin", (g) => {
  g.use(adminAuth);
  g.get("/users", { users: UserService }, ...);
  g.delete("/users/:id", { users: UserService }, ...);
});
```

Groups inherit parent middlewares; group-scoped middlewares apply only to children. Groups can nest.

**Path syntax.** `:param` for path variables (Express/Fastify/Hono compatible). Wildcards: `*splat` for catch-all. Replaces v1's `{name}`.

**Type-safe params.** Path string is parsed at type level: `"/blogs/:id/comments/:cid"` → `req.params` has type `{ id: string; cid: string }`. Implemented with TS template literal types in `@zebra/core`.

### 6.4 Request shape

```typescript
interface ZebraRequest<Params = unknown, Body = unknown, Query = unknown> {
  raw: Request;                  // Web Standard Request
  params: Params;                // path params, typed from route string
  query: Query;                  // parsed query string
  body: () => Promise<Body>;     // lazy parsed body (read on first call)
  headers: Headers;
  url: URL;
  ctx: Map<symbol, unknown>;     // per-request bag for middleware → handler
}
```

`body()` is lazy and memoized — it parses only on the first call. GET requests with no body access incur zero parse cost. Schema-aware routes introduced in v0.2 may parse before handler entry and narrow `Body`, but the v0.1 primitive remains asynchronous.

### 6.5 Middleware

Koa-style onion, DI-aware.

```typescript
type Middleware = (req: ZebraRequest, next: () => Promise<Response>) => Promise<Response>;

app.use(async (req, next) => {
  const start = performance.now();
  const res = await next();
  console.log(`${req.url.pathname} ${performance.now() - start}ms`);
  return res;
});

// Middleware with deps
const auditMiddleware = middleware(
  { audit: AuditService },
  async (req, next, { audit }) => {
    const res = await next();
    await audit.log(req.url.pathname, res.status);
    return res;
  },
);
app.use(auditMiddleware);
```

Middleware deps participate in boot-time validation.

**Built-in middlewares (v0.1).**

- `errorMiddleware()` — catches exceptions, converts to Problem+Json. Installed by default at chain root.
- `bodyMiddleware()` — Content-Type aware body parser. Installed by default. Honors `body` config.

### 6.6 HTTP details

**Body parsing.** Routes Content-Type to parser; uses Bun streaming APIs:

- `application/json` → `Bun.readableStreamToJSON`
- `application/x-www-form-urlencoded` → `URLSearchParams` over text
- `multipart/form-data` → `request.formData()` (Bun native)
- Other → raw `Uint8Array` via `request.arrayBuffer()`

Size limits enforced before parse. Over-limit → 413. Parse failure → 400 Problem+Json.

**Static files.**

```typescript
app.static("/assets", "./public", {
  index: "index.html",
  maxAge: 3600,
});
```

Implementation:
1. `path.resolve(root, decodedFilename)`
2. Verify `resolved.startsWith(root + sep)` → else 403 (path traversal defense)
3. `Bun.file(resolved)` for streaming response with zero-copy fast path
4. Content-Type via `Bun.file().type`
5. ETag (weak, by `mtime + size`), If-None-Match, Range supported

**Errors.** `HttpError(status, code, title, detail?)`. Default `errorMiddleware()`:

- Known `HttpError` → status from instance, body is Problem+Json
- Validation errors → 422 + `errors: [{ path, message }]`
- Unknown → 500. Stack exposed only when `errors.exposeStack: true`

Response shape (RFC 9457):

```json
{
  "type": "https://errors.zebra.dev/blog_not_found",
  "status": 404,
  "title": "no such blog",
  "detail": "blog id=42 not found",
  "instance": "/blogs/42"
}
```

### 6.7 Lifecycle hooks

```typescript
app.on("boot", async () => { /* migrations, connect pools */ });
app.on("ready", () => { /* server accepting */ });
app.on("shutdown", async () => { /* drain, close */ });

await app.listen({ port: 3000 });
```

Boot order:
1. `boot` handlers run sequentially in registration order
2. Boot-time DI graph validation (after `boot` so user code can `container.bind(...)` in `boot` if needed)
3. Router compiles radix tree (frozen)
4. `Bun.serve` starts
5. `ready` handlers fire

Shutdown (`SIGTERM` / `SIGINT` / explicit `app.stop()`):
1. Stop accepting new connections
2. Wait up to `gracePeriod` (default 10s) for in-flight requests
3. Force-close after timeout
4. Dispose singleton-scoped instances implementing `Disposable`
5. `shutdown` handlers run

### 6.8 Testing (`@zebra/testing`)

```typescript
import { createTestApp } from "@zebra/testing";

const app = createTestApp({ container: testContainer });

// Container manipulation
testContainer.rebind(EmailService).toValue(mockEmailService);

// In-process dispatch — no socket
const res = await app.request("/blogs/1", { method: "GET" });
expect(res.status).toBe(200);
expect(await res.json()).toEqual({ id: 1, title: "..." });
```

`app.request(path, init)` constructs a `Request` and runs it through the full middleware + DI chain, returning the `Response`. `Bun.serve` is not started. Boot handlers and dependency validation run on explicit `app.boot()` or automatically before the first `app.request()`, after the test has registered its routes and mocks.

## 7. Internal Design

### 7.1 Container implementation

- Bindings stored in `Map<Token | Class, Binding>`. `Binding` carries `{ kind, factory, scope }`.
- Singleton: instance cached on the root container.
- Request / Session: child scope created at request / session start. Child holds its own instance cache; parent bindings remain visible via lookup chain.
- Transient: never cached.
- Cycle detection: on resolve, push token to a per-resolution "resolution stack"; same token re-entry → throw `CircularDependencyError` with full path.

### 7.2 Router (radix tree)

- Inspired by `find-my-way`. Each node has static children, parametric children (`:param`), and optional wildcard (`*splat`).
- Insert: split path on `/`, walk and split nodes as needed.
- Lookup: O(path length), allocation-free for static routes.
- Returns `{ handler, params, deps }`; handler invocation injects deps from the request-scoped child container.

### 7.3 Boot-time dependency validation

After all `boot` handlers run:

1. Walk all registered routes → collect (handler deps + middleware deps in chain)
2. For each token in collected set, recursively traverse container bindings to find transitive deps
3. Toposort the resulting graph
   - Failure → `CircularDependencyError`
   - Missing binding → `UnboundTokenError` with the path that needed it (`BlogService → BlogRepo → Db`)
4. Scope mismatch check: a singleton-bound service must not depend on a request/session-bound service. Violation → `ScopeMismatchError`.

All errors include enough context to fix without trial-and-error.

### 7.4 Request lifecycle

```
Bun.serve receives Request
  ↓
app dispatch(req)
  ├─ Create request-scoped child container
  ├─ Resolve session-scoped container (if session.resolver returns id)
  ├─ Run middleware chain (onion)
  │     ↓ each middleware can read req.ctx, inject deps
  ├─ Router matches → resolve handler deps from child container
  ├─ Handler runs, returns Response (or value → JSON Response)
  ├─ Unwind middleware chain (post-hooks)
  ↓
Response returned to Bun.serve
  ↓
Dispose request-scoped child container (call .dispose() on disposables)
```

Exceptions propagate up; `errorMiddleware` (always outermost) converts to Problem+Json.

## 8. Per-Package API Highlights (v0.2+)

### 8.1 `@zebra/validation` (v0.2)

Adapter over [standard-schema](https://github.com/standard-schema/standard-schema) — works with Zod, Valibot, ArkType, any compliant validator.

```typescript
import { z } from "zod";

app.post(
  "/blogs",
  { blog: BlogService },
  { body: z.object({ title: z.string(), content: z.string() }) },
  async (req, { blog }) => blog.create(await req.body()),  // body result typed
);
```

Validation runs after body parsing, before handler. Failure → 422 Problem+Json with field-level errors.

### 8.2 `@zebra/openapi` (v0.2)

- Reads route table + schemas → emits OpenAPI 3.1 document at `/openapi.json`
- Optional Swagger UI at `/docs` (separate import to avoid bundling UI assets by default)
- Per-route `summary`, `description`, `tags`, `security` set via fourth options arg

```typescript
app.post("/blogs", deps, schemas, handler, {
  summary: "Create a blog post",
  tags: ["blogs"],
});
```

### 8.3 `@zebra/session` (v0.3)

- Cookie-based session middleware. Signs cookies with HMAC-SHA256.
- Pluggable session store: in-memory (default), Redis (separate adapter package later)
- Wires up session scope: `session.resolver` provided by this middleware
- Exposes `req.ctx.session` for read/write

```typescript
app.use(sessionMiddleware({
  secret: process.env.SESSION_SECRET,
  cookie: { name: "sid", maxAge: 86400, secure: true, httpOnly: true, sameSite: "lax" },
  store: new MemoryStore({ ttl: 1800 }),
}));
```

### 8.4 `@zebra/cors` (v0.3)

```typescript
app.use(cors({
  origin: ["https://example.com"],
  credentials: true,
  methods: ["GET", "POST", "PUT", "DELETE"],
  maxAge: 600,
}));
```

### 8.5 `@zebra/rate-limit` (v0.3)

```typescript
app.use(rateLimit({
  windowMs: 60_000,
  max: 100,
  keyBy: (req) => req.headers.get("x-forwarded-for") ?? "anon",
  store: new MemoryStore(),  // RedisStore separate package
}));
```

### 8.6 `@zebra/websocket` (v0.4)

```typescript
app.ws("/chat/:room", {
  onUpgrade: { user: AuthService },           // DI for upgrade decision
  async upgrade(req, { user }) {
    const u = await user.fromRequest(req.raw);
    return u ? { userId: u.id } : false;       // false → 401
  },
  open(ws, data) { ... },
  message(ws, data, msg) { ... },
  close(ws, data) { ... },
});
```

Session scope is reachable from WS handlers via `ws.data.session`. WebSocket uses Bun's native `Bun.serve({ websocket })` upgrade path.

## 9. Phased Delivery

| Version | Packages added | Done criteria |
|---|---|---|
| **v0.1 MVP** | `@zebra/core`, `@zebra/testing`, `zebra` | All §6.1–§6.8 work end-to-end; full test suite; boot-time validation catches all error classes |
| **v0.2** | `@zebra/validation`, `@zebra/openapi` | Type-safe body/query/params from schema; OpenAPI document generated; Swagger UI optional import |
| **v0.3** | `@zebra/session`, `@zebra/cors`, `@zebra/rate-limit` | Production-ready middleware suite; cookie session integrates with session scope |
| **v0.4** | `@zebra/websocket` | WS upgrade, session scope reachable, DI in upgrade decision |
| **v1.0** | API freeze, docs site complete, benchmark page | Public release; benchmarks against Hono and Elysia published |

Each version ships independently — users can pin to `@zebra/core@0.1` and never need the later packages.

The **implementation plan (writing-plans) targets v0.1 MVP only**. Subsequent versions get their own design refinement and plan when their turn comes; the API shapes in §8 are advisory until then.

## 10. Open Questions

These are deferred but called out so we don't accidentally close doors:

1. **CLI tooling.** Should `@zebra/cli` exist for scaffolding (`zebra new`, `zebra add`)? Deferred to post-v1.
2. **Plugin discovery.** Currently middleware is the only extension point. A formal `Plugin` interface (with lifecycle hooks, DI bindings) may be needed for ecosystem packages. Deferred.
3. **Bun macro for boot-time validation.** Could move dependency graph validation from runtime to build time. Significant complexity; revisit at v1.x.
4. **Distributed session store.** Redis adapter is `@zebra/session-redis` — design left to v0.3 detailed plan.

## 11. Out of Scope

- Migration from Zebra v1 (no users; fresh start)
- Node.js compatibility shim
- Server-side rendering / template engines
- ORM
- Auth provider (users compose with their own auth lib + `@zebra/session`)

---

## Addendum (2026-05-17): Implicit DI sugar

The DI section of this spec describes the `Container` API in full. After v0.1 shipped, a follow-up spec ([2026-05-17-zebra-implicit-di-design.md](2026-05-17-zebra-implicit-di-design.md)) added `inject*` methods directly on the `Zebra` class and made `ZebraOptions.container` optional. The underlying `Container` API is unchanged; the new methods are sugar that delegate to it. New apps should prefer the sugar; the explicit `Container` path remains for advanced cases (test mocks, shared containers, snapshot/restore).
