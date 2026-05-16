import { Binding, BindingBuilder } from "./binding.ts";
import { UnboundTokenError } from "./errors.ts";
import { keyOf, displayName, type BindingKey } from "./key.ts";
import { ScopeKind } from "./scope.ts";
import type { Identifier } from "./token.ts";

export class Container {
  protected bindings = new Map<BindingKey, Binding<any>>();
  protected instances = new Map<BindingKey, any>();
  protected scopeKind: ScopeKind = ScopeKind.Singleton;
  protected parent: Container | null = null;

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

  resolve<T>(id: Identifier<T>): T {
    const binding = this.findBinding(id);
    if (!binding) throw new UnboundTokenError(displayName(id), [displayName(id)]);
    return this.instantiate(binding);
  }

  protected findBinding<T>(id: Identifier<T>): Binding<T> | undefined {
    return this.bindings.get(keyOf(id)) ?? this.parent?.findBinding(id);
  }

  protected instantiate<T>(binding: Binding<T>): T {
    const key = keyOf(binding.identifier);
    if (binding.kind === "value") return binding.target as T;
    if (binding.scope === ScopeKind.Singleton && this.instances.has(key)) {
      return this.instances.get(key);
    }
    const instance =
      binding.kind === "factory"
        ? (binding.target as (c: Container) => T)(this)
        : new (binding.target as new () => T)();
    if (binding.scope === ScopeKind.Singleton) this.instances.set(key, instance);
    return instance;
  }
}
