import { expect, expectTypeOf, test } from "bun:test";
import { z } from "zod";
import { prefix, zc } from "../src/index.ts";

const router = {
  list: zc.get("/blogs"),
  get: zc.get("/blogs/:id"),
  nested: {
    remove: zc.delete("/blogs/:id"),
  },
};

test("prefix rewrites leaf paths, preserving method and chain state", () => {
  const api = prefix("/api", router);
  expect(api.list.def.path).toBe("/api/blogs");
  expect(api.get.def.path).toBe("/api/blogs/:id");
  expect(api.nested.remove.def.path).toBe("/api/blogs/:id");
  expect(api.nested.remove.def.method).toBe("DELETE");
});

test("prefix does not mutate the original router", () => {
  prefix("/api", router);
  expect(router.list.def.path).toBe("/blogs");
  expect(router.nested.remove.def.path).toBe("/blogs/:id");
});

test("prefix keeps schema slots", () => {
  const withQuery = prefix("/api", { list: zc.get("/blogs").query(z.object({ q: z.string() })) });
  expect(withQuery.list.def.query).toBeDefined();
});

test("prefix works with paths lacking a leading slash", () => {
  const api = prefix("/api", { list: zc.get("blogs") });
  expect(api.list.def.path).toBe("/api/blogs");
});

test("prefixed paths keep literal types", () => {
  const api = prefix("/api", router);
  expectTypeOf(api.list.def.path).toEqualTypeOf<"/api/blogs">();
  expectTypeOf(api.get.def.path).toEqualTypeOf<"/api/blogs/:id">();
  expectTypeOf(api.nested.remove.def.path).toEqualTypeOf<"/api/blogs/:id">();
  expectTypeOf(api.list.def.method).toEqualTypeOf<"GET">();
});

test("prefix accepts procedure definitions without comparing recursive builders", () => {
  const body = z.object({ title: z.string() });
  const output = z.object({ id: z.number() });
  const create = zc.post("/blogs").body(body).output(output).status(201)
    .errors({ conflict: { status: 409 } }).meta({ summary: "Create blog" });
  // Other package copies only need to share the data protocol. Prefix rebuilds
  // its own chainable procedure without requiring the incoming builder methods.
  const api = prefix("/api", { nested: { create: { def: create.def } } });

  expect(api.nested.create.def.body).toBe(body);
  expect(api.nested.create.def.output).toBe(output);
  expect(api.nested.create.status(202).def.path).toBe("/api/blogs");
  expectTypeOf(api.nested.create.def.path).toEqualTypeOf<"/api/blogs">();
  expectTypeOf(api.nested.create.def.method).toEqualTypeOf<"POST">();
  expectTypeOf(api.nested.create.def.status).toEqualTypeOf<201>();
  expectTypeOf(api.nested.create.def.body).toEqualTypeOf<typeof body>();
  expectTypeOf(api.nested.create.def.output).toEqualTypeOf<typeof output>();
  expectTypeOf(api.nested.create.def.errors.conflict.status).toEqualTypeOf<409>();
  expectTypeOf(api.nested.create.def.meta.summary).toEqualTypeOf<"Create blog">();
});
