# Zebra Implicit DI Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add `inject*` sugar methods to the `Zebra` class so simple apps no longer need to construct a `Container` explicitly, and so `.bind(X).toSelf().inSingletonScope()` collapses to `injectSingleton(X)`. Add boot-time graph validation for factory bindings via an optional declared-deps form.

**Architecture:** Pure additive sugar layer on top of existing `Container` + `Binding` + `validateGraph`. Nine new methods on `Zebra` (four class-scope + four factory-scope + one value). `ZebraOptions.container` becomes optional. `Binding.factoryDeps` (new optional field) lets the new factory form participate in boot validation. Zero breaking changes; existing `new Zebra({ container })` and direct `Container.bind(...)` paths are untouched.

**Tech Stack:** Bun 1.x · TypeScript 5.x (experimentalDecorators) · reflect-metadata · bun:test

**Spec reference:** [`docs/superpowers/specs/2026-05-17-zebra-implicit-di-design.md`](../specs/2026-05-17-zebra-implicit-di-design.md)

---

## File Structure

**Modify:**
- `packages/core/src/di/binding.ts` — extend `Binding<T>` with `factoryDeps?` field; extend `BindingBuilder` with internal `toFactoryWithDeps` method.
- `packages/core/src/di/container.ts` — extend `instantiate()` to resolve `factoryDeps` and pass resolved object to factory.
- `packages/core/src/app/boot-validation.ts` — extend `walk()` to recurse into `factoryDeps` for factory bindings.
- `packages/core/src/app/types.ts` — make `ZebraOptions.container` optional.
- `packages/core/src/app/app.ts` — default-construct `Container` when `opts.container` omitted; add 9 `inject*` methods + 3 private helpers.
- `examples/hello/src/main.ts` — rewrite to use new sugar.
- `examples/blog/src/main.ts` — rewrite to use new sugar.
- `README.md` — switch quick-start to new sugar; add small "advanced: bring your own Container" subsection.
- `llms.txt` — update DI bullet to mention `inject*` sugar.
- `docs/superpowers/specs/2026-05-16-zebra-v2-design.md` — add a cross-link paragraph pointing to the new spec.

**Create:**
- `packages/core/test/di/factory-deps.test.ts` — tests for new declared-deps factory path (resolution + caching).
- `packages/core/test/app/inject-methods.test.ts` — tests for the 9 `inject*` methods (class, factory lazy/declared, value).
- `packages/core/test/app/inject-boot-validation.test.ts` — boot-validation tests covering declared-form factory (unbound, circular, scope-mismatch).
- `packages/core/test/app/zebra-default-container.test.ts` — tests for `new Zebra()` with omitted container + frozen-after-listen guard.

Boundary check: every existing file changed has one clear responsibility; new tests are split by topic, not by class, to keep each file focused.

---

## Phase 1: Container/Binding plumbing for factoryDeps

### Task 1: Add `factoryDeps` field to `Binding` and `BindingBuilder.toFactoryWithDeps`

**Files:**
- Modify: `packages/core/src/di/binding.ts`

- [ ] **Step 1: Write the failing test**

Create `packages/core/test/di/factory-deps.test.ts`:

```ts
import { expect, test } from "bun:test";
import { Container } from "../../src/di/container.ts";
import { token } from "../../src/di/token.ts";

test("toFactoryWithDeps: factory receives resolved deps object, not container", () => {
  const Config = token<{ url: string }>("Config");
  const Db = token<{ url: string }>("Db");
  const c = new Container();
  c.bind(Config).toValue({ url: "postgres://x" });
  // @ts-expect-error - method added in this task
  c.bind(Db).toFactoryWithDeps({ config: Config }, ({ config }) => ({ url: config.url }));
  expect(c.resolve(Db)).toEqual({ url: "postgres://x" });
});

test("toFactoryWithDeps: factory NOT called with container arg", () => {
  const T = token<{ ok: boolean }>("T");
  const c = new Container();
  c.bind(T)
    // @ts-expect-error - method added in this task
    .toFactoryWithDeps({}, (arg) => {
      // Factory must receive an object (the resolved deps), not the Container itself
      const isContainer = typeof (arg as any)?.resolve === "function";
      return { ok: !isContainer };
    });
  expect(c.resolve(T).ok).toBe(true);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `bun test packages/core/test/di/factory-deps.test.ts`
Expected: FAIL — `toFactoryWithDeps is not a function` (or TypeScript error).

- [ ] **Step 3: Add the field and the builder method**

Edit `packages/core/src/di/binding.ts`. Replace the entire file with:

```ts
import { ScopeKind } from "./scope.ts";
import type { Identifier } from "./token.ts";

export type BindingKind = "class" | "factory" | "value";

export interface Binding<T> {
  identifier: Identifier<T>;
  kind: BindingKind;
  target: unknown;
  scope: ScopeKind;
  factoryDeps?: Record<string, Identifier<unknown>>;
}

export class BindingBuilder<T> {
  constructor(private readonly binding: Binding<T>) {}

