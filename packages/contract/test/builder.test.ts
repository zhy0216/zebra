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
  expect(proc.def.mcp).toBeUndefined();
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

test(".status() rejects invalid status codes at build time", () => {
  expect(() => zc.get("/x").status(99)).toThrow(/status must be an integer between 100 and 599/);
  expect(() => zc.get("/x").status(600)).toThrow();
  expect(() => zc.get("/x").status(1.5)).toThrow();
  expect(() => zc.get("/x").status(Number.NaN)).toThrow();
  expect(() => zc.get("/x").status(200)).not.toThrow();
});

test("def is frozen: mutating it throws in strict mode", () => {
  const proc = zc.get("/x");
  expect(() => {
    (proc.def as { path: string }).path = "/y";
  }).toThrow();
  expect(proc.def.path).toBe("/x");
});

test(".mcp() positional form sets a declaration", () => {
  const proc = zc.get("/topics/:id").mcp("get_topic", "获取主题", { readOnly: true });
  expect(proc.def.mcp).toEqual({ name: "get_topic", description: "获取主题", readOnly: true });
});

test(".mcp() object form is accepted and merges options", () => {
  const proc = zc
    .get("/topics/:id")
    .mcp({ name: "get_topic", description: "获取主题", destructive: true });
  expect(proc.def.mcp).toEqual({
    name: "get_topic",
    description: "获取主题",
    destructive: true,
  });
});

test(".mcp() keeps the rest of the def intact", () => {
  const proc = zc
    .post("/topics")
    .body(z.object({ title: z.string() }))
    .output(z.object({ id: z.number() }))
    .mcp("create_topic", "创建主题");
  expect(proc.def.method).toBe("POST");
  expect(proc.def.path).toBe("/topics");
  expect(proc.def.mcp?.name).toBe("create_topic");
  expect(proc.def.body).toBeDefined();
  expect(proc.def.output).toBeDefined();
});

test(".mcp() is immutable: earlier procedure stays unexposed", () => {
  const bare = zc.get("/topics/:id");
  const exposed = bare.mcp("get_topic", "获取主题");
  expect(bare.def.mcp).toBeUndefined();
  expect(exposed.def.mcp?.name).toBe("get_topic");
});

test(".mcp() rejects empty names and descriptions at build time", () => {
  expect(() => zc.get("/x").mcp("", "desc")).toThrow(/name must be a non-empty string/);
  expect(() => zc.get("/x").mcp("  ", "desc")).toThrow(/name must be a non-empty string/);
  expect(() => zc.get("/x").mcp("name", "")).toThrow(/description must be a non-empty string/);
  expect(() => zc.get("/x").mcp({ name: "n", description: " " })).toThrow(
    /description must be a non-empty string/,
  );
  expect(() => zc.get("/x").mcp("ok", "desc")).not.toThrow();
});
