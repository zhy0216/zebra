import type { Tool, ToolAnnotations } from "@modelcontextprotocol/sdk/types.js";
import type {
  ContractProcedure,
  ContractProcedureDef,
  ContractRouter,
  StandardSchemaV1,
} from "@zebra-web/contract";

/** Converts a Standard Schema into a JSON Schema document (for MCP inputSchema). */
export interface SchemaAdapter {
  toJsonSchema(schema: StandardSchemaV1): Record<string, unknown>;
}

/** A collected `.mcp()`-declared procedure, ready to be advertised as a tool. */
export interface McpToolManifest {
  readonly def: ContractProcedureDef;
  readonly name: string;
  readonly title: string | undefined;
  readonly description: string;
  readonly inputSchema: Record<string, unknown>;
  readonly annotations: ToolAnnotations;
}

/**
 * Walks a contract router and collects every procedure that declared `.mcp()`.
 * Plain `app.get()`/`app.post()` style routes are not part of a contract
 * router, and procedures without `.mcp()` are skipped.
 */
export function collectTools(router: ContractRouter, schema: SchemaAdapter): McpToolManifest[] {
  const out: McpToolManifest[] = [];
  walk(router, out, schema, new Map());
  return out;
}

function walk(
  node: ContractRouter,
  out: McpToolManifest[],
  schema: SchemaAdapter,
  names: Map<string, ContractProcedureDef>,
): void {
  for (const value of Object.values(node)) {
    if (isProcedure(value)) {
      const mcp = value.def.mcp;
      if (mcp === undefined) continue;
      const previous = names.get(mcp.name);
      if (previous !== undefined) {
        throw new Error(
          `mcp: duplicate tool name "${mcp.name}" for ${previous.method} ${previous.path} and ${value.def.method} ${value.def.path}`,
        );
      }
      names.set(mcp.name, value.def);
      out.push(buildManifest(value.def, mcp, schema));
    } else if (typeof value === "object" && value !== null) {
      walk(value as ContractRouter, out, schema, names);
    }
  }
}

function isProcedure(value: unknown): value is ContractProcedure {
  if (typeof value !== "object" || value === null) return false;
  const def = (value as { def?: unknown }).def;
  if (typeof def !== "object" || def === null) return false;
  const d = def as ContractProcedureDef;
  return d.version === 1 && typeof d.path === "string" && typeof d.method === "string";
}

function buildManifest(
  def: ContractProcedureDef,
  mcp: NonNullable<ContractProcedureDef["mcp"]>,
  schema: SchemaAdapter,
): McpToolManifest {
  const annotations: ToolAnnotations = {};
  if (mcp.readOnly !== undefined) annotations.readOnlyHint = mcp.readOnly;
  if (mcp.destructive !== undefined) annotations.destructiveHint = mcp.destructive;
  if (mcp.idempotent !== undefined) annotations.idempotentHint = mcp.idempotent;
  if (mcp.openWorld !== undefined) annotations.openWorldHint = mcp.openWorld;
  return {
    def,
    name: mcp.name,
    title: mcp.title,
    description: mcp.description,
    inputSchema: buildInputSchema(def, schema),
    annotations,
  };
}

/**
 * MCP arguments are namespaced (`{ params, query, body }`) to avoid field-name
 * collisions between path/query/body. A part is present as a property only when
 * the contract declares it; `params` is required when declared (path parameters
 * are essential for URL construction), while `query`/`body` follow their own
 * schema's shape so all-optional object parts can be omitted. Scalar/array
 * parts still require a value, even without an object `required` keyword.
 */
export function buildInputSchema(
  def: ContractProcedureDef,
  schema: SchemaAdapter,
): Record<string, unknown> {
  const properties: Record<string, unknown> = {};
  const required: string[] = [];

  if (def.params !== undefined) {
    properties.params = schema.toJsonSchema(def.params);
    required.push("params");
  }
  if (def.query !== undefined) {
    const q = schema.toJsonSchema(def.query);
    properties.query = q;
    if (requiresNamespace(q)) required.push("query");
  }
  if (def.body !== undefined) {
    const b = schema.toJsonSchema(def.body);
    properties.body = b;
    if (requiresNamespace(b)) required.push("body");
  }

  const out: Record<string, unknown> = { type: "object", properties };
  if (required.length > 0) out.required = required;
  return out;
}

/**
 * Infer omission for the supported JSON Schema shapes without invoking user
 * validation (which may be async or have side effects). This is deliberately
 * not a full JSON Schema evaluator: custom refs/keywords remain adapter-owned.
 */
function requiresNamespace(schema: unknown): boolean {
  if (schema === false) return true;
  if (typeof schema !== "object" || schema === null) return false;
  const shape = schema as Record<string, unknown>;
  if (typeof shape.type === "string" && shape.type !== "object") return true;
  if (Array.isArray(shape.type) && !shape.type.includes("object")) return true;
  if (Array.isArray(shape.required) && shape.required.length > 0) return true;
  if (typeof shape.minProperties === "number" && shape.minProperties > 0) return true;
  if (Array.isArray(shape.allOf) && shape.allOf.some(requiresNamespace)) return true;
  if (Array.isArray(shape.anyOf) && shape.anyOf.every(requiresNamespace)) return true;
  return false;
}

/** Converts a collected manifest into the MCP `Tool` wire shape. */
export function toTool(manifest: McpToolManifest): Tool {
  const tool: Tool = {
    name: manifest.name,
    description: manifest.description,
    inputSchema: manifest.inputSchema as Tool["inputSchema"],
  };
  if (manifest.title !== undefined) tool.title = manifest.title;
  if (Object.keys(manifest.annotations).length > 0) tool.annotations = manifest.annotations;
  return tool;
}