  to(cls: new (...args: any[]) => T): BindingBuilder<T> {
    this.binding.kind = "class";
    this.binding.target = cls;
    return this;
  }
  toSelf(): BindingBuilder<T> {
    this.binding.kind = "class";
    this.binding.target = this.binding.identifier;
    return this;
  }
  toFactory(fn: (c: any) => T): BindingBuilder<T> {
    this.binding.kind = "factory";
    this.binding.target = fn;
    this.binding.factoryDeps = undefined;
    return this;
  }
  toFactoryWithDeps(
    deps: Record<string, Identifier<unknown>>,
    fn: (resolved: Record<string, unknown>) => T,
  ): BindingBuilder<T> {
    this.binding.kind = "factory";
    this.binding.target = fn;
    this.binding.factoryDeps = deps;
    return this;
  }
  toValue(v: T): BindingBuilder<T> {
    this.binding.kind = "value";
    this.binding.target = v;
    this.binding.scope = ScopeKind.Singleton;
    return this;
  }
  inSingletonScope(): BindingBuilder<T> {
    this.binding.scope = ScopeKind.Singleton;
    return this;
  }
  inSessionScope(): BindingBuilder<T> {
    this.binding.scope = ScopeKind.Session;
    return this;
  }
  inRequestScope(): BindingBuilder<T> {
    this.binding.scope = ScopeKind.Request;
    return this;
  }
  inTransientScope(): BindingBuilder<T> {
    this.binding.scope = ScopeKind.Transient;
    return this;
  }
}
```

- [ ] **Step 4: Update `Container.instantiate()` to handle the declared-deps path**

Edit `packages/core/src/di/container.ts`. Replace the `instantiate` method body (lines 82-101) with:

```ts
  protected instantiate<T>(binding: Binding<T>, stack: string[]): T {
    const key = keyOf(binding.identifier);
    if (binding.kind === "value") return binding.target as T;

    const cacheContainer = this.cacheContainerFor(binding.scope);
    if (cacheContainer?.instances.has(key)) {
      return cacheContainer.instances.get(key);
    }

    let instance: T;
    if (binding.kind === "factory") {
      if (binding.factoryDeps) {
        const resolved: Record<string, unknown> = {};
        for (const [name, id] of Object.entries(binding.factoryDeps)) {
          resolved[name] = this.resolveWithStack(id, stack);
        }
        instance = (binding.target as (r: Record<string, unknown>) => T)(resolved);
      } else {
        instance = (binding.target as (c: Container) => T)(this);
      }
    } else {
      const cls = binding.target as new (...args: any[]) => T;
      const deps = getConstructorDeps(cls).map((d) => this.resolveWithStack(d, stack));
      instance = new cls(...deps);
    }
    if (cacheContainer) cacheContainer.instances.set(key, instance);
    return instance;
  }
```

- [ ] **Step 5: Run test to verify it passes**

Run: `bun test packages/core/test/di/factory-deps.test.ts`
Expected: PASS (both tests).

- [ ] **Step 6: Run the existing factory test to ensure no regression**

Run: `bun test packages/core/test/di/container-factory.test.ts`
Expected: PASS (2/2 unchanged).

- [ ] **Step 7: Commit**

```bash
git add packages/core/src/di/binding.ts packages/core/src/di/container.ts packages/core/test/di/factory-deps.test.ts
git commit -m "$(cat <<'EOF'
feat(di): add Binding.factoryDeps + BindingBuilder.toFactoryWithDeps

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

### Task 2: Add caching test for declared-form factory + cross-scope dep resolution

**Files:**
- Modify: `packages/core/test/di/factory-deps.test.ts`

- [ ] **Step 1: Append three more tests covering scope + caching**

Append to `packages/core/test/di/factory-deps.test.ts`:

```ts
import { ScopeKind } from "../../src/di/scope.ts";

test("toFactoryWithDeps singleton: factory called once across resolves", () => {
  const T = token<{ n: number }>("T");
  const c = new Container();
  let calls = 0;
  c.bind(T).toFactoryWithDeps({}, () => ({ n: ++calls }));
  c.resolve(T);
  c.resolve(T);
  expect(calls).toBe(1);
});

test("toFactoryWithDeps request scope: factory called once per request child", () => {
  const T = token<{ n: number }>("T");
  const root = new Container();
  let calls = 0;
  root.bind(T).toFactoryWithDeps({}, () => ({ n: ++calls })).inRequestScope();

  const reqA = root.createChildScope(ScopeKind.Request);
  reqA.resolve(T);
  reqA.resolve(T);
  expect(calls).toBe(1);

  const reqB = root.createChildScope(ScopeKind.Request);
  reqB.resolve(T);
  expect(calls).toBe(2);
});

test("toFactoryWithDeps: resolves a class dep alongside a value dep", () => {
  class Helper {
    greet(n: string) { return `hi ${n}`; }
  }
  const Name = token<string>("Name");
  const Out = token<string>("Out");
  const c = new Container();
  c.bind(Helper).toSelf();
  c.bind(Name).toValue("world");
  c.bind(Out).toFactoryWithDeps(
    { h: Helper, name: Name },
    ({ h, name }) => (h as Helper).greet(name as string),
  );
  expect(c.resolve(Out)).toBe("hi world");
});
```

