import { expect, test } from "bun:test";
import { Container } from "../../src/di/container.ts";
import { CircularDependencyError, UnboundTokenError } from "../../src/di/errors.ts";
import { ScopeKind } from "../../src/di/scope.ts";
import { token } from "../../src/di/token.ts";

const cachedScopes = [ScopeKind.Singleton, ScopeKind.Request, ScopeKind.Session];

test.each(cachedScopes)(
  "%s factories cache every result, including undefined and promises",
  (scope) => {
    const root = new Container();
    const owner = scope === ScopeKind.Singleton ? root : root.createChildScope(scope);
    const child = owner.createChildScope(ScopeKind.Transient);
    for (const value of [undefined, null, false, 0, { ok: true }, Promise.resolve("ok")]) {
      const id = token<unknown>("cached");
      let calls = 0;
      root.bind(id).toFactory(() => {
        calls++;
        return value;
      });
      root.findBinding(id)!.scope = scope;
      expect(child.resolve(id)).toBe(value);
      expect(owner.resolve(id)).toBe(value);
      expect(child.resolve(id)).toBe(value);
      expect(calls).toBe(1);
    }
  },
);

test.each(cachedScopes)(
  "%s classes and declared factories retain construction frequency",
  (scope) => {
    let constructions = 0;
    let factories = 0;
    class Service {
      readonly sequence = ++constructions;
    }
    const id = token<Service>("factory");
    const root = new Container();
    root.bind(Service).toSelf();
    root.bind(id).toFactoryWithDeps({ service: Service }, ({ service }) => {
      factories++;
      return service as Service;
    });
    root.findBinding(Service)!.scope = scope;
    root.findBinding(id)!.scope = scope;
    const owner = scope === ScopeKind.Singleton ? root : root.createChildScope(scope);
    const child = owner.createChildScope(ScopeKind.Transient);
    const instance = child.resolve(id);
    expect(owner.resolve(Service)).toBe(instance);
    expect(child.resolve(id)).toBe(instance);
    expect(constructions).toBe(1);
    expect(factories).toBe(1);
  },
);

test.each([ScopeKind.Request, ScopeKind.Session])(
  "%s uses the nearest scope without leaking data",
  (scope) => {
    const root = new Container();
    const data = token<string>("data");
    const id = token<{ data: string }>("scoped");
    root.bind(id).toFactory((container: Container) => ({ data: container.resolve(data) }));
    root.findBinding(id)!.scope = scope;
    const first = root.createChildScope(scope);
    const nested = first.createChildScope(scope);
    const sibling = root.createChildScope(scope);
    const instances = [first, nested, sibling].map((owner, index) => {
      owner.bind(data).toValue(String(index));
      const child = owner.createChildScope(ScopeKind.Transient);
      const instance = child.resolve(id);
      expect(instance.data).toBe(String(index));
      expect(owner.resolve(id)).toBe(instance);
      expect(child.resolve(id)).toBe(instance);
      return instance;
    });
    expect(new Set(instances).size).toBe(3);
  },
);

test("singleton factories use the root even when first resolved through a request", () => {
  const root = new Container();
  const request = root.createChildScope(ScopeKind.Request);
  const data = token<string>("data");
  const id = token<{ data: string }>("singleton");
  root.bind(data).toValue("root");
  request.bind(data).toValue("request");
  root.bind(id).toFactory((container: Container) => {
    expect(container).toBe(root);
    return { data: container.resolve(data) };
  });
  const instance = request.resolve(id);
  expect(instance.data).toBe("root");
  expect(root.resolve(id)).toBe(instance);
  expect(root.createChildScope(ScopeKind.Request).resolve(id)).toBe(instance);
});

test.each([ScopeKind.Transient, ScopeKind.Request, ScopeKind.Session])(
  "%s without a matching cache owner constructs on every resolution",
  (scope) => {
    const root = new Container();
    let calls = 0;
    class Service {
      readonly sequence = ++calls;
    }
    root.bind(Service).toSelf();
    root.findBinding(Service)!.scope = scope;
    expect(root.resolve(Service).sequence).toBe(1);
    expect(root.resolve(Service).sequence).toBe(2);
    expect(calls).toBe(2);
  },
);

