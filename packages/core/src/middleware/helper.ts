import type { Middleware, DepsSpec } from "./types.ts";

const DEPS_KEY = Symbol.for("zebra.middleware.deps");

export function middleware<D extends DepsSpec>(
  deps: D,
  fn: (req: any, next: () => Promise<Response>, resolved: { [K in keyof D]: any }) => Promise<Response>,
): Middleware<any> {
  const mw: Middleware<any> = (req, next, resolved) => fn(req, next, resolved ?? ({} as any));
  (mw as any)[DEPS_KEY] = deps;
  return mw;
}

export function getMiddlewareDeps(mw: Middleware<any>): DepsSpec | null {
  return (mw as any)[DEPS_KEY] ?? null;
}
