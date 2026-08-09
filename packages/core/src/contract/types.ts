import type { PathParams } from "../app/types.ts";
import type { ZebraRequest } from "../http/request.ts";
import type { Middleware } from "../middleware/types.ts";
import type { ContractProcedureDef, StandardSchemaV1 } from "./protocol.ts";

export type ContractParams<Def extends ContractProcedureDef> = Def["params"] extends StandardSchemaV1
  ? StandardSchemaV1.InferOutput<Def["params"]>
  : PathParams<Def["path"]>;

export type ContractQuery<Def extends ContractProcedureDef> = Def["query"] extends StandardSchemaV1
  ? StandardSchemaV1.InferOutput<Def["query"]>
  : Record<string, string>;

export type ContractBody<Def extends ContractProcedureDef> = Def["body"] extends StandardSchemaV1
  ? StandardSchemaV1.InferOutput<Def["body"]>
  : unknown;

/** What a handler returns: the output schema's InferInput (the wrapper re-validates). */
export type ContractReturn<Def extends ContractProcedureDef> =
  Def["output"] extends StandardSchemaV1
    ? StandardSchemaV1.InferInput<Def["output"]> | Response
    : unknown;

export interface ContractRequest<Def extends ContractProcedureDef>
  extends ZebraRequest<ContractParams<Def>, ContractBody<Def>, ContractQuery<Def>> {}

export interface ContractProcedure<Def extends ContractProcedureDef = ContractProcedureDef> {
  readonly def: Def;
}

export interface ContractHandler<Def extends ContractProcedureDef, D = never> {
  (req: ContractRequest<Def>, deps: D): ContractReturn<Def> | Promise<ContractReturn<Def>>;
}

export type ProcedureImpl<Def extends ContractProcedureDef, D> =
  | ContractHandler<Def, D>
  | { handler: ContractHandler<Def, D>; middlewares?: Middleware[] };

export interface ImplementOptions {
  middlewares?: Middleware[];
  validateOutput?: boolean;
}

export function isHandlerEntry(value: unknown): value is { handler: ContractHandler<any, any> } {
  return typeof value === "object" && value !== null && typeof (value as any).handler === "function";
}
