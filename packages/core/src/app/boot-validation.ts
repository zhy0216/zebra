import { Container } from "../di/container.ts";
import { getConstructorDeps } from "../di/decorators.ts";
import { CircularDependencyError, ScopeMismatchError, UnboundTokenError } from "../di/errors.ts";
import { type BindingKey, displayName, keyOf } from "../di/key.ts";
import { ScopeKind, canDependOn } from "../di/scope.ts";
import type { Identifier } from "../di/token.ts";
import { getMiddlewareDeps } from "../middleware/helper.ts";
import type { Middleware } from "../middleware/types.ts";
import type { RegisteredRoute } from "./types.ts";

export function validateGraph(
  container: Container,
  routes: RegisteredRoute[],
  appMiddlewares: Middleware[],
): void {
  const roots: Identifier<any>[] = [];

  for (const mw of appMiddlewares) {
    const deps = getMiddlewareDeps(mw);
    if (deps) for (const v of Object.values(deps)) roots.push(v);
  }

  for (const r of routes) {
    if (r.deps) for (const v of Object.values(r.deps)) roots.push(v);
    for (const mw of r.middlewares) {
      const deps = getMiddlewareDeps(mw);
      if (deps) for (const v of Object.values(deps)) roots.push(v);
    }
  }

  const visited = new Map<BindingKey, Set<ScopeKind | null>>();
  for (const root of roots) {
    // Treat the route-level resolution as request-scoped consumer
    walk(container, root, [], visited, ScopeKind.Request, "<route>");
  }
}

interface ValidationFrame {
  key: BindingKey;
  name: string;
}

function walk(
  container: Container,
  id: Identifier<any>,
  stack: ValidationFrame[],
  visited: Map<BindingKey, Set<ScopeKind | null>>,
  consumerScope: ScopeKind | null,
  consumerName: string,
): void {
  const key = keyOf(id);
  const name = displayName(id);
  const cycleStart = stack.findIndex((frame) => frame.key === key);
  if (cycleStart !== -1) {
    throw new CircularDependencyError([
      ...stack.slice(cycleStart).map((frame) => frame.name),
      name,
    ]);
  }

  const binding = (container as any).findBinding(id);
  if (!binding) {
    throw new UnboundTokenError(name, [...stack.map((frame) => frame.name), name]);
  }

  if (consumerScope !== null) {
    if (!canDependOn(consumerScope, binding.scope)) {
      throw new ScopeMismatchError(name, binding.scope, consumerName, consumerScope);
    }
  }

  const childConsumerScope = binding.scope === ScopeKind.Transient ? consumerScope : binding.scope;
  const childConsumerName = binding.scope === ScopeKind.Transient ? consumerName : name;
  const visitedScopes = visited.get(key) ?? new Set<ScopeKind | null>();
  if (visitedScopes.has(childConsumerScope)) return;
  visitedScopes.add(childConsumerScope);
  visited.set(key, visitedScopes);

  const nextStack = [...stack, { key, name }];

  if (binding.kind === "class") {
    const cls = binding.target as Function;
    const childDeps = getConstructorDeps(cls);
    for (const d of childDeps) {
      walk(container, d, nextStack, visited, childConsumerScope, childConsumerName);
    }
  } else if (binding.kind === "factory" && binding.factoryDeps) {
    for (const d of Object.values(binding.factoryDeps) as Identifier<unknown>[]) {
      walk(container, d, nextStack, visited, childConsumerScope, childConsumerName);
    }
  }
  // factory without factoryDeps, or value: no further deps to walk
}
