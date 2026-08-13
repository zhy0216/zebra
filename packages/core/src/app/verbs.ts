import type { DepsSpec, RouteHandler } from "./types.ts";

/**
 * Registration sink behind every verb method. `Zebra` routes through its
 * public `route()` overloads; `Group` through its private `register` (which
 * prefixes the path). The verb *overload declarations* stay per-class — a
 * group's path type is `JoinPath<Prefix, Path>` — only the two-branch
 * implementation is shared.
 */
export interface VerbTarget {
  add(method: string, path: string, handler: RouteHandler): void;
  addWithDeps(method: string, path: string, deps: DepsSpec, handler: RouteHandler): void;
}

/** Shared implementation of `get` / `post` / `put` / `patch` / `delete` /
 * `head` / `options`: dispatches between the no-deps and deps forms.
 * Mirrors the historical `(path, handler)` / `(path, deps, handler)`
 * arities: `a` is the handler with two args, the deps spec with three. */
export function registerVerb(
  target: VerbTarget,
  method: string,
  path: string,
  a: RouteHandler | DepsSpec,
  b?: RouteHandler,
): void {
  if (b === undefined) target.add(method, path, a as RouteHandler);
  else target.addWithDeps(method, path, a as DepsSpec, b);
}
