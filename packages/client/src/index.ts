export { createClient } from "./client.ts";
export { ClientError } from "./error.ts";
export type { StandardSchemaV1 } from "./standard-schema.ts";
// isProcedure is a runtime type guard (not just a type) — value export.
export { isProcedure } from "./protocol.ts";
export type { ContractProcedureDef, Method, ErrorSpec, ProblemJson } from "./protocol.ts";
export type {
  ClientArgs,
  ClientOutput,
  ClientProcedure,
  ContractClient,
  ClientOptions,
  ContractProcedure,
  ContractRouter,
} from "./types.ts";
