import { ScopeKind } from "./scope.ts";
import type { Identifier } from "./token.ts";

export type BindingKind = "class" | "factory" | "value";

export interface Binding<T> {
  identifier: Identifier<T>;
  kind: BindingKind;
  target: unknown;
  scope: ScopeKind;
  factoryDeps?: Record<string, Identifier<unknown>> | undefined;
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
