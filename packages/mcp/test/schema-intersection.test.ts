import { expect, test } from "bun:test";
import { AjvJsonSchemaValidator } from "@modelcontextprotocol/sdk/validation/ajv";
import { zc } from "@zebra-web/contract";
import { Zebra } from "@zebra-web/core";
import { zodSchemaAdapter } from "@zebra-web/schema-zod";
import { z } from "zod";
import { createMcpServer } from "../src/index.ts";

const adapter = zodSchemaAdapter();
const validator = new AjvJsonSchemaValidator();
const pair = z.intersection(z.object({ a: z.string() }), z.object({ b: z.string() }));

const cases: Array<{
  name: string;
  schema: z.ZodType;
  valid: unknown[];
  invalid: unknown[];
}> = [
  {
    name: "disjoint object fields",
    schema: pair,
    valid: [{ a: "a", b: "b" }],
    invalid: [{ a: "a" }, { b: "b" }, { a: 1, b: "b" }, { a: "a", b: 2 }, null],
  },
  {
    name: "intersection inside objects and arrays",
    schema: z.object({ nested: pair, list: z.array(pair) }),
    valid: [{ nested: { a: "a", b: "b" }, list: [{ a: "c", b: "d" }] }],
    invalid: [
      { nested: { a: "a" }, list: [] },
      { nested: { a: "a", b: "b" }, list: [{ a: "c", b: 2 }] },
    ],
  },
  {
    name: "shared nested object fields across three members",
    schema: z.intersection(
      z.intersection(
        z.object({ nested: z.object({ a: z.string() }) }),
        z.object({ nested: z.object({ b: z.number() }) }),
      ),
      z.object({ nested: z.object({ c: z.boolean() }) }),
    ),
    valid: [{ nested: { a: "a", b: 2, c: true } }],
    invalid: [{ nested: { a: "a", c: true } }, { nested: { a: "a", b: "b", c: true } }],
  },
  {
    name: "both constraints on a shared scalar field",
    schema: z.intersection(
      z.object({ value: z.string().min(2) }),
      z.object({ value: z.string().max(4) }),
    ),
    valid: [{ value: "ab" }, { value: "abcd" }],
    invalid: [{}, { value: "a" }, { value: "abcde" }, { value: 3 }],
  },
  {
    name: "object intersected with a union of objects",
    schema: z.intersection(
      z.object({ a: z.string() }),
      z.union([z.object({ b: z.string() }), z.object({ c: z.number() })]),
    ),
    valid: [
      { a: "a", b: "b" },
      { a: "a", c: 2 },
    ],
    invalid: [{ b: "b" }, { a: "a" }, { a: "a", b: 2 }, { a: "a", c: "c" }],
  },
  {
    name: "shared nested fields in an object and union intersection",
    schema: z.intersection(
      z.object({ nested: z.object({ a: z.string() }) }),
      z.union([
        z.object({ nested: z.object({ b: z.string() }) }),
        z.object({ nested: z.object({ c: z.number() }) }),
      ]),
    ),
    valid: [{ nested: { a: "a", b: "b" } }, { nested: { a: "a", c: 2 } }],
    invalid: [{ nested: { b: "b" } }, { nested: { a: "a", c: "c" } }],
  },
  {
    name: "object and record intersection",
    schema: z.intersection(z.object({ a: z.string() }), z.record(z.string(), z.string())),
    valid: [{ a: "a", extra: "b" }],
    invalid: [{ extra: "b" }, { a: "a", extra: 2 }],
  },
  {
    name: "explicit catchall inside an intersection",
    schema: z.intersection(
      z.object({ a: z.string() }).catchall(z.number()),
      z.object({ b: z.number() }),
    ),
    valid: [
      { a: "a", b: 2 },
      { a: "a", b: 2, extra: 3 },
    ],
    invalid: [{ a: "a" }, { a: "a", b: 2, extra: "bad" }],
  },
  {
    name: "explicit strict object inside an intersection",
    schema: z.intersection(
      z.strictObject({ a: z.string(), b: z.number().optional() }),
      z.object({ b: z.number() }),
    ),
    valid: [{ a: "a", b: 2 }],
    invalid: [{ a: "a" }, { a: "a", b: "bad" }],
  },
  {
    name: "optional/default fields and transform input",
    schema: z.intersection(
      z.object({ value: z.string().transform((value) => value.length) }),
      z.object({ page: z.number().default(1), tags: z.array(z.string()).optional() }),
    ),
    valid: [{ value: "ok" }, { value: "ok", page: 2, tags: ["tag"] }],
    invalid: [{ page: 2 }, { value: 2 }, { value: "ok", page: "bad" }],
  },
  {
    name: "ordinary record and union behavior",
    schema: z.object({
      record: z.record(z.string(), z.number()),
      choice: z.union([z.object({ a: z.string() }), z.object({ b: z.number() })]),
    }),
    valid: [
      { record: { extra: 2 }, choice: { a: "a" } },
      { record: {}, choice: { b: 2 } },
    ],
    invalid: [
      { record: { extra: "bad" }, choice: { a: "a" } },
      { record: {}, choice: {} },
    ],
  },
];

