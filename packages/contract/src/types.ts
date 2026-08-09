import type { PathParams } from "./path.ts";
import type { StandardSchemaV1 } from "./standard-schema.ts";

export const METHODS = ["GET", "POST", "PUT", "PATCH", "DELETE"] as const;
export type Method = (typeof METHODS)[number];

export interface ErrorSpec {
  status: number;
}

export type ProcedureMeta = Readonly<Record<string, unknown>>;

/**
 * Frozen pure-data description of a contract procedure. All fields are
 * required-but-undefined (never optional) to sidestep exactOptionalPropertyTypes
 * variance issues across the three vendored copies.
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

/** Chained, immutable contract procedure builder. Every call returns a new frozen procedure. */
export interface ContractProcedure<Def extends ContractProcedureDef = ContractProcedureDef> {
  readonly def: Def;
  params<S extends StandardSchemaV1>(
    schema: S,
  ): ContractProcedure<Omit<Def, "params"> & { params: S }>;
  query<S extends StandardSchemaV1>(
    schema: S,
  ): ContractProcedure<Omit<Def, "query"> & { query: S }>;
  body<S extends StandardSchemaV1>(
    schema: Def["method"] extends "GET" ? never : S,
  ): ContractProcedure<Omit<Def, "body"> & { body: S }>;
  output<S extends StandardSchemaV1>(
    schema: S,
  ): ContractProcedure<Omit<Def, "output"> & { output: S }>;
  status<const S extends number>(status: S): ContractProcedure<Omit<Def, "status"> & { status: S }>;
  errors<const E extends Record<string, ErrorSpec>>(
    es: E,
  ): ContractProcedure<Omit<Def, "errors"> & { errors: Def["errors"] & E }>;
  meta<const M extends ProcedureMeta>(meta: M): ContractProcedure<Omit<Def, "meta"> & { meta: M }>;
}

export interface ContractRouter {
  [key: string]: ContractProcedure | ContractRouter;
}

type DefParams<Def extends ContractProcedureDef> = Def["params"] extends StandardSchemaV1
  ? StandardSchemaV1.InferOutput<Def["params"]>
  : PathParams<Def["path"]>;

type DefQuery<Def extends ContractProcedureDef> = Def["query"] extends StandardSchemaV1
  ? StandardSchemaV1.InferOutput<Def["query"]>
  : Record<string, string>;

type DefBody<Def extends ContractProcedureDef> = Def["body"] extends StandardSchemaV1
  ? StandardSchemaV1.InferOutput<Def["body"]>
  : unknown;

type DefOutput<Def extends ContractProcedureDef> = Def["output"] extends StandardSchemaV1
  ? StandardSchemaV1.InferOutput<Def["output"]>
  : unknown;

/** Inferred params type of a contract procedure (coerce/transform applied). */
export type InferParams<P extends ContractProcedure> = P extends ContractProcedure<infer Def>
  ? DefParams<Def>
  : never;

/** Inferred query type of a contract procedure (coerce/transform applied). */
export type InferQuery<P extends ContractProcedure> = P extends ContractProcedure<infer Def>
  ? DefQuery<Def>
  : never;

/** Inferred body type of a contract procedure (coerce/transform applied). */
export type InferBody<P extends ContractProcedure> = P extends ContractProcedure<infer Def>
  ? DefBody<Def>
  : never;

/** Inferred output type of a contract procedure (post-transform wire format). */
export type InferOutput<P extends ContractProcedure> = P extends ContractProcedure<infer Def>
  ? DefOutput<Def>
  : never;
