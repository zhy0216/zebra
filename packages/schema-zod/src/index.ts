import type { StandardSchemaV1 } from "@zebra-web/contract";
import { type ZodType, toJSONSchema } from "zod";

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
 * JSON Schema container keys that may hold nested subschemas; post-processing
 * walks into them to apply closed-object semantics to nested zod objects.
 *
 * `properties`/`patternProperties`/`definitions`/`$defs` are key→schema maps,
 * so their *values* are walked; the other keys hold a single subschema or an
 * array of subschemas (tuples, unions), handled below.
 */
const MAP_KEYS = ["properties", "patternProperties", "definitions", "$defs"] as const;
const SUBSCHEMA_KEYS = [
  "items",
  "additionalProperties",
  "propertyNames",
  "anyOf",
  "oneOf",
  "allOf",
  "not",
  "contains",
  "if",
  "then",
  "else",
] as const;

/**
 * Zod 4's native input schema does not emit `additionalProperties: false`
 * for ordinary zod objects (unknown input keys are stripped). The old
 * zod-to-json-schema (v3) output did, and MCP clients rely on the strictness:
 * an MCP `inputSchema` without it lets models invent extra argument fields
 * that are silently dropped by zod validation. Preserve the strict contract
 * by closing plain object subschemas, except where intersection members need
 * to accept each other's fields.
 *
 * `z.record` is untouched: it already carries `additionalProperties` (its
 * value schema) plus `propertyNames`, so the guard skips it. Ordinary union
 * members remain closed independently, as they describe alternative inputs.
 */
function addClosedObjects(node: unknown): void {
  if (typeof node !== "object" || node === null) return;
  if (Array.isArray(node)) {
    for (const child of node) addClosedObjects(child);
    return;
  }
  const obj = node as Record<string, unknown>;
  const intersection = Array.isArray(obj.allOf);
  // A mixed intersection (unions, records, catchalls, references, etc.) cannot
  // safely acquire closed members. This also applies to shared nested fields:
  // closing either side's nested object can reject fields from the other side.
  // Preserve native assertions throughout that subtree, including explicit
  // additionalProperties constraints, rather than guessing a merged shape.
  if (intersection && !mergeObjectIntersection(obj)) return;
  for (const key of MAP_KEYS) {
    const map = obj[key];
    if (typeof map === "object" && map !== null) {
      for (const child of Object.values(map)) addClosedObjects(child);
    }
  }
  for (const key of SUBSCHEMA_KEYS) {
    // Retain all original assertions without closing the original members.
    // The merged properties below are separate copies and receive closure.
    if (key === "allOf" && intersection) continue;
    const value = obj[key];
    if (Array.isArray(value)) {
      for (const child of value) addClosedObjects(child);
    } else if (typeof value === "object" && value !== null) {
      addClosedObjects(value);
    }
  }
  if (obj.type === "object" && "properties" in obj && !("additionalProperties" in obj)) {
    obj.additionalProperties = false;
  }
}

/**
 * Draft 7's additionalProperties only sees properties in the same subschema.
 * For intersections of plain objects, put the combined shape on the allOf
 * container and close it once. Keep allOf to preserve every original assertion;
 * overlapping property schemas are themselves intersected, never overwritten.
 * Explicit strict/catchall constraints remain in their original scope.
 */
function mergeObjectIntersection(obj: Record<string, unknown>): boolean {
  if (
    !Array.isArray(obj.allOf) ||
    obj.allOf.length === 0 ||
    "type" in obj ||
    "properties" in obj ||
    "additionalProperties" in obj
  ) {
    return false;
  }
  const members: Array<Record<string, unknown> & { properties: Record<string, unknown> }> = [];
  for (const member of obj.allOf) {
    if (
      typeof member !== "object" ||
      member === null ||
      member.type !== "object" ||
      typeof member.properties !== "object" ||
      member.properties === null ||
      Array.isArray(member.properties) ||
      ["additionalProperties", "patternProperties", "$ref", "anyOf", "oneOf", "allOf"].some(
        (key) => key in member,
      )
    ) {
      return false;
    }
    members.push(member);
  }
  const propertySchemas = new Map<string, unknown[]>();
  const required = new Set<string>();
  for (const member of members) {
    for (const [key, schema] of Object.entries(member.properties)) {
      const schemas = propertySchemas.get(key) ?? [];
      schemas.push(structuredClone(schema));
      propertySchemas.set(key, schemas);
    }
    if (Array.isArray(member.required)) {
      for (const key of member.required) {
        if (typeof key === "string") required.add(key);
      }
    }
  }
  obj.type = "object";
  obj.properties = Object.fromEntries(
    [...propertySchemas].map(([key, schemas]) => [
      key,
      schemas.length === 1 ? schemas[0] : { allOf: schemas },
    ]),
  );
  if (required.size > 0) obj.required = [...required];
  return true;
}

/**
 * Zod → JSON Schema adapter (built on zod 4's native `toJSONSchema`). The
 * returned schema is a draft-7 JSON Schema describing the *input* shape of
 * the zod schema: `coerce` collapses to the target type, `optional`/`default`
 * fall out of `required`, `transform` keeps its input type (runtime validation
 * is preserved by the Zebra dispatch pipeline, so a lossy JSON Schema never
 * weakens validation).
 *
 * Optional `overrides` let you hand-write JSON Schema for schemas that need it
 * (see `SchemaOverride`); they are matched in order, first match wins.
 *
 * `@zebra-web/contract` / `@zebra-web/core` never import zod at runtime — the zod
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
      const out = toJSONSchema(schema as ZodType, {
        target: "draft-07",
        io: "input",
      }) as JsonSchemaObject;
      // MCP inputSchema is embedded in a larger document; a `$schema` header
      // (with its draft-07 URI) is noise here and can confuse clients.
      // biome-ignore lint/performance/noDelete: removing the key keeps `"$schema" in schema` honest
      delete out.$schema;
      addClosedObjects(out);
      return out;
    },
  };
}
