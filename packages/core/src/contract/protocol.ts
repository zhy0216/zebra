/**
 * Vendored copy of the Standard Schema V1 interface.
 * Source: https://standard-schema.github.io/spec — the spec explicitly
 * allows copying this interface into consumer libraries. Keep in sync with
 * the copies in packages/contract/src/standard-schema.ts and
 * packages/client/src/standard-schema.ts (guarded by parity type tests).
 *
 * NOTE: `FailureResult` omits `value?: undefined` and `PathSegment` omits
 * `value` compared to the spec's reference copy. Verified empirically:
 * zod v3's vendored interface omits them too, so a copy that keeps them is
 * NOT structurally assignable to zod schemas. Omitting them accepts both
 * zod (v3) and official-spec-conformant schemas.
 */
export interface StandardSchemaV1<Input = unknown, Output = Input> {
  readonly "~standard": StandardSchemaV1.Props<Input, Output>;
}

export declare namespace StandardSchemaV1 {
  export interface Props<Input = unknown, Output = Input> {
    readonly version: 1;
    readonly vendor: string;
    readonly validate: (value: unknown) => Result<Output> | Promise<Result<Output>>;
    readonly types?: Types<Input, Output> | undefined;
  }

  export type Result<Output> = SuccessResult<Output> | FailureResult;

  export interface SuccessResult<Output> {
    readonly value: Output;
    readonly issues?: undefined;
  }

  export interface FailureResult {
    readonly issues: ReadonlyArray<Issue>;
  }

  export interface Issue {
    readonly message: string;
    readonly path?: ReadonlyArray<PropertyKey | PathSegment> | undefined;
  }

  export interface PathSegment {
    readonly key: PropertyKey;
  }

  export interface Types<Input = unknown, Output = Input> {
    readonly input: Input;
    readonly output: Output;
  }

  export type InferInput<Schema extends StandardSchemaV1> = NonNullable<
    Schema["~standard"]["types"]
  >["input"];

  export type InferOutput<Schema extends StandardSchemaV1> = NonNullable<
    Schema["~standard"]["types"]
  >["output"];
}

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

/** Duck-type check for a contract procedure object ({ def } with version 1). */
export function isContractProcedure(value: unknown): value is { def: ContractProcedureDef } {
  if (typeof value !== "object" || value === null) return false;
  const def = (value as { def?: unknown }).def;
  if (typeof def !== "object" || def === null) return false;
  const d = def as ContractProcedureDef;
  return d.version === 1 && typeof d.path === "string" && typeof d.method === "string";
}