- [ ] **Step 2: Run tests**

Run: `bun test packages/core/test/di/factory-deps.test.ts`
Expected: PASS (5 total).

- [ ] **Step 3: Commit**

```bash
git add packages/core/test/di/factory-deps.test.ts
git commit -m "$(cat <<'EOF'
test(di): factoryDeps scope + cross-binding resolution coverage

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Phase 2: Boot-validation walks factoryDeps

### Task 3: Extend `walk()` to recurse into declared-form factory deps

**Files:**
- Create: `packages/core/test/app/inject-boot-validation.test.ts`
- Modify: `packages/core/src/app/boot-validation.ts:64-70`

- [ ] **Step 1: Write the failing tests**

Create `packages/core/test/app/inject-boot-validation.test.ts`:

```ts
import "reflect-metadata";
import { expect, test } from "bun:test";
import { Zebra } from "../../src/app/app.ts";
import { Container } from "../../src/di/container.ts";
import { injectable } from "../../src/di/decorators.ts";
import {
  CircularDependencyError,
  ScopeMismatchError,
  UnboundTokenError,
} from "../../src/di/errors.ts";
import { token } from "../../src/di/token.ts";

test("listen: declared-form factory with unbound dep throws UnboundTokenError at boot", async () => {
  const Missing = token<string>("Missing");
  const Out = token<string>("Out");
  const c = new Container();
  c.bind(Out).toFactoryWithDeps({ m: Missing }, ({ m }) => m as string);

  const app = new Zebra({ container: c });
  app.get("/x", { out: Out }, async () => "ok");
  await expect(app.listen({ port: 0 })).rejects.toThrow(UnboundTokenError);
});

test("listen: declared-form factory with circular dep throws CircularDependencyError at boot", async () => {
  const A = token<unknown>("FacA");
  const B = token<unknown>("FacB");
  const c = new Container();
  c.bind(A).toFactoryWithDeps({ b: B }, ({ b }) => ({ b }));
  c.bind(B).toFactoryWithDeps({ a: A }, ({ a }) => ({ a }));

  const app = new Zebra({ container: c });
  app.get("/x", { a: A }, async () => "ok");
  await expect(app.listen({ port: 0 })).rejects.toThrow(CircularDependencyError);
});

@injectable() class ReqOnly {}

test("listen: singleton factory depending on request-scoped class throws ScopeMismatchError", async () => {
  const SingletonOut = token<unknown>("SingletonOut");
  const c = new Container();
  c.bind(ReqOnly).toSelf().inRequestScope();
  c.bind(SingletonOut).toFactoryWithDeps({ r: ReqOnly }, ({ r }) => ({ r }));
  // SingletonOut defaults to singleton scope (Binding default)

  const app = new Zebra({ container: c });
  app.get("/x", { s: SingletonOut }, async () => "ok");
  await expect(app.listen({ port: 0 })).rejects.toThrow(ScopeMismatchError);
});

test("listen: lazy-form factory (no factoryDeps) still NOT validated at boot — regression guard", async () => {
  const Missing = token<string>("Missing");
  const Out = token<string>("Out");
  const c = new Container();
  // Lazy form — even though it'd fail at resolve time, boot validation must not walk into it
  c.bind(Out).toFactory((ctr) => ctr.resolve(Missing));

  const app = new Zebra({ container: c });
  app.get("/x", { out: Out }, async () => "ok");
  // Must NOT throw at listen time — only at first request
  const result = await app.listen({ port: 0 });
  expect(result.port).toBeGreaterThan(0);
  await app.stop();
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `bun test packages/core/test/app/inject-boot-validation.test.ts`
Expected: First three FAIL (app.listen resolves OK — validation skipped factory). Last one PASS.

- [ ] **Step 3: Extend `walk()` in `boot-validation.ts`**

Edit `packages/core/src/app/boot-validation.ts`. Replace lines 64-70 (the `if (binding.kind === "class")` block at the end of `walk`) with:

```ts
  if (binding.kind === "class") {
    const cls = binding.target as Function;
    const childDeps = getConstructorDeps(cls);
    for (const d of childDeps) {
      walk(container, d, [...stack, name], visited, binding.scope);
    }
  } else if (binding.kind === "factory" && binding.factoryDeps) {
    for (const d of Object.values(binding.factoryDeps)) {
      walk(container, d, [...stack, name], visited, binding.scope);
    }
  }
  // factory without factoryDeps, or value: no further deps to walk
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `bun test packages/core/test/app/inject-boot-validation.test.ts`
Expected: PASS (4/4).

- [ ] **Step 5: Run all boot-validation tests to ensure no regression**

Run: `bun test packages/core/test/app/boot-validation.test.ts packages/core/test/app/inject-boot-validation.test.ts`
Expected: PASS (7 total — 3 existing + 4 new).

- [ ] **Step 6: Commit**

```bash
git add packages/core/src/app/boot-validation.ts packages/core/test/app/inject-boot-validation.test.ts
git commit -m "$(cat <<'EOF'
feat(app): walk factoryDeps in boot validation

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Phase 3: Optional container + freeze guard

### Task 4: Make `ZebraOptions.container` optional with default-constructed `Container`

**Files:**
- Create: `packages/core/test/app/zebra-default-container.test.ts`
- Modify: `packages/core/src/app/types.ts:10-14`
- Modify: `packages/core/src/app/app.ts:37-41`

- [ ] **Step 1: Write the failing test**

Create `packages/core/test/app/zebra-default-container.test.ts`:

```ts
import "reflect-metadata";
import { expect, test } from "bun:test";
import { Zebra } from "../../src/app/app.ts";

test("new Zebra() with no opts boots and serves a route with no deps", async () => {
  const app = new Zebra();
  app.get("/ping", async () => "pong");
  const { port } = await app.listen({ port: 0 });
  const res = await fetch(`http://localhost:${port}/ping`);
  expect(await res.text()).toBe('"pong"');
  await app.stop();
});