test("rebind and snapshot restore both the current binding and cached instance", () => {
  const container = new Container();
  const id = token<object>("service");
  let originalCalls = 0;
  let replacementCalls = 0;
  container.bind(id).toFactory(() => ({ original: ++originalCalls }));
  const original = container.resolve(id);
  container.snapshot();
  container.rebind(id).toFactory(() => ({ replacement: ++replacementCalls }));
  const replacement = container.resolve(id);
  expect(replacement).not.toBe(original);
  expect(container.resolve(id)).toBe(replacement);
  container.restore();
  expect(container.resolve(id)).toBe(original);
  expect([originalCalls, replacementCalls]).toEqual([1, 1]);
});

test("local binding kind and scope take precedence over an existing root cache", () => {
  const root = new Container();
  const id = token<object>("service");
  root.bind(id).toFactory(() => ({ source: "root" }));
  const original = root.resolve(id);
  const request = root.createChildScope(ScopeKind.Request);
  request.snapshot();
  const local = { source: "local" };
  request.bind(id).toValue(local);
  expect(request.resolve(id)).toBe(local);
  request
    .rebind(id)
    .toFactory(() => ({ source: "request" }))
    .inRequestScope();
  const scoped = request.resolve(id);
  expect(scoped).not.toBe(original);
  expect(request.resolve(id)).toBe(scoped);
  expect(root.resolve(id)).toBe(original);
  request.restore();
  expect(request.resolve(id)).toBe(original);
});

test("a saved mutable builder changes the selected cache owner and value fast path", () => {
  const container = new Container();
  const id = token<object>("service");
  const builder = container.bind(id).toFactory(() => ({}));
  const original = container.resolve(id);
  builder.inTransientScope();
  expect(container.resolve(id)).not.toBe(original);
  expect(container.resolve(id)).not.toBe(container.resolve(id));
  builder.inRequestScope();
  const request = container.createChildScope(ScopeKind.Request);
  const scoped = request.resolve(id);
  expect(scoped).not.toBe(original);
  expect(request.resolve(id)).toBe(scoped);
  builder.inSingletonScope();
  expect(request.resolve(id)).toBe(original);
  const value = {};
  builder.toValue(value);
  expect(container.resolve(id)).toBe(value);
  expect(request.resolve(id)).toBe(value);
});

test.each(cachedScopes)(
  "%s snapshot cache hits do not hide active lazy-factory cycles",
  (scope) => {
    const root = new Container();
    const owner = scope === ScopeKind.Singleton ? root : root.createChildScope(scope);
    const outer = token<object>("outer");
    const inner = token<object>("inner");
    owner.bind(outer).toFactory(() => ({}));
    owner.findBinding(outer)!.scope = scope;
    const cached = owner.resolve(outer);
    owner.bind(inner).toFactory((container: Container) => {
      container.restore();
      return container.resolve(outer);
    });
    owner.findBinding(inner)!.scope = scope;
    owner.snapshot();
    owner.rebind(outer).toFactory((container: Container) => container.resolve(inner));
    owner.findBinding(outer)!.scope = scope;
    expect(() => owner.resolve(outer)).toThrow(CircularDependencyError);
    // The restored cache becomes usable after both throwing factories unwind.
    expect(owner.resolve(outer)).toBe(cached);
  },
);

test("restoring a cached active frame preserves the exact cycle path", () => {
  const container = new Container();
  const entry = token<object>("entry");
  const outer = token<object>("outer");
  const inner = token<object>("inner");
  container.bind(outer).toFactory(() => ({}));
  container.resolve(outer);
  container.bind(entry).toFactory((current: Container) => current.resolve(outer));
  container.bind(inner).toFactory((current: Container) => {
    current.restore();
    return current.resolve(outer);
  });
  container.snapshot();
  container.rebind(outer).toFactory((current: Container) => current.resolve(inner));
  let failure: unknown;
  try {
    container.resolve(entry);
  } catch (error) {
    failure = error;
  }
  expect(failure).toBeInstanceOf(CircularDependencyError);
  expect((failure as CircularDependencyError).path).toEqual(["outer", "inner", "outer"]);
});

test("changing an active transient factory back to singleton does not hide its cycle", () => {
  const container = new Container();
  const id = token<object>("service");
  const builder = container.bind(id).toFactory(() => ({}));
  const cached = container.resolve(id);
  builder.inTransientScope().toFactory((current: Container) => {
    builder.inSingletonScope();
    return current.resolve(id);
  });
  expect(() => container.resolve(id)).toThrow(CircularDependencyError);
  expect(container.resolve(id)).toBe(cached);
});

