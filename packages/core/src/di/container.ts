import { Binding, BindingBuilder } from "./binding.ts";
import { getConstructorDeps } from "./decorators.ts";
import { isDisposable } from "./disposable.ts";
import { CircularDependencyError, UnboundTokenError } from "./errors.ts";
import { type BindingKey, displayName, keyOf } from "./key.ts";
import { ScopeKind } from "./scope.ts";
import type { Identifier } from "./token.ts";

interface ResolutionFrame {
  key: BindingKey;
  name: string;
}

export class Container {
  protected bindings: Map<BindingKey, Binding<any>> = new Map<BindingKey, Binding<any>>();
  protected instances: Map<BindingKey, any> = new Map<BindingKey, any>();
  protected scopeKind: ScopeKind = ScopeKind.Singleton;
  protected parent: Container | null = null;
  private frozen = false;
  private snapshots: Array<{
    bindings: Map<BindingKey, Binding<any>>;
    instances: Map<BindingKey, any>;
  }> = [];

  bind<T>(id: Identifier<T>): BindingBuilder<T> {
    this.assertMutable();
    const binding: Binding<T> = {
      identifier: id,
      kind: "class",
      target: undefined,
      scope: ScopeKind.Singleton,
    };
    this.bindings.set(keyOf(id), binding);
    return new BindingBuilder(binding);
  }

  rebind<T>(id: Identifier<T>): BindingBuilder<T> {
    this.assertMutable();
    this.bindings.delete(keyOf(id));
    this.instances.delete(keyOf(id));
    return this.bind(id);
  }

  snapshot(): void {
    this.snapshots.push({
      bindings: new Map(this.bindings),
      instances: new Map(this.instances),
    });
  }

  restore(): void {
    this.assertMutable();
    const s = this.snapshots.pop();
    if (!s) return;
    this.bindings = s.bindings;
    this.instances = s.instances;
  }

  resolve<T>(id: Identifier<T>): T {
    return this.resolveWithStack(id, []);
  }

  protected resolveWithStack<T>(id: Identifier<T>, stack: ResolutionFrame[]): T {
    const key = keyOf(id);
    const name = displayName(id);
    const cycleStart = stack.findIndex((frame) => frame.key === key);
    if (cycleStart !== -1) {
      throw new CircularDependencyError([
        ...stack.slice(cycleStart).map((frame) => frame.name),
        name,
      ]);
    }
    const binding = this.findBinding(id);
    if (!binding) throw new UnboundTokenError(name, [...stack.map((frame) => frame.name), name]);
    return this.instantiate(binding, [...stack, { key, name }]);
  }

  /** Look up a binding across the container chain. */
  public findBinding<T>(id: Identifier<T>): Binding<T> | undefined {
    return this.bindings.get(keyOf(id)) ?? this.parent?.findBinding(id);
  }

  createChildScope(kind: ScopeKind): Container {
    const child = new Container();
    child.parent = this;
    child.scopeKind = kind;
    return child;
  }

  freeze(): void {
    this.frozen = true;
  }

  async dispose(): Promise<void> {
    const seen = new Set<unknown>();
    const disposables: unknown[] = [];
    const collect = (value: unknown): void => {
      if (value === null || (typeof value !== "object" && typeof value !== "function")) return;
      if (seen.has(value)) return;
      seen.add(value);
      disposables.push(value);
    };
    // LIFO over instantiation order: dependents are disposed before dependencies.
    for (const instance of [...this.instances.values()].reverse()) collect(instance);
    for (const binding of this.bindings.values()) {
      if (binding.kind === "value") collect(binding.target);
    }
    for (const instance of disposables) {
      if (isDisposable(instance)) await instance.dispose();
    }
    this.instances.clear();
  }

  protected instantiate<T>(binding: Binding<T>, stack: ResolutionFrame[]): T {
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
        // The factory receives the container matching its scope (root for
        // singletons, request/session scope for those), never a short-lived
        // container the singleton was first resolved through.
        instance = (binding.target as (c: Container) => T)(cacheContainer ?? this);
      }
    } else {
      const cls = binding.target as new (...args: any[]) => T;
      if (typeof cls !== "function") {
        const name = displayName(binding.identifier);
        throw new Error(
          `Binding for "${name}" has no implementation configured (call .to(), .toSelf(), .toFactory() or .toValue())`,
        );
      }
      const deps = getConstructorDeps(cls).map((d) => this.resolveWithStack(d, stack));
      instance = new cls(...deps);
    }
    if (cacheContainer) cacheContainer.instances.set(key, instance);
    return instance;
  }

  protected cacheContainerFor(scope: ScopeKind): Container | null {
    if (scope === ScopeKind.Transient) return null;
    if (scope === ScopeKind.Singleton) {
      let c: Container = this;
      while (c.parent) c = c.parent;
      return c;
    }
    // Request or Session: find nearest matching scope ancestor (including self)
    let c: Container | null = this;
    while (c) {
      if (c.scopeKind === scope) return c;
      c = c.parent;
    }
    return null; // not in matching scope, treat as transient
  }

  private assertMutable(): void {
    if (this.frozen) throw new Error("Cannot register bindings after app.listen()");
  }
}
