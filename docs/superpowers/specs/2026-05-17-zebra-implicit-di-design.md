# Zebra Implicit DI — Design Spec

**Date**: 2026-05-17
**Status**: Draft for approval
**Scope**: Add `inject*` methods to the `Zebra` class; make `Container` optional in `ZebraOptions`. Backwards-compatible sugar layer, no breaking changes.

---

## 1. Background

Today every Zebra app must construct a `Container` and pass it in:

```ts
import { Container, Zebra } from "zebra";
const container = new Container();
container.bind(BlogRepo).toSelf();
container.bind(BlogService).toSelf();
const app = new Zebra({ container });
```

Two pain points:

1. **Hello example carries ceremony for zero benefit.** `examples/hello/src/main.ts` constructs a `Container` it never binds anything to. Just to satisfy `ZebraOptions.container`.
2. **`bind(X).toSelf().inSingletonScope()` is verbose for the 80% case.** The three-step fluent chain reads awkwardly and most lines repeat `toSelf()`.

The goal is to keep DI mandatory and graph-validated (Zebra's differentiator) while reducing line-noise for common binding patterns.

## 2. Goals

- **Optional `container` in `ZebraOptions`.** `new Zebra()` works; an empty `Container` is created internally.
- **Single-call binding sugar on the `Zebra` instance.** Scope is encoded in the method name; no fluent chain required for common patterns.
- **No global state, no implicit "current app", no `z.using` switching.** Each `Zebra` instance is self-contained.
- **Zero breaking changes.** Existing `new Zebra({ container })` calls and direct `container.bind(...)` usage continue to work.
- **Variable naming convention.** Docs and examples encourage `const z = new Zebra()` — the variable is named `z`. The class stays `Zebra`.

## 3. Non-Goals

- Module-level `z` namespace (rejected: requires global mutable state to know "where bindings land").
- Auto-binding unbound classes at resolve time (rejected: weakens boot-time graph validation; obscures `UnboundTokenError` debugging).
- Replacing `Container` (rejected: power users and `@zebra/testing` rely on direct container access).
- New scope kinds. Same four: Singleton, Request, Session, Transient.
- Resolve-side helpers (`useService(X)` inside handlers, etc.). Routes still declare deps via the named-object spec.

## 4. API Surface

### 4.1 Constructor

`ZebraOptions.container` becomes optional. When omitted, `Zebra` constructs an empty `Container`.

```ts
export interface ZebraOptions {
  container?: Container;  // was required
  body?: Partial<BodyOptions>;
  errors?: { exposeStack?: boolean };
}

// All four work
new Zebra();
new Zebra({});
new Zebra({ body: { ... } });
new Zebra({ container: myContainer });  // escape hatch unchanged
```

### 4.2 Binding methods on `Zebra`

Nine methods, all return `void`. They delegate to `this.container.bind(...)`.

**Class bindings — toSelf or to(Impl):**

```ts
z.injectSingleton(BlogRepo);                       // BlogRepo.toSelf().inSingletonScope()
z.injectSingleton(IBlogRepo, BlogRepoSqlite);      // bind(IBlogRepo).to(BlogRepoSqlite).inSingletonScope()

z.injectRequest(CurrentUser);                      // toSelf, request scope
z.injectRequest(IUser, SessionUser);               // mapped

z.injectTransient(IdGenerator);
z.injectTransient(IIdGen, UuidGen);

z.injectSession(Cart);
z.injectSession(ICart, RedisCart);
```

**Factory bindings — one method per scope, two overloads each:**

Each factory method accepts either a raw `(c: Container) => T` callback (lazy, deps invisible to boot validation) or a `deps`-spec + `(deps) => T` callback (deps walked at boot, identical treatment to class bindings).

```ts
// Lazy form — no deps spec, factory body uses Container at will
z.injectFactoryTransient(RequestId, () => crypto.randomUUID());

// Declared form — deps spec second, factory receives resolved object
z.injectFactorySingleton(Db, { config: Config }, ({ config }) => createDb(config));
z.injectFactoryRequest(Tx, { db: Db }, ({ db }) => beginTx(db));
z.injectFactorySession(SessionState, { store: SessionStore }, ({ store }) => loadSession(store));
```

The declared form is the recommended path. The lazy form remains for the rare case where the factory needs to resolve identifiers dynamically (conditional branches, runtime-determined keys); errors in the lazy form only surface at first resolve, not at boot.

**Value binding — always singleton (matches existing `toValue` semantics):**

```ts
z.injectValue(Config, { dbUrl: "postgres://..." });
```

### 4.3 Escape hatches preserved

The underlying `Container` is still accessible for advanced cases (snapshot/restore, rebind, child scopes):

```ts
// Existing path — unchanged
const c = new Container();
c.bind(X).to(Impl).inRequestScope();
const z = new Zebra({ container: c });

// Or via the instance, when starting from sugar
const z = new Zebra();
z.injectSingleton(Service);
// later, advanced manipulation
(z as any).container.snapshot();   // protected today; see 4.4
```

### 4.4 Visibility of `container`

`Zebra.container` is currently `protected`. We keep it `protected` — the sugar methods cover the 95% case, and users wanting low-level access can construct their own `Container` and pass it in via `ZebraOptions.container`, which gives them their own reference.

This avoids exposing a mutable handle that bypasses Zebra's lifecycle (boot validation, freeze-after-listen).

### 4.5 Factory deps in boot validation

Today, `validateGraph` (`packages/core/src/app/boot-validation.ts:64-70`) only recurses into `binding.kind === "class"` — factory bindings are opaque, so unbound/circular/scope errors involving a factory's dependencies surface at first request, not at boot.

To close this gap **without** changing the existing `Container.bind(X).toFactory(fn)` semantics:

1. Extend `Binding<T>` (`packages/core/src/di/binding.ts`) with an optional field:
   ```ts
   export interface Binding<T> {
     identifier: Identifier<T>;
     kind: BindingKind;
     target: unknown;
     scope: ScopeKind;
     factoryDeps?: Record<string, Identifier<unknown>>;   // new
   }
   ```
2. The new `injectFactory*` declared form sets `factoryDeps`; the lazy form leaves it `undefined`. The legacy `Container.bind(X).toFactory(fn)` path also leaves it `undefined`, preserving its lazy semantics.
3. Extend `walk()` in `boot-validation.ts`:
   ```ts
   if (binding.kind === "class") { /* existing */ }
   else if (binding.kind === "factory" && binding.factoryDeps) {
     for (const d of Object.values(binding.factoryDeps)) {
       walk(container, d, [...stack, name], visited, binding.scope);
     }
   }
   // factory without factoryDeps, or value: skip (unchanged behavior)
   ```
4. Extend `Container.instantiate()` (`packages/core/src/di/container.ts:92-93`):
   ```ts
   if (binding.kind === "factory") {
     if (binding.factoryDeps) {
       const resolved: Record<string, unknown> = {};
       for (const [name, id] of Object.entries(binding.factoryDeps)) {
         resolved[name] = this.resolveWithStack(id, stack);
       }
       instance = (binding.target as (deps: Record<string, unknown>) => T)(resolved);
     } else {
       instance = (binding.target as (c: Container) => T)(this);
     }
   }
   ```

Net effect: the declared-form factory is graph-validated *exactly like* a class binding — circular deps, unbound tokens, and scope-rank violations all caught at `listen()`. The lazy form is unchanged.

Cross-import note: `Record<string, Identifier<unknown>>` is structurally identical to today's `DepsSpec` (`app/types.ts:8`). We define `factoryDeps`'s type inline in `binding.ts` to avoid creating a `di/` → `app/` import edge. Tightening the shared shape into one named type is a separate cleanup.

## 5. Implementation Sketch

Add to `packages/core/src/app/app.ts`:

```ts
import { ScopeKind } from "../di/scope.ts";

export class Zebra {
  // ... existing fields ...

  constructor(opts: ZebraOptions = {}) {
    this.container = opts.container ?? new Container();
    this.bodyOpts = { ...DEFAULT_BODY, ...(opts.body ?? {}) };
    this.exposeStack = opts.errors?.exposeStack ?? false;
  }

  // Class bindings
  injectSingleton<T>(id: Identifier<T>, impl?: ClassConstructor<T>): void {
    this.bindClass(id, impl, ScopeKind.Singleton);
  }
  injectRequest<T>(id: Identifier<T>, impl?: ClassConstructor<T>): void {
    this.bindClass(id, impl, ScopeKind.Request);
  }
  injectTransient<T>(id: Identifier<T>, impl?: ClassConstructor<T>): void {
    this.bindClass(id, impl, ScopeKind.Transient);
  }
  injectSession<T>(id: Identifier<T>, impl?: ClassConstructor<T>): void {
    this.bindClass(id, impl, ScopeKind.Session);
  }

  // Factory bindings — overloaded: lazy fn or (deps, fn)
  injectFactorySingleton<T>(id: Identifier<T>, fn: (c: Container) => T): void;
  injectFactorySingleton<T>(
    id: Identifier<T>,
    deps: Record<string, Identifier<unknown>>,
    fn: (deps: Record<string, unknown>) => T,
  ): void;
  injectFactorySingleton(id: any, a: any, b?: any): void {
    this.bindFactory(id, a, b, ScopeKind.Singleton);
  }
  injectFactoryRequest<T>(id: Identifier<T>, fn: (c: Container) => T): void;
  injectFactoryRequest<T>(
    id: Identifier<T>,
    deps: Record<string, Identifier<unknown>>,
    fn: (deps: Record<string, unknown>) => T,
  ): void;
  injectFactoryRequest(id: any, a: any, b?: any): void {
    this.bindFactory(id, a, b, ScopeKind.Request);
  }
  injectFactoryTransient<T>(id: Identifier<T>, fn: (c: Container) => T): void;
  injectFactoryTransient<T>(
    id: Identifier<T>,
    deps: Record<string, Identifier<unknown>>,
    fn: (deps: Record<string, unknown>) => T,
  ): void;
  injectFactoryTransient(id: any, a: any, b?: any): void {
    this.bindFactory(id, a, b, ScopeKind.Transient);
  }
  injectFactorySession<T>(id: Identifier<T>, fn: (c: Container) => T): void;
  injectFactorySession<T>(
    id: Identifier<T>,
    deps: Record<string, Identifier<unknown>>,
    fn: (deps: Record<string, unknown>) => T,
  ): void;
  injectFactorySession(id: any, a: any, b?: any): void {
    this.bindFactory(id, a, b, ScopeKind.Session);
  }

  // Value binding (always singleton)
  injectValue<T>(id: Identifier<T>, value: T): void {
    this.assertNotFrozen();
    this.container.bind(id).toValue(value);
  }

  private bindClass<T>(id, impl, scope): void {
    this.assertNotFrozen();
    const b = this.container.bind(id);
    if (impl) b.to(impl);
    else b.toSelf();
    setScope(b, scope);
  }

  private bindFactory(id, a, b, scope): void {
    this.assertNotFrozen();
    if (b === undefined) {
      // Lazy form: (id, fn) — no deps spec, factory receives Container
      setScope(this.container.bind(id).toFactory(a), scope);
    } else {
      // Declared form: (id, deps, fn) — internal helper sets factoryDeps
      // (new BindingBuilder method or direct binding mutation in implementation)
      setScope(this.container.bindFactoryWithDeps(id, a, b), scope);
    }
  }

  private assertNotFrozen(): void {
    if (this.frozen) throw new Error("Cannot register bindings after app.listen()");
  }
}

// Helper — picks the right inXxxScope() method
function setScope(b: BindingBuilder<any>, scope: ScopeKind): void {
  switch (scope) {
    case ScopeKind.Singleton: b.inSingletonScope(); break;
    case ScopeKind.Request:   b.inRequestScope();   break;
    case ScopeKind.Transient: b.inTransientScope(); break;
    case ScopeKind.Session:   b.inSessionScope();   break;
  }
}
```

Notes:

- Reuse `BindingBuilder`. The sugar methods are thin wrappers, not a parallel implementation. Boot validation, scope-rank checks, and dispose semantics are unchanged.
- The `assertNotFrozen` check mirrors `register()` (app.ts:87). Registering bindings after `listen()` is rejected.
- The factory's signature matches existing `Container.bind(...).toFactory(fn)` — `fn` receives the container the binding was registered against.

## 6. Examples — Before and After

### `examples/hello`

**Before** (current):
```ts
import "reflect-metadata";
import { Container, Zebra } from "zebra";

const app = new Zebra({ container: new Container() });
app.get("/hello/:name", async (req) => `hello, ${req.params.name}`);
await app.listen({ port: 3000 });
```

**After**:
```ts
import "reflect-metadata";
import { Zebra } from "zebra";

const z = new Zebra();
z.get("/hello/:name", async (req) => `hello, ${req.params.name}`);
await z.listen({ port: 3000 });
```

### `examples/blog`

**Before** (current):
```ts
import "reflect-metadata";
import { Container, HttpError, Zebra } from "zebra";
import { BlogRepo, BlogService } from "./services.ts";

const container = new Container();
container.bind(BlogRepo).toSelf();
container.bind(BlogService).toSelf();
const app = new Zebra({ container });

app.group("/blogs", (g) => { /* ... */ });
await app.listen({ port: 3001 });
```

**After**:
```ts
import "reflect-metadata";
import { HttpError, Zebra } from "zebra";
import { BlogRepo, BlogService } from "./services.ts";

const z = new Zebra();
z.injectSingleton(BlogRepo);
z.injectSingleton(BlogService);

z.group("/blogs", (g) => { /* ... */ });
await z.listen({ port: 3001 });
```

Net effect: blog drops 3 lines (`Container` import, `new Container()`, fewer `.toSelf()` chains); hello drops 2 lines plus the unused `Container` import.

## 7. Testing

- `@zebra/testing`'s `createTestApp(opts)` continues to accept `ZebraOptions`. With this change, `createTestApp({})` works for routes that need no bindings.
- New tests in `packages/core/test`:
  - Each of the 9 `inject*` methods produces the same runtime resolution as the equivalent `container.bind(...)` chain.
  - `injectValue` ignores any scope hint (always singleton, matching `toValue`).
  - **Factory lazy form**: `injectFactorySingleton(X, fn)`'s `fn` receives the container instance it was registered against; unbound dep referenced inside `fn` throws at resolve, NOT at `listen()`.
  - **Factory declared form**: `injectFactorySingleton(X, { dep: Y }, ({ dep }) => ...)` walks `Y` in boot validation — unbound `Y` throws at `listen()`; circular dep through a declared-form factory throws `CircularDependencyError` at `listen()`; scope-rank violation through a declared-form factory throws `ScopeMismatchError` at `listen()`.
  - **Factory declared form** receives ONLY the declared deps object — not the container.
  - Registering bindings after `listen()` throws (covers both class and factory forms).
  - `new Zebra()` (no opts) constructs an empty container that resolves nothing.
  - Class-mapping form: `injectSingleton(IFoo, FooImpl)` — resolving `IFoo` returns a `FooImpl` instance.
  - Pre-existing `Container.bind(X).toFactory(fn)` path remains lazy (no `factoryDeps` set, validation skips it) — regression guard.

## 8. Docs & Examples Updates

- `examples/hello/src/main.ts` — rewrite as above.
- `examples/blog/src/main.ts` — rewrite as above.
- `README.md` quick-start section — switch the headline snippet to the new style; mention `new Zebra({ container })` exists for advanced use, link to a "DI advanced" subsection.
- `llms.txt` — update the "DI is mandatory" bullet to mention the `inject*` sugar.
- `docs/superpowers/specs/2026-05-16-zebra-v2-design.md` — add a paragraph cross-linking this spec.

## 9. Rollout

Single PR, no flag, no deprecation cycle:

1. Add the 9 methods + optional `container`.
2. Add tests.
3. Rewrite both examples.
4. Update README, llms.txt, and v2 design spec cross-link.

No breaking change → no major bump. Cut as `v0.2.0`.

## 10. Open Questions

None at spec-approval time. Implementation plan (next step, via `writing-plans`) will sequence the work and break it into reviewable steps.