test("new Zebra({}) works the same as new Zebra()", async () => {
  const app = new Zebra({});
  app.get("/ping", async () => "pong");
  const { port } = await app.listen({ port: 0 });
  const res = await fetch(`http://localhost:${port}/ping`);
  expect(await res.text()).toBe('"pong"');
  await app.stop();
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `bun test packages/core/test/app/zebra-default-container.test.ts`
Expected: FAIL — TypeScript error or runtime "Cannot read property 'container' of undefined".

- [ ] **Step 3: Make `container` optional in `ZebraOptions`**

Edit `packages/core/src/app/types.ts`. Replace lines 10-14 with:

```ts
export interface ZebraOptions {
  container?: Container;
  body?: Partial<BodyOptions>;
  errors?: { exposeStack?: boolean };
}
```

- [ ] **Step 4: Default-construct `Container` in `Zebra` constructor**

Edit `packages/core/src/app/app.ts`. Replace lines 37-41 with:

```ts
  constructor(opts: ZebraOptions = {}) {
    this.container = opts.container ?? new Container();
    this.bodyOpts = { ...DEFAULT_BODY, ...(opts.body ?? {}) };
    this.exposeStack = opts.errors?.exposeStack ?? false;
  }
```

- [ ] **Step 5: Run new tests to verify they pass**

Run: `bun test packages/core/test/app/zebra-default-container.test.ts`
Expected: PASS (2/2).

- [ ] **Step 6: Run full test suite to ensure no regression**

Run: `bun test`
Expected: All pre-existing tests still PASS.

- [ ] **Step 7: Commit**

```bash
git add packages/core/src/app/types.ts packages/core/src/app/app.ts packages/core/test/app/zebra-default-container.test.ts
git commit -m "$(cat <<'EOF'
feat(app): make ZebraOptions.container optional, default-construct Container

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Phase 4: `inject*` methods on `Zebra`

### Task 5: Add `injectValue` + freeze guard

**Files:**
- Create: `packages/core/test/app/inject-methods.test.ts`
- Modify: `packages/core/src/app/app.ts`

- [ ] **Step 1: Write the failing tests**

Create `packages/core/test/app/inject-methods.test.ts`:

```ts
import "reflect-metadata";
import { expect, test } from "bun:test";
import { Zebra } from "../../src/app/app.ts";
import { token } from "../../src/di/token.ts";

test("injectValue: bound value resolves via route deps", async () => {
  const Config = token<{ env: string }>("Config");
  const app = new Zebra();
  app.injectValue(Config, { env: "prod" });
  app.get("/env", { cfg: Config }, async (_req, { cfg }) => (cfg as any).env);
  const { port } = await app.listen({ port: 0 });
  const res = await fetch(`http://localhost:${port}/env`);
  expect(await res.text()).toBe('"prod"');
  await app.stop();
});

test("injectValue after listen() throws", async () => {
  const Config = token<{ env: string }>("Config");
  const app = new Zebra();
  app.get("/", async () => "ok");
  await app.listen({ port: 0 });
  expect(() => app.injectValue(Config, { env: "x" })).toThrow(
    /Cannot register bindings after app.listen/,
  );
  await app.stop();
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `bun test packages/core/test/app/inject-methods.test.ts`
Expected: FAIL — `injectValue is not a function`.

- [ ] **Step 3: Add `injectValue` + `assertNotFrozen` helper to `Zebra`**

Edit `packages/core/src/app/app.ts`. Add the following imports near the top (or extend the existing imports — `Identifier` from token, keep `ScopeKind` already imported):

```ts
import type { Identifier } from "../di/token.ts";
```

Then add to the `Zebra` class, right after the `stop()` method (around line 78), insert:

```ts
  injectValue<T>(id: Identifier<T>, value: T): void {
    this.assertNotFrozen();
    this.container.bind(id).toValue(value);
  }

  protected assertNotFrozen(): void {
    if (this.frozen) {
      throw new Error("Cannot register bindings after app.listen()");
    }
  }
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `bun test packages/core/test/app/inject-methods.test.ts`
Expected: PASS (2/2).

- [ ] **Step 5: Commit**

```bash
git add packages/core/src/app/app.ts packages/core/test/app/inject-methods.test.ts
git commit -m "$(cat <<'EOF'
feat(app): Zebra.injectValue + post-listen freeze guard

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

### Task 6: Add 4 class-scope `inject*` methods

**Files:**
- Modify: `packages/core/test/app/inject-methods.test.ts`
- Modify: `packages/core/src/app/app.ts`

- [ ] **Step 1: Append failing tests**

Append to `packages/core/test/app/inject-methods.test.ts`:

```ts
import { injectable } from "../../src/di/decorators.ts";

@injectable() class Greeter {
  hello() { return "hi"; }
}

abstract class IGreeter {
  abstract hello(): string;
}
@injectable() class LoudGreeter extends IGreeter {
  hello() { return "HI"; }
}

test("injectSingleton(X): toSelf, same instance across resolves", async () => {
  const app = new Zebra();
  app.injectSingleton(Greeter);
  app.get("/", { g: Greeter }, async (_req, { g }) => (g as Greeter).hello());
  const { port } = await app.listen({ port: 0 });
  const r1 = await (await fetch(`http://localhost:${port}/`)).text();
  expect(r1).toBe('"hi"');
  await app.stop();
});

test("injectSingleton(IFace, Impl): maps interface to implementation", async () => {
  const app = new Zebra();
  app.injectSingleton(IGreeter, LoudGreeter);
  app.get("/", { g: IGreeter }, async (_req, { g }) => (g as IGreeter).hello());
  const { port } = await app.listen({ port: 0 });
  const r1 = await (await fetch(`http://localhost:${port}/`)).text();
  expect(r1).toBe('"HI"');
  await app.stop();
});

@injectable() class ReqState {
  static idCounter = 0;
  id = ++ReqState.idCounter;
}

test("injectRequest(X): one instance per request scope", async () => {
  ReqState.idCounter = 0;
  const app = new Zebra();
  app.injectRequest(ReqState);
  app.get("/r", { s: ReqState }, async (_req, { s }) => (s as ReqState).id);
  const { port } = await app.listen({ port: 0 });
  const a = await (await fetch(`http://localhost:${port}/r`)).text();
  const b = await (await fetch(`http://localhost:${port}/r`)).text();
  expect(a).not.toBe(b);
  await app.stop();
});

@injectable() class Tick {
  static n = 0;
  v = ++Tick.n;
}

test("injectTransient(X): new instance every resolve", async () => {
  Tick.n = 0;
  const app = new Zebra();
  app.injectTransient(Tick);
  app.get("/t", { t: Tick }, async (_req, { t }) => (t as Tick).v);
  const { port } = await app.listen({ port: 0 });
  const a = await (await fetch(`http://localhost:${port}/t`)).text();
  const b = await (await fetch(`http://localhost:${port}/t`)).text();
  expect(a).not.toBe(b);
  await app.stop();
});

@injectable() class SessionItem {}

test("injectSession(X): registers without error (resolution requires session child scope, exercised elsewhere)", () => {
  const app = new Zebra();
  expect(() => app.injectSession(SessionItem)).not.toThrow();
});

test("class inject methods after listen() throw", async () => {
  const app = new Zebra();
  app.get("/", async () => "ok");
  await app.listen({ port: 0 });
  expect(() => app.injectSingleton(Greeter)).toThrow(/after app.listen/);
  expect(() => app.injectRequest(ReqState)).toThrow(/after app.listen/);
  expect(() => app.injectTransient(Tick)).toThrow(/after app.listen/);
  expect(() => app.injectSession(SessionItem)).toThrow(/after app.listen/);
  await app.stop();
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `bun test packages/core/test/app/inject-methods.test.ts`
Expected: FAIL — `injectSingleton is not a function` (and the other three).

- [ ] **Step 3: Add the four class-scope methods + helpers**

Edit `packages/core/src/app/app.ts`. Add these imports near the top (extend existing):

```ts
import type { BindingBuilder } from "../di/binding.ts";
import type { ClassConstructor } from "../di/token.ts";
```

Then add to the `Zebra` class, immediately after `injectValue` (defined in Task 5):

```ts
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

  private bindClass<T>(
    id: Identifier<T>,
    impl: ClassConstructor<T> | undefined,
    scope: ScopeKind,
  ): void {
    this.assertNotFrozen();
    const b = this.container.bind(id);
    if (impl) b.to(impl);
    else b.toSelf();
    Zebra.applyScope(b, scope);
  }

  private static applyScope(b: BindingBuilder<unknown>, scope: ScopeKind): void {
    switch (scope) {
      case ScopeKind.Singleton: b.inSingletonScope(); break;
      case ScopeKind.Request:   b.inRequestScope();   break;
      case ScopeKind.Transient: b.inTransientScope(); break;
      case ScopeKind.Session:   b.inSessionScope();   break;
    }
  }
```

Note: `b.toSelf()` is used in the no-impl branch. If a user calls `injectSingleton(someToken)` with no `impl`, `toSelf` sets target = the Token itself, and the natural error surfaces at resolve time (`new <token>(...)` throws). We don't add special-case validation for this — the framework's general "user error → natural error at resolve" pattern applies.

- [ ] **Step 4: Run tests to verify they pass**

Run: `bun test packages/core/test/app/inject-methods.test.ts`
Expected: PASS (all tests from Task 5 + Task 6 — 8 total).

- [ ] **Step 5: Run full test suite to ensure no regression**

Run: `bun test`
Expected: All pre-existing tests still PASS.

- [ ] **Step 6: Commit**

```bash
git add packages/core/src/app/app.ts packages/core/test/app/inject-methods.test.ts
git commit -m "$(cat <<'EOF'
feat(app): add Zebra.injectSingleton/Request/Transient/Session class-binding sugar

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

### Task 7: Add 4 factory-scope `injectFactory*` methods (lazy + declared overloads)

**Files:**
- Modify: `packages/core/test/app/inject-methods.test.ts`
- Modify: `packages/core/src/app/app.ts`

- [ ] **Step 1: Append failing tests**

Append to `packages/core/test/app/inject-methods.test.ts`:

```ts
import { Container } from "../../src/di/container.ts";

test("injectFactorySingleton lazy form: factory receives Container", async () => {
  const Marker = token<{ ok: true }>("Marker");
  const app = new Zebra();
  let receivedContainer = false;
  app.injectFactorySingleton(Marker, (c) => {
    receivedContainer = c instanceof Container;
    return { ok: true };
  });
  app.get("/m", { m: Marker }, async (_req, { m }) => (m as any).ok);
  const { port } = await app.listen({ port: 0 });
  await fetch(`http://localhost:${port}/m`);
  expect(receivedContainer).toBe(true);
  await app.stop();
});

test("injectFactorySingleton declared form: factory receives resolved deps object", async () => {
  const Cfg = token<{ url: string }>("Cfg");
  const Db = token<{ url: string }>("Db");
  const app = new Zebra();
  app.injectValue(Cfg, { url: "postgres://x" });
  app.injectFactorySingleton(Db, { cfg: Cfg }, ({ cfg }) => ({
    url: (cfg as any).url,
  }));
  app.get("/db", { db: Db }, async (_req, { db }) => (db as any).url);
  const { port } = await app.listen({ port: 0 });
  const res = await fetch(`http://localhost:${port}/db`);
  expect(await res.text()).toBe('"postgres://x"');
  await app.stop();
});

test("injectFactoryRequest declared form: new instance per request", async () => {
  const ReqId = token<number>("ReqId");
  const app = new Zebra();
  let counter = 0;
  app.injectFactoryRequest(ReqId, {}, () => ++counter);
  app.get("/id", { id: ReqId }, async (_req, { id }) => id as number);
  const { port } = await app.listen({ port: 0 });
  const a = await (await fetch(`http://localhost:${port}/id`)).text();
  const b = await (await fetch(`http://localhost:${port}/id`)).text();
  expect(a).not.toBe(b);
  await app.stop();
});

test("injectFactoryTransient lazy form: new value every resolve", async () => {
  const Stamp = token<number>("Stamp");
  const app = new Zebra();
  let n = 0;
  app.injectFactoryTransient(Stamp, () => ++n);
  app.get("/s", { s: Stamp }, async (_req, { s }) => s as number);
  const { port } = await app.listen({ port: 0 });
  const a = await (await fetch(`http://localhost:${port}/s`)).text();
  const b = await (await fetch(`http://localhost:${port}/s`)).text();
  expect(a).not.toBe(b);
  await app.stop();
});

test("injectFactorySession declared form: registers without error", () => {
  const SVal = token<unknown>("SVal");
  const app = new Zebra();
  expect(() => app.injectFactorySession(SVal, {}, () => ({}))).not.toThrow();
});

test("factory inject methods after listen() throw", async () => {
  const T1 = token<unknown>("T1");
  const T2 = token<unknown>("T2");
  const app = new Zebra();
  app.get("/", async () => "ok");
  await app.listen({ port: 0 });
  expect(() => app.injectFactorySingleton(T1, () => ({}))).toThrow(/after app.listen/);
  expect(() => app.injectFactoryRequest(T2, {}, () => ({}))).toThrow(/after app.listen/);
  await app.stop();
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `bun test packages/core/test/app/inject-methods.test.ts`
Expected: FAIL — `injectFactorySingleton is not a function` (etc).

- [ ] **Step 3: Add the four factory methods + helper**

Edit `packages/core/src/app/app.ts`. Inside the `Zebra` class, immediately after the four class-binding methods (added in Task 6), insert:

```ts
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

  private bindFactory(
    id: Identifier<any>,
    a: ((c: Container) => any) | Record<string, Identifier<unknown>>,
    b: ((deps: Record<string, unknown>) => any) | undefined,
    scope: ScopeKind,
  ): void {
    this.assertNotFrozen();
    const builder = this.container.bind(id);
    if (b === undefined) {
      // Lazy form: a is the factory fn
      builder.toFactory(a as (c: Container) => any);
    } else {
      // Declared form: a is deps spec, b is the fn taking resolved deps
      builder.toFactoryWithDeps(a as Record<string, Identifier<unknown>>, b);
    }
    Zebra.applyScope(builder, scope);
  }
```

Note: also add `Container` to the existing imports at the top of `app.ts` if it isn't already there (it should be — it's already imported via `../di/container.ts`).

- [ ] **Step 4: Run tests to verify they pass**

Run: `bun test packages/core/test/app/inject-methods.test.ts`
Expected: PASS (all Phase-4 tests — should be ~14 total in this file).

- [ ] **Step 5: Run full test suite to ensure no regression**

Run: `bun test`
Expected: All pre-existing tests still PASS.

- [ ] **Step 6: Typecheck the whole repo**

Run: `bun run typecheck`
Expected: PASS (no TS errors). If overload resolution complains anywhere, check the order — TS picks the first matching overload, and the lazy form must come before the declared form.

- [ ] **Step 7: Commit**

```bash
git add packages/core/src/app/app.ts packages/core/test/app/inject-methods.test.ts
git commit -m "$(cat <<'EOF'
feat(app): add Zebra.injectFactory* — lazy + declared overloads

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Phase 5: Examples, README, llms.txt

### Task 8: Rewrite `examples/hello`

**Files:**
- Modify: `examples/hello/src/main.ts`

- [ ] **Step 1: Replace the file contents**

Replace `examples/hello/src/main.ts` entirely with:

```ts
import "reflect-metadata";
import { Zebra } from "zebra";

const z = new Zebra();

z.get("/hello/:name", async (req) => `hello, ${req.params.name}`);

await z.listen({ port: 3000 });
console.log("hello example listening on http://localhost:3000");
```

- [ ] **Step 2: Run the example to verify**

Run: `bun --filter example-hello start` in one terminal, then in another:
```bash
curl http://localhost:3000/hello/world
```
Expected: `"hello, world"` (JSON-encoded string). Stop the server with Ctrl+C.

- [ ] **Step 3: Commit**

```bash
git add examples/hello/src/main.ts
git commit -m "$(cat <<'EOF'
docs(example): hello uses new Zebra() implicit container

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

### Task 9: Rewrite `examples/blog`

**Files:**
- Modify: `examples/blog/src/main.ts`

- [ ] **Step 1: Replace the file contents**

Replace `examples/blog/src/main.ts` entirely with:

```ts
import "reflect-metadata";
import { HttpError, Zebra } from "zebra";
import { BlogRepo, BlogService } from "./services.ts";

const z = new Zebra();
z.injectSingleton(BlogRepo);
z.injectSingleton(BlogService);

z.group("/blogs", (g) => {
  g.get("/", { blog: BlogService }, async (_req, { blog }) => blog.list());

  g.get("/:id", { blog: BlogService }, async (req, { blog }) => {
    const id = Number(req.params.id);
    const found = await blog.find(id);
    if (!found) throw new HttpError(404, "blog_not_found", `blog ${id} not found`);
    return found;
  });

  g.post("/", { blog: BlogService }, async (req, { blog }) => {
    const body = (await req.body()) as { title: string; content: string };
    return blog.create(body.title, body.content);
  });

  g.delete("/:id", { blog: BlogService }, async (req, { blog }) => {
    const ok = await blog.remove(Number(req.params.id));
    if (!ok) throw new HttpError(404, "blog_not_found", "no such blog");
    return { deleted: true };
  });
});

await z.listen({ port: 3001 });
console.log("blog example on http://localhost:3001");
```

- [ ] **Step 2: Run the example to verify**

Run: `bun --filter example-blog start` in one terminal, then in another:
```bash
curl -s http://localhost:3001/blogs/
curl -s -X POST http://localhost:3001/blogs/ -H 'content-type: application/json' -d '{"title":"t","content":"c"}'
```
Expected: First returns `[]` (or whatever the default state is). Second returns the created blog as JSON. Stop the server with Ctrl+C.

- [ ] **Step 3: Commit**

```bash
git add examples/blog/src/main.ts
git commit -m "$(cat <<'EOF'
docs(example): blog uses z.injectSingleton instead of explicit Container

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

### Task 10: Update README quick-start + add "Advanced: bring your own Container" subsection

**Files:**
- Modify: `README.md`

- [ ] **Step 1: Replace the quick-start snippet (lines 33-50)**

In `README.md`, replace lines 33-50 (the "## Quick start" section through the bottom of its code block + curl block) with:

```markdown
## Quick start

```ts
import "reflect-metadata";
import { Zebra } from "zebra";

const z = new Zebra();

z.get("/hello/:name", async (req) => `hello, ${req.params.name}`);

await z.listen({ port: 3000 });
```

```sh
bun run src/main.ts
curl http://localhost:3000/hello/world
# hello, world
```

With dependencies, register them on the `Zebra` instance and pull them into routes by name:

```ts
import "reflect-metadata";
import { Zebra, injectable } from "zebra";

@injectable() class Greeter { greet(n: string) { return `hi, ${n}`; } }

const z = new Zebra();
z.injectSingleton(Greeter);

z.get("/hi/:name", { g: Greeter }, async (req, { g }) => g.greet(req.params.name));

await z.listen({ port: 3000 });
```

### Advanced: bring your own Container

For tests that mock specific bindings or apps that share a container, construct one explicitly:

```ts
import { Container, Zebra } from "zebra";

const container = new Container();
container.bind(IRepo).to(MockRepo);
const z = new Zebra({ container });
```

`z.inject*` methods write to whichever container the `Zebra` instance owns.
```

(Inserting the new code block + the Advanced subsection between the existing Quick start and the Features section.)

- [ ] **Step 2: Verify README renders sensibly**

Run: `cat README.md | head -90`
Expected: Quick start now shows `new Zebra()` and `injectSingleton`; Advanced subsection appears before Features.

- [ ] **Step 3: Commit**

```bash
git add README.md
git commit -m "$(cat <<'EOF'
docs(readme): quick-start uses implicit container + inject* sugar

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

### Task 11: Update `llms.txt` DI bullet

**Files:**
- Modify: `llms.txt`

- [ ] **Step 1: Update the DI principle bullet**

In `llms.txt`, locate the bullet that begins "- DI is mandatory, not bolted on." (in the Core principles list). Replace that bullet with:

```markdown
- DI is mandatory, not bolted on. Routes and middleware declare their dependencies via a named-object spec (`{ svc: Service }`); the container resolves them and validates the full graph (circular deps, scope violations) at boot. The `Zebra` instance exposes `injectSingleton` / `injectRequest` / `injectTransient` / `injectSession` (class bindings), `injectFactorySingleton`/`injectFactoryRequest`/… (factory bindings, with optional declared-deps form for boot validation), and `injectValue` (value bindings) — so most apps never construct a `Container` directly.
```

- [ ] **Step 2: Commit**

```bash
git add llms.txt
git commit -m "$(cat <<'EOF'
docs(llms): mention Zebra.inject* sugar in DI bullet

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

### Task 12: Cross-link the v2 design spec to the implicit-DI spec

**Files:**
- Modify: `docs/superpowers/specs/2026-05-16-zebra-v2-design.md`

- [ ] **Step 1: Append a cross-link section**

Append to `docs/superpowers/specs/2026-05-16-zebra-v2-design.md`:

```markdown

---

## Addendum (2026-05-17): Implicit DI sugar

The DI section of this spec describes the `Container` API in full. After v0.1 shipped, a follow-up spec ([2026-05-17-zebra-implicit-di-design.md](2026-05-17-zebra-implicit-di-design.md)) added `inject*` methods directly on the `Zebra` class and made `ZebraOptions.container` optional. The underlying `Container` API is unchanged; the new methods are sugar that delegate to it. New apps should prefer the sugar; the explicit `Container` path remains for advanced cases (test mocks, shared containers, snapshot/restore).
```

- [ ] **Step 2: Commit**

```bash
git add docs/superpowers/specs/2026-05-16-zebra-v2-design.md
git commit -m "$(cat <<'EOF'
docs(spec): cross-link v2 design to implicit-DI addendum

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Phase 6: Final verification

### Task 13: Full test + typecheck + lint sweep

**Files:** none (verification only)

- [ ] **Step 1: Run the full test suite**

Run: `bun test`
Expected: All tests pass. Counts should be: existing test count + (5 factory-deps tests + 4 inject-boot-validation tests + 2 zebra-default-container tests + ~14 inject-methods tests) = baseline + ~25 new tests.

- [ ] **Step 2: Run typecheck across the monorepo**

Run: `bun run typecheck`
Expected: PASS in every package.

- [ ] **Step 3: Run lint**

Run: `bun run lint`
Expected: PASS.

- [ ] **Step 4: Manually run both examples once**

In separate terminals:
```bash
bun --filter example-hello start
# in another terminal:
curl http://localhost:3000/hello/world
```
Expected: `"hello, world"`. Stop the server.

```bash
bun --filter example-blog start
# in another terminal:
curl -s http://localhost:3001/blogs/
```
Expected: returns a JSON array. Stop the server.

- [ ] **Step 5: No commit needed for verification-only step**

If all checks pass, the implementation is complete. The series of commits from Tasks 1-12 is the deliverable.

---

## Notes for the implementing engineer

- **TDD discipline:** every task writes the failing test first, runs it to *see* it fail, then implements. Don't skip the "see it fail" step — a test that doesn't fail when expected is a useless test.
- **No `git add .`:** every commit step lists exact paths. Don't add files that aren't in the list (you may have accidental files from your environment).
- **Don't touch `Container`'s public surface** beyond what Task 1 specifies (the new `toFactoryWithDeps` method on `BindingBuilder` and the optional `factoryDeps` field on `Binding`). The escape-hatch contract is that existing user code calling `container.bind(...).toFactory(fn)` continues to behave identically.
- **`bindClass` and `injectSession` with an abstract identifier and no `impl`:** the spec doesn't require this combination to work (an abstract class can't be instantiated). The runtime will throw the natural error at resolve time. Don't add special-case handling.
- **TypeScript overload order matters** in Task 7. The lazy overload (`(id, fn)`) must come before the declared overload (`(id, deps, fn)`). If you swap them, the lazy form silently treats `fn` as `deps` and fails opaquely.
