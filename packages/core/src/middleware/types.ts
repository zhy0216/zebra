import type { DepsSpec, ResolvedDeps } from "../app/types.ts";

export type DepsRecord = Record<string, unknown>;

export type Middleware<D extends DepsRecord = {}> = (
  req: any,
  next: () => Promise<Response>,
  deps?: D,
) => Promise<Response>;

export type MiddlewareHandler<D extends DepsSpec> = (
  req: any,
  next: () => Promise<Response>,
  deps: ResolvedDeps<D>,
) => Promise<Response>;
