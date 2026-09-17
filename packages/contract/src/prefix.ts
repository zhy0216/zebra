import { procedureFromDef } from "./builder.ts";
import type { JoinPath } from "./path.ts";
import type { ContractProcedure, ContractProcedureDef } from "./types.ts";

// Prefixing only needs the data protocol. Comparing recursive builder methods
// across Git dependency copies can exhaust TypeScript's instantiation depth.
type ProcedureShape = { readonly def: ContractProcedureDef };
type RouterShape = { [key: string]: ProcedureShape | RouterShape };

type PrefixedProcedure<P extends string, Proc extends ProcedureShape> = ContractProcedure<{
  [K in keyof Proc["def"]]: K extends "path" ? JoinPath<P, Proc["def"]["path"]> : Proc["def"][K];
}>;

type PrefixedRouter<P extends string, R extends RouterShape> = {
  [K in keyof R]: R[K] extends ProcedureShape
    ? PrefixedProcedure<P, R[K]>
    : R[K] extends RouterShape
      ? PrefixedRouter<P, R[K]>
      : never;
};

function isProcedure(value: unknown): value is ProcedureShape {
  if (typeof value !== "object" || value === null) return false;
  const def = (value as { def?: unknown }).def;
  if (typeof def !== "object" || def === null) return false;
  return typeof (def as ContractProcedureDef).path === "string";
}

function joinPath(prefix: string, path: string): string {
  return path.startsWith("/") ? `${prefix}${path}` : `${prefix}/${path}`;
}

function walk(prefix: string, router: RouterShape): unknown {
  const out: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(router)) {
    if (isProcedure(value)) {
      const def = value.def;
      out[key] = procedureFromDef({ ...def, path: joinPath(prefix, def.path) });
    } else {
      out[key] = walk(prefix, value);
    }
  }
  return out;
}

/** Prefix every leaf procedure path in a router (contract-side DRY; type-level JoinPath). */
export function prefix<P extends string, R extends RouterShape>(
  prefix: P,
  router: R,
): PrefixedRouter<P, R> {
  return walk(prefix, router) as PrefixedRouter<P, R>;
}
