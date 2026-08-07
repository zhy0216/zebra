import type { DepsSpec } from "../app/types.ts";
import type { Middleware, MiddlewareHandler } from "./types.ts";

const DEPS_KEY = Symbol.for("zebra.middleware.deps");

export function middleware<D extends DepsSpec>(deps: D, fn: MiddlewareHandler<D>): Middleware {
  const mw: Middleware = (req, next, resolved) =>
    fn(req, next, (resolved ?? {}) as Parameters<MiddlewareHandler<D>>[2]);
  (mw as any)[DEPS_KEY] = deps;
  return mw;
}

export function getMiddlewareDeps(mw: Middleware<any>): DepsSpec | null {
  return (mw as any)[DEPS_KEY] ?? null;
}
