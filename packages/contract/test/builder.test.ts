import { expect, test } from "bun:test";
import { z } from "zod";
import { zc } from "../src/index.ts";

test("bare zc.get returns a valid frozen procedure with default def", () => {
  const proc = zc.get("/blogs/:id");
  expect(proc.def.version).toBe(1);
  expect(proc.def.method).toBe("GET");
  expect(proc.def.path).toBe("/blogs/:id");
  expect(proc.def.params).toBeUndefined();
  expect(proc.def.query).toBeUndefined();
  expect(proc.def.body).toBeUndefined();
  expect(proc.def.output).toBeUndefined();
  expect(proc.def.status).toBe(200);
  expect(proc.def.errors).toEqual({});
  expect(proc.def.meta).toBeUndefined();
  expect(Object.isFrozen(proc.def)).toBe(true);
  expect(Object.isFrozen(proc)).toBe(true);
});

test("all five methods produce the right method + path", () => {
  expect(zc.post("/x").def.method).toBe("POST");
  expect(zc.put("/x").def.method).toBe("PUT");
  expect(zc.patch("/x").def.method).toBe("PATCH");
  expect(zc.delete("/x").def.method).toBe("DELETE");
  expect(zc.get("/x").def.method).toBe("GET");
});

test("head and options methods produce the right method + path", () => {
  expect(zc.head("/x").def.method).toBe("HEAD");
  expect(zc.options("/x").def.method).toBe("OPTIONS");
});

test("chained calls accumulate schema slots and defaults stay", () => {
  const create = zc
    .post("/blogs")
    .body(z.object({ title: z.string() }))
    .output(z.object({ id: z.number() }))
    .status(201)
    .meta({ summary: "Create" })
    .errors({ bad: { status: 400 } });

  expect(create.def.method).toBe("POST");
  expect(create.def.path).toBe("/blogs");
  expect(create.def.status).toBe(201);
  expect(create.def.meta).toEqual({ summary: "Create" });
  expect(create.def.errors).toEqual({ bad: { status: 400 } });
  expect(create.def.body).toBeDefined();
  expect(create.def.output).toBeDefined();
  expect(create.def.params).toBeUndefined();
  expect(create.def.query).toBeUndefined();
});

test("chain is immutable: each call returns a new procedure, earlier ones unchanged", () => {
  const bare = zc.get("/blogs/:id");
  const withParams = bare.params(z.object({ id: z.string() }));
  const withOutput = bare.output(z.object({ id: z.number() }));

  expect(withParams).not.toBe(bare);
  expect(withOutput).not.toBe(bare);
  expect(bare.def.params).toBeUndefined();
  expect(bare.def.output).toBeUndefined();
  expect(withParams.def.params).toBeDefined();
  expect(withParams.def.output).toBeUndefined();
  expect(withOutput.def.params).toBeUndefined();
  expect(withOutput.def.output).toBeDefined();
});

test("errors merge across calls and leave earlier def untouched", () => {
  const one = zc.get("/a").errors({ first: { status: 400 } });
  const two = one.errors({ second: { status: 404 } });
  expect(one.def.errors).toEqual({ first: { status: 400 } });
  expect(two.def.errors).toEqual({ first: { status: 400 }, second: { status: 404 } });
});

test("GET .body() throws at runtime", () => {
  expect(() => {
    // @ts-expect-error body is not allowed on GET procedures
    zc.get("/x").body(z.object({}));
  }).toThrow(/not allowed on GET/);
});

test("HEAD .body() throws at runtime", () => {
  expect(() => {
    // @ts-expect-error body is not allowed on HEAD procedures
    zc.head("/x").body(z.object({}));
  }).toThrow(/not allowed on GET\/HEAD/);
});

test("POST .body() does not throw", () => {
  expect(() => zc.post("/x").body(z.object({}))).not.toThrow();
});

test("def is frozen: mutating it throws in strict mode", () => {
  const proc = zc.get("/x");
  expect(() => {
    (proc.def as { path: string }).path = "/y";
  }).toThrow();
  expect(proc.def.path).toBe("/x");
});
