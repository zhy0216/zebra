import type { StandardSchemaV1 } from "./standard-schema.ts";

export const METHODS = ["GET", "POST", "PUT", "PATCH", "DELETE", "HEAD", "OPTIONS"] as const;
export type Method = (typeof METHODS)[number];

export interface ErrorSpec {
  status: number;
}

/**
 * Frozen pure-data description of a contract procedure. Structurally identical
 * to @zebra/contract's ContractProcedureDef. All fields required-but-undefined
 * (never optional) to sidestep exactOptionalPropertyTypes variance issues.
 */
export interface ContractProcedureDef {
  readonly version: 1;
  readonly method: Method;
  readonly path: string;
  readonly params: StandardSchemaV1 | undefined;
  readonly query: StandardSchemaV1 | undefined;
  readonly body: StandardSchemaV1 | undefined;
  readonly output: StandardSchemaV1 | undefined;
  readonly status: number;
  readonly errors: Record<string, ErrorSpec>;
  readonly meta: Readonly<Record<string, unknown>> | undefined;
}

/** Minimal RFC 9457 Problem+Json shape (mirrors core's ProblemJson wire format). */
export interface ProblemJson {
  type: string;
  status: number;
  title: string;
  detail?: unknown;
  instance: string;
  errors?: Array<{ path: string; message: string }>;
}

export function isProcedure(value: unknown): value is { def: ContractProcedureDef } {
  if (typeof value !== "object" || value === null) return false;
  const def = (value as { def?: unknown }).def;
  if (typeof def !== "object" || def === null) return false;
  const d = def as ContractProcedureDef;
  return d.version === 1 && typeof d.path === "string" && typeof d.method === "string";
}