test("cold declared factories retain cycle and unbound dependency paths", () => {
  const container = new Container();
  const outer = token<object>("outer");
  const inner = token<object>("inner");
  const missing = token<object>("missing");
  container.bind(outer).toFactoryWithDeps({ inner }, () => ({}));
  container.bind(inner).toFactoryWithDeps({ outer }, () => ({}));
  try {
    container.resolve(outer);
    throw new Error("expected cycle");
  } catch (error) {
    expect(error).toBeInstanceOf(CircularDependencyError);
    expect((error as CircularDependencyError).path).toEqual(["outer", "inner", "outer"]);
  }
  container.rebind(inner).toFactoryWithDeps({ missing }, () => ({}));
  try {
    container.resolve(outer);
    throw new Error("expected missing dependency");
  } catch (error) {
    expect(error).toBeInstanceOf(UnboundTokenError);
    expect((error as UnboundTokenError).path).toEqual(["outer", "inner", "missing"]);
  }
});

test("a value rebind within an active factory remains terminal", () => {
  const container = new Container();
  const id = token<object>("service");
  const value = {};
  container.bind(id).toFactory((current: Container) => {
    current.rebind(id).toValue(value);
    return current.resolve(id);
  });
  expect(container.resolve(id)).toBe(value);
  expect(container.resolve(id)).toBe(value);
});

test("nested factory success and caught failure restore the enclosing diagnostic stack", () => {
  const container = new Container();
  const outer = token<object>("outer");
  const success = token<object>("success");
  const failure = token<object>("failure");
  const missing = token<object>("missing");
  container.bind(success).toFactory(() => ({}));
  container.bind(failure).toFactory((current: Container) => current.resolve(missing));
  container.bind(outer).toFactory((current: Container) => {
    current.resolve(success);
    expect(() => current.resolve(outer)).toThrow(CircularDependencyError);
    try {
      current.resolve(failure);
      throw new Error("expected missing dependency");
    } catch (error) {
      expect(error).toBeInstanceOf(UnboundTokenError);
      expect((error as UnboundTokenError).path).toEqual(["outer", "failure", "missing"]);
    }
    expect(() => current.resolve(outer)).toThrow(CircularDependencyError);
    return {};
  });
  const instance = container.resolve(outer);
  expect(container.resolve(outer)).toBe(instance);
  container.bind(missing).toValue({});
  expect(container.resolve(failure)).toBe(container.resolve(missing));
});

test("distinct same-name tokens remain distinct when a cached factory is a dependency", () => {
  const container = new Container();
  const left = token<object>("duplicate");
  const right = token<object>("duplicate");
  container.bind(right).toFactory(() => ({}));
  const cached = container.resolve(right);
  container.bind(left).toFactory((current: Container) => ({ right: current.resolve(right) }));
  const instance = container.resolve(left);
  expect(instance).toEqual({ right: cached });
  expect(instance).not.toBe(cached);
  expect(container.resolve(left)).toBe(instance);
});

test("concurrent disposal preserves cached aliases and newly resolved resources", async () => {
  const container = new Container();
  const dependency = token<{ dispose(): void }>("dependency");
  const dependent = token<{ dispose(): Promise<void> }>("dependent");
  const alias = token<{ dispose(): void }>("alias");
  const added = token<{ dispose(): void }>("added");
  const entered = Promise.withResolvers<void>();
  const release = Promise.withResolvers<void>();
  const order: string[] = [];
  container.bind(dependency).toFactory(() => ({ dispose: () => void order.push("dependency") }));
  const cached = container.resolve(dependency);
  container.bind(alias).toFactory(() => cached);
  container.resolve(alias);
  container.bind(dependent).toFactory(() => ({
    async dispose() {
      expect(container.resolve(dependency)).toBe(cached);
      expect(container.resolve(alias)).toBe(cached);
      order.push("dependent");
      entered.resolve();
      await release.promise;
      expect(container.resolve(dependency)).toBe(cached);
    },
  }));
  container.resolve(dependent);
  container.bind(added).toFactory(() => ({ dispose: () => void order.push("added") }));
  const disposing = Promise.all([container.dispose(), container.dispose()]);
  await entered.promise;
  const newResource = container.resolve(added);
  release.resolve();
  await disposing;
  expect(order).toEqual(["dependent", "dependency"]);
  expect(container.resolve(added)).toBe(newResource);
  await container.dispose();
  await container.dispose();
  expect(order).toEqual(["dependent", "dependency", "added"]);
});
