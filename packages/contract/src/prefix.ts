import { procedureFromDef } from "./builder.ts";
import type { JoinPath } from "./path.ts";
import type { ContractProcedure, ContractProcedureDef, ContractRouter } from "./types.ts";

type PrefixedProcedure<P extends string, Proc extends ContractProcedure> = ContractProcedure<
  Omit<Proc["def"], "path"> & { path: JoinPath<P, Proc["def"]["path"]> }
>;

type PrefixedRouter<P extends string, R extends ContractRouter> = {
  [K in keyof R]: R[K] extends ContractProcedure
    ? PrefixedProcedure<P, R[K]>
    : R[K] extends ContractRouter
      ? PrefixedRouter<P, R[K]>
      : never;
};

function isProcedure(value: unknown): value is ContractProcedure {
  if (typeof value !== "object" || value === null) return false;
  const def = (value as { def?: unknown }).def;
  if (typeof def !== "object" || def === null) return false;
  return typeof (def as ContractProcedureDef).path === "string";
}

function joinPath(prefix: string, path: string): string {
  return path.startsWith("/") ? `${prefix}${path}` : `${prefix}/${path}`;
}

function walk<P extends string>(prefix: string, router: ContractRouter): unknown {
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
export function prefix<P extends string, R extends ContractRouter>(
  prefix: P,
  router: R,
): PrefixedRouter<P, R> {
  return walk(prefix, router) as PrefixedRouter<P, R>;
}
