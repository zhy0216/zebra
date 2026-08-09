import type { RouteHandler } from "../app/types.ts";
import { HttpError, ValidationError, type ValidationIssue } from "../http/errors.ts";
import type { ContractProcedureDef, StandardSchemaV1 } from "./protocol.ts";
import type { ContractHandler, ContractRequest, ImplementOptions } from "./types.ts";

export interface BuildContractHandlerOptions extends ImplementOptions {
  exposeStack?: boolean;
}

interface MutableContractRequest<Def extends ContractProcedureDef> {
  params: Record<string, unknown>;
  query: Record<string, unknown>;
  body: () => Promise<unknown>;
  raw: Request;
  headers: Headers;
  url: URL;
  ctx: Map<symbol, unknown>;
}

function segToString(seg: PropertyKey | StandardSchemaV1.PathSegment): string {
  return typeof seg === "object" && seg !== null ? String(seg.key) : String(seg);
}

function mapIssues(
  issues: ReadonlyArray<StandardSchemaV1.Issue>,
  prefix: string,
): ValidationIssue[] {
  return issues.map((issue) => {
    const joined = (issue.path ?? []).map(segToString).join(".");
    return {
      path: prefix === "" ? joined : `${prefix}.${joined}`,
      message: issue.message,
    };
  });
}

export async function runStandardValidate(
  schema: StandardSchemaV1,
  value: unknown,
): Promise<
  { success: true; value: unknown } | { success: false; issues: ReadonlyArray<StandardSchemaV1.Issue> }
> {
  let result = schema["~standard"].validate(value);
  if (result instanceof Promise) result = await result;
  if (result.issues) return { success: false, issues: result.issues };
  return { success: true, value: result.value };
}

/**
 * Wraps a user handler with contract runtime validation. Order per spec §4:
 * params → query (aggregated 422) → body (thunk replaced) → handler →
 * output re-validation → status/content-type serialization.
 */
export function buildContractHandler<Def extends ContractProcedureDef, D>(
  def: Def,
  handler: ContractHandler<Def, D>,
  opts: BuildContractHandlerOptions = {},
): RouteHandler<D> {
  const { validateOutput = true, exposeStack = false } = opts;

  return async (req, deps) => {
    const zebraReq = req as unknown as MutableContractRequest<Def>;
    const issues: ValidationIssue[] = [];

    if (def.params) {
      const result = await runStandardValidate(def.params, zebraReq.params);
      if (!result.success) issues.push(...mapIssues(result.issues, "params"));
      else zebraReq.params = result.value as Record<string, unknown>;
    }

    if (def.query) {
      const result = await runStandardValidate(def.query, zebraReq.query);
      if (!result.success) issues.push(...mapIssues(result.issues, "query"));
      else zebraReq.query = result.value as Record<string, unknown>;
    }

    if (issues.length > 0) throw new ValidationError(issues);

    if (def.body) {
      const raw = await zebraReq.body();
      const result = await runStandardValidate(def.body, raw);
      if (!result.success) throw new ValidationError(mapIssues(result.issues, "body"));
      zebraReq.body = () => Promise.resolve(result.value);
    }

    const result = await handler(zebraReq as unknown as ContractRequest<Def>, deps);

    if (result instanceof Response) return result;

    let payload: unknown = result;
    if (validateOutput && def.output) {
      const output = await runStandardValidate(def.output, result);
      if (!output.success) {
        const err = exposeStack
          ? new HttpError(
              500,
              "output_validation_failed",
              "Output validation failed",
              mapIssues(output.issues, ""),
            )
          : new HttpError(500, "output_validation_failed", "Output validation failed");
        throw err;
      }
      payload = output.value;
    }

    if (def.status === 204) return new Response(null, { status: 204 });
    return new Response(JSON.stringify(payload), {
      status: def.status,
      headers: { "content-type": "application/json; charset=utf-8" },
    });
  };
}
