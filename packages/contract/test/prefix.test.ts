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
