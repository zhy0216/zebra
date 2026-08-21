import type { Tool, ToolAnnotations } from "@modelcontextprotocol/sdk/types.js";
import type {
  ContractProcedure,
  ContractProcedureDef,
  ContractRouter,
  StandardSchemaV1,
} from "@zebra/contract";

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
  walk(router, out, schema);
  return out;
}

function walk(node: ContractRouter, out: McpToolManifest[], schema: SchemaAdapter): void {
  for (const value of Object.values(node)) {
    if (isProcedure(value)) {
      const mcp = value.def.mcp;
      if (mcp === undefined) continue;
      out.push(buildManifest(value.def, mcp, schema));
    } else if (typeof value === "object" && value !== null) {
      walk(value as ContractRouter, out, schema);
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
 * schema's required fields so all-optional parts can be omitted.
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
    if (hasRequiredRoot(q)) required.push("query");
  }
  if (def.body !== undefined) {
    const b = schema.toJsonSchema(def.body);
    properties.body = b;
    if (hasRequiredRoot(b)) required.push("body");
  }

  const out: Record<string, unknown> = { type: "object", properties };
  if (required.length > 0) out.required = required;
  return out;
}

function hasRequiredRoot(schema: Record<string, unknown>): boolean {
  return Array.isArray(schema.required) && schema.required.length > 0;
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
