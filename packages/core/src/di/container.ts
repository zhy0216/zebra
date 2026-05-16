import { Binding, BindingBuilder } from "./binding.ts";
import { getConstructorDeps } from "./decorators.ts";
import { isDisposable } from "./disposable.ts";
import { CircularDependencyError, UnboundTokenError } from "./errors.ts";
import { type BindingKey, displayName, keyOf } from "./key.ts";
import { ScopeKind } from "./scope.ts";
import type { Identifier } from "./token.ts";

export class Container {
  protected bindings: Map<BindingKey, Binding<any>> = new Map<BindingKey, Binding<any>>();
  protected instances: Map<BindingKey, any> = new Map<BindingKey, any>();
  protected scopeKind: ScopeKind = ScopeKind.Singleton;
  protected parent: Container | null = null;
  private snapshots: Array<{
    bindings: Map<BindingKey, Binding<any>>;
    instances: Map<BindingKey, any>;
  }> = [];

  bind<T>(id: Identifier<T>): BindingBuilder<T> {
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
    const s = this.snapshots.pop();
    if (!s) return;
    this.bindings = s.bindings;
    this.instances = s.instances;
  }

  resolve<T>(id: Identifier<T>): T {
    return this.resolveWithStack(id, []);
  }

  protected resolveWithStack<T>(id: Identifier<T>, stack: string[]): T {
    const name = displayName(id);
    if (stack.includes(name)) {
      throw new CircularDependencyError([...stack, name]);
    }
    const binding = this.findBinding(id);
    if (!binding) throw new UnboundTokenError(name, [...stack, name]);
    return this.instantiate(binding, [...stack, name]);
  }

  protected findBinding<T>(id: Identifier<T>): Binding<T> | undefined {
    return this.bindings.get(keyOf(id)) ?? this.parent?.findBinding(id);
  }

  createChildScope(kind: ScopeKind): Container {
    const child = new Container();
    child.parent = this;
    child.scopeKind = kind;
    return child;
  }

  async dispose(): Promise<void> {
    for (const instance of this.instances.values()) {
      if (isDisposable(instance)) await instance.dispose();
    }
    this.instances.clear();
  }

  protected instantiate<T>(binding: Binding<T>, stack: string[]): T {
    const key = keyOf(binding.identifier);
    if (binding.kind === "value") return binding.target as T;

    const cacheContainer = this.cacheContainerFor(binding.scope);
    if (cacheContainer?.instances.has(key)) {
      return cacheContainer.instances.get(key);
    }

    let instance: T;
    if (binding.kind === "factory") {
      instance = (binding.target as (c: Container) => T)(this);
    } else {
      const cls = binding.target as new (...args: any[]) => T;
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
}
