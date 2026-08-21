import { expect, test } from "bun:test";
import { z } from "zod";
import { zodSchemaAdapter } from "../src/index.ts";
const adapter = zodSchemaAdapter();

test("z.coerce collapses to its target type", () => {
  const out = adapter.toJsonSchema(z.object({ id: z.coerce.number().int() }));
  expect(out).toEqual({
    type: "object",
    properties: { id: { type: "integer" } },
    required: ["id"],
    additionalProperties: false,
  });
});

test("optional and default fall out of required", () => {
  const out = adapter.toJsonSchema(
    z.object({ page: z.coerce.number().min(1).default(1), tags: z.array(z.string()).optional() }),
  );
  expect(out.required).toBeUndefined();
  expect(out.properties).toEqual({
    page: { type: "number", minimum: 1, default: 1 },
    tags: { type: "array", items: { type: "string" } },
  });
});

test("arrays and nested objects are expressed", () => {
  const Topic = z.object({ id: z.number(), title: z.string().min(1) });
  const out = adapter.toJsonSchema(z.object({ list: z.array(Topic) }));
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

test("unions, enums, literals, records and nullable are expressed", () => {
  expect(adapter.toJsonSchema(z.union([z.string(), z.number()]))).toEqual({
    type: ["string", "number"],
  });
  expect(adapter.toJsonSchema(z.enum(["a", "b"]))).toEqual({ type: "string", enum: ["a", "b"] });
  expect(adapter.toJsonSchema(z.literal("x"))).toEqual({ type: "string", const: "x" });
  expect(adapter.toJsonSchema(z.record(z.string(), z.number()))).toEqual({
    type: "object",
    additionalProperties: { type: "number" },
  });
  expect(adapter.toJsonSchema(z.string().nullable())).toEqual({ type: ["string", "null"] });
});

test("transform keeps its input type (runtime validation is preserved by dispatch)", () => {
  expect(adapter.toJsonSchema(z.string().transform((s) => s.length))).toEqual({ type: "string" });
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
  // non-matching schemas still flow through the converter
  expect(custom.toJsonSchema(z.object({ a: z.number() })).properties).toEqual({
    a: { type: "number" },
  });
});
