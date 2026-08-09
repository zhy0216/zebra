import type { ContractProcedureDef } from "./protocol.ts";
import type { StandardSchemaV1 } from "./standard-schema.ts";

export interface ContractProcedure<Def extends ContractProcedureDef = ContractProcedureDef> {
  readonly def: Def;
}

export interface ContractRouter {
  [key: string]: ContractProcedure | ContractRouter;
}

/** Per-procedure call arguments: keys exist/are required per declaration. */
export type ClientArgs<Def extends ContractProcedureDef> = (Def["params"] extends StandardSchemaV1
  ? { params: StandardSchemaV1.InferInput<Def["params"]> }
  : {}) &
  (Def["query"] extends StandardSchemaV1
    ? { query: StandardSchemaV1.InferInput<Def["query"]> }
    : {}) &
  (Def["body"] extends StandardSchemaV1
    ? { body: StandardSchemaV1.InferInput<Def["body"]> }
    : {}) & { headers?: Record<string, string>; signal?: AbortSignal };

/** What a call resolves to: output's InferOutput; status 204 → undefined. */
export type ClientOutput<Def extends ContractProcedureDef> = Def["status"] extends 204
  ? undefined
  : Def["output"] extends StandardSchemaV1
    ? StandardSchemaV1.InferOutput<Def["output"]>
    : unknown;

export type ClientProcedure<Def extends ContractProcedureDef> = (
  args: ClientArgs<Def> | ({} extends ClientArgs<Def> ? void : never),
) => Promise<ClientOutput<Def>>;

export type ContractClient<R extends ContractRouter> = {
  [K in keyof R]: R[K] extends ContractProcedure<infer Def>
    ? ClientProcedure<Def>
    : R[K] extends ContractRouter
      ? ContractClient<R[K]>
      : never;
};

export interface ClientOptions {
  baseUrl: string;
  fetch?: (url: string, init: RequestInit) => Promise<Response>;
  headers?: Record<string, string> | (() => Record<string, string>);
}