for (const { name, schema, valid, invalid } of cases) {
  test(`JSON Schema validator agrees with Zod for ${name}`, () => {
    const validate = validator.getValidator(adapter.toJsonSchema(schema));
    for (const input of valid) {
      expect(schema.safeParse(input).success).toBe(true);
      expect(validate(input).valid).toBe(true);
    }
    for (const input of invalid) {
      expect(schema.safeParse(input).success).toBe(false);
      expect(validate(input).valid).toBe(false);
    }
  });
}

test("combined intersections and ordinary objects/unions still reject invented fields", () => {
  for (const { schema, input } of [
    { schema: pair, input: { a: "a", b: "b", extra: true } },
    {
      schema: z.intersection(
        z.object({ nested: z.object({ a: z.string() }) }),
        z.object({ nested: z.object({ b: z.string() }) }),
      ),
      input: { nested: { a: "a", b: "b", extra: true } },
    },
    { schema: z.object({ a: z.string() }), input: { a: "a", extra: true } },
    {
      schema: z.union([z.object({ a: z.string() }), z.object({ b: z.string() })]),
      input: { a: "a", extra: true },
    },
  ]) {
    // Zod strips extra fields; the adapter intentionally advertises closed inputs.
    expect(schema.safeParse(input).success).toBe(true);
    expect(validator.getValidator(adapter.toJsonSchema(schema))(input).valid).toBe(false);
  }
});

test("intersection fallback retains an explicit strict member's extra-field rejection", () => {
  const schema = z.intersection(
    z.strictObject({ a: z.string(), b: z.number().optional() }),
    z.object({ b: z.number() }),
  );
  const validate = validator.getValidator(adapter.toJsonSchema(schema));
  expect(validate({ a: "a", b: 2 }).valid).toBe(true);
  expect(validate({ a: "a", b: 2, extra: true }).valid).toBe(false);
});

test("MCP discovery advertises a satisfiable intersection accepted by dispatch", async () => {
  const app = new Zebra();
  const contract = { echo: zc.post("/echo").body(pair).mcp("echo", "echo") };
  app.implement(contract, { echo: async (req) => await req.body() });
  const mcp = createMcpServer({ app, contract, schema: adapter });
  try {
    const { tools } = await mcp.listTools();
    const inputSchema: Record<string, unknown> = tools[0]!.inputSchema;
    const validate = validator.getValidator(inputSchema);
    for (const body of [{ a: "a", b: "b" }, { a: "a" }, { a: "a", b: 2 }]) {
      const valid = pair.safeParse(body).success;
      expect(validate({ body }).valid).toBe(valid);
      const result = await mcp.callTool({ name: "echo", arguments: { body } });
      expect(result.isError ?? false).toBe(!valid);
      if (valid) expect(result.structuredContent).toEqual(body);
    }
  } finally {
    await mcp.close();
  }
});
