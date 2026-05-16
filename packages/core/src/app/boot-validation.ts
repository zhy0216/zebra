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

  const visited = new Set<BindingKey>();
  for (const root of roots) {
    // Treat the route-level resolution as request-scoped consumer
    walk(container, root, [], visited, ScopeKind.Request);
  }
}

function walk(
  container: Container,
  id: Identifier<any>,
  stack: string[],
  visited: Set<BindingKey>,
  consumerScope: ScopeKind | null,
): void {
  const name = displayName(id);
  if (stack.includes(name)) {
    throw new CircularDependencyError([...stack, name]);
  }

  const binding = (container as any).findBinding(id);
  if (!binding) throw new UnboundTokenError(name, [...stack, name]);

  if (consumerScope !== null) {
    if (!canDependOn(consumerScope, binding.scope)) {
      const consumerName = stack[stack.length - 1] ?? "<root>";
      throw new ScopeMismatchError(name, binding.scope, consumerName, consumerScope);
    }
  }

  const key = keyOf(id);
  if (visited.has(key)) return;
  visited.add(key);

  if (binding.kind === "class") {
    const cls = binding.target as Function;
    const childDeps = getConstructorDeps(cls);
    for (const d of childDeps) {
      walk(container, d, [...stack, name], visited, binding.scope);
    }
  }
}
