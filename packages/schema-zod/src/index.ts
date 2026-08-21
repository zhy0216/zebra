import type { StandardSchemaV1 } from "@zebra/contract";
import type { ZodTypeAny } from "zod";
import zodToJsonSchema from "zod-to-json-schema";

/** A JSON Schema document (draft 7 shape emitted by the zod adapter). */
export interface JsonSchemaObject extends Record<string, unknown> {}

/** Converts a Standard Schema into a JSON Schema document (for MCP/codegen). */
export interface SchemaAdapter {
  toJsonSchema(schema: StandardSchemaV1): JsonSchemaObject;
}

/**
 * Manual JSON Schema override. When a zod schema cannot be expressed well as a
 * JSON Schema (or you want a hand-tuned shape for MCP clients), register a
 * matcher + replacement document; `toJsonSchema` returns it verbatim.
 */
export interface SchemaOverride {
  readonly match: (schema: StandardSchemaV1) => boolean;
  readonly schema: JsonSchemaObject;
}

/**
 * Zod → JSON Schema adapter. The returned schema is a draft-7 JSON Schema
 * describing the *input* shape of the zod schema: `coerce` collapses to the
 * target type, `optional`/`default` fall out of `required`, `transform` keeps
 * its input type (runtime validation is preserved by the Zebra dispatch
 * pipeline, so a lossy JSON Schema never weakens validation).
 *
 * Optional `overrides` let you hand-write JSON Schema for schemas that need it
 * (see `SchemaOverride`); they are matched in order, first match wins.
 *
 * `@zebra/contract` / `@zebra/core` never import zod at runtime — the zod
 * dependency is isolated here.
 */
export function zodSchemaAdapter(overrides?: ReadonlyArray<SchemaOverride>): SchemaAdapter {
  return {
    toJsonSchema(schema) {
      if (overrides !== undefined) {
        for (const override of overrides) {
          if (override.match(schema)) return override.schema;
        }
      }
      const out = zodToJsonSchema(schema as ZodTypeAny, {
        target: "jsonSchema7",
      }) as JsonSchemaObject;
      // MCP inputSchema is embedded in a larger document; a `$schema` header
      // (with its draft-07 URI) is noise here and can confuse clients.
      // biome-ignore lint/performance/noDelete: removing the key keeps `"$schema" in schema` honest
      delete out.$schema;
      return out;
    },
  };
}
