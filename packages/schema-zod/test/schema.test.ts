import { expect, test } from "bun:test";
import { z } from "zod";
import { zodSchemaAdapter } from "../src/index.ts";
const adapter = zodSchemaAdapter();

test("z.coerce collapses to its target type", () => {
  const out = adapter.toJsonSchema(z.object({ id: z.coerce.number().int() }));
  // Zod 4's native toJSONSchema adds minimum/maximum (safe-integer bounds) to
  // int schemas — a legitimate constraint on the input type, so the test is
  // re-asserted per the new contract instead of the old converter's bare
  // `{ type: "integer" }`.
  expect(out).toEqual({
    type: "object",
    properties: {
      id: {
        type: "integer",
        minimum: -9007199254740991,
        maximum: 9007199254740991,
      },
    },
    required: ["id"],
    additionalProperties: false,
  });
});

test("optional and default fall out of required", () => {
  const out = adapter.toJsonSchema(
    z.object({ page: z.coerce.number().min(1).default(1), tags: z.array(z.string()).optional() }),
  );
  expect(out.required).toBeUndefined();
  // The adapter preserves additionalProperties:false on closed zod objects
  // (zod 4 omits it natively) so MCP input schemas stay strict.
  expect(out.additionalProperties).toBe(false);
  expect(out.properties).toEqual({
    page: { default: 1, type: "number", minimum: 1 },
    tags: { type: "array", items: { type: "string" } },
  });
});

test("arrays and nested objects are expressed", () => {
  const Topic = z.object({ id: z.number(), title: z.string().min(1) });
  const out = adapter.toJsonSchema(z.object({ list: z.array(Topic) }));
  // Nested zod objects are also closed, matching the old converter's output.
  expect(out).toEqual({
    type: "object",
    properties: {
      list: {
        type: "array",
        items: {
          type: "object",
          properties: {
            id: { type: "number" },
            title: { type: "string", minLength: 1 },
          },
          required: ["id", "title"],
          additionalProperties: false,
        },
      },
    },
    required: ["list"],
    additionalProperties: false,
  });
});

test("object intersections close the combined shape and retain member assertions", () => {
  const out = adapter.toJsonSchema(
    z.intersection(z.object({ a: z.string() }), z.object({ b: z.string() })),
  );
  expect(out).toEqual({
    type: "object",
    properties: { a: { type: "string" }, b: { type: "string" } },
    required: ["a", "b"],
    additionalProperties: false,
    allOf: [
      { type: "object", properties: { a: { type: "string" } }, required: ["a"] },
      { type: "object", properties: { b: { type: "string" } }, required: ["b"] },
    ],
  });
});

test("shared nested properties are intersected before applying closure", () => {
  const out = adapter.toJsonSchema(
    z.intersection(
      z.object({ nested: z.object({ a: z.string() }), label: z.string().min(2) }),
      z.object({ nested: z.object({ b: z.number() }), label: z.string().max(4) }),
    ),
  );
  expect(out.properties).toMatchObject({
    nested: {
      type: "object",
      properties: { a: { type: "string" }, b: { type: "number" } },
      required: ["a", "b"],
      additionalProperties: false,
    },
    label: {
      allOf: [
        { type: "string", minLength: 2 },
        { type: "string", maxLength: 4 },
      ],
    },
  });
});

test("intersections preserve optional, default and transform input schemas", () => {
  const out = adapter.toJsonSchema(
    z.intersection(
      z.object({ value: z.string().transform((value) => value.length) }),
      z.object({ page: z.number().default(1), tags: z.array(z.string()).optional() }),
    ),
  );
  expect(out.required).toEqual(["value"]);
  expect(out.properties).toEqual({
    value: { type: "string" },
    page: { type: "number", default: 1 },
    tags: { type: "array", items: { type: "string" } },
  });
});

test("mixed intersections preserve explicit strict and catchall constraints", () => {
  const strict = z.strictObject({ a: z.string() });
  const catchall = z.object({ a: z.string() }).catchall(z.number());
  for (const schema of [strict, catchall]) {
    const out = adapter.toJsonSchema(z.intersection(schema, z.object({ b: z.number() })));
    expect(out.allOf).toEqual([
      adapter.toJsonSchema(schema),
      { type: "object", properties: { b: { type: "number" } }, required: ["b"] },
    ]);
    expect(out.additionalProperties).toBeUndefined();
  }
});

test("unions, enums, literals, records and nullable are expressed", () => {
  // Zod 4 expresses unions and nullables via anyOf (old converter collapsed
  // them into a type array) and records via propertyNames — re-asserted per
  // the new contract.
  expect(adapter.toJsonSchema(z.union([z.string(), z.number()]))).toEqual({
    anyOf: [{ type: "string" }, { type: "number" }],
  });
  expect(adapter.toJsonSchema(z.enum(["a", "b"]))).toEqual({ type: "string", enum: ["a", "b"] });
  expect(adapter.toJsonSchema(z.literal("x"))).toEqual({ type: "string", const: "x" });
  expect(adapter.toJsonSchema(z.record(z.string(), z.number()))).toEqual({
    type: "object",
    propertyNames: { type: "string" },
    additionalProperties: { type: "number" },
  });
  // z.record keeps its value schema in additionalProperties, so the closed-object
  // post-process must not overwrite it.
  expect(adapter.toJsonSchema(z.record(z.string(), z.number())).additionalProperties).toEqual({
    type: "number",
  });
  expect(adapter.toJsonSchema(z.string().nullable())).toEqual({
    anyOf: [{ type: "string" }, { type: "null" }],
  });
});

test("transform keeps its input type (runtime validation is preserved by dispatch)", () => {
  expect(adapter.toJsonSchema(z.string().transform((s) => s.length))).toEqual({ type: "string" });
});

test("unrepresentable schemas throw instead of returning an empty schema", () => {
  // zod 4's unrepresentable: "throw" default: a function cannot be a JSON
  // Schema, so the adapter fails loudly rather than silently returning {}.
  expect(() => adapter.toJsonSchema(z.function())).toThrow();
});

test("no $schema header leaks into the output", () => {
  expect("$schema" in adapter.toJsonSchema(z.object({ a: z.string() }))).toBe(false);
});

test("manual overrides are matched in order, first match wins", () => {
  const secret = z.object({ token: z.string() });
  const custom = zodSchemaAdapter([
    {
      match: (s) => s === secret,
      schema: { type: "string", format: "password" },
    },
  ]);
  expect(custom.toJsonSchema(secret)).toEqual({ type: "string", format: "password" });
  // non-matching schemas still flow through the converter (with the same
  // closed-object post-processing)
  expect(custom.toJsonSchema(z.object({ a: z.number() }))).toEqual({
    type: "object",
    properties: { a: { type: "number" } },
    required: ["a"],
    additionalProperties: false,
  });
});
