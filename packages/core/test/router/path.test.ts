import { expect, test } from "bun:test";
import { type PathSegment, parsePath } from "../../src/router/path.ts";

test("parsePath splits a static path", () => {
  const segs = parsePath("/blogs/list");
  expect(segs).toEqual([
    { kind: "static", value: "blogs" },
    { kind: "static", value: "list" },
  ] as PathSegment[]);
});

test("parsePath extracts :param segments", () => {
  const segs = parsePath("/blogs/:id/comments/:cid");
  expect(segs).toEqual([
    { kind: "static", value: "blogs" },
    { kind: "param", name: "id" },
    { kind: "static", value: "comments" },
    { kind: "param", name: "cid" },
  ] as PathSegment[]);
});

test("parsePath extracts *splat at the end", () => {
  const segs = parsePath("/assets/*file");
  expect(segs).toEqual([
    { kind: "static", value: "assets" },
    { kind: "wildcard", name: "file" },
  ] as PathSegment[]);
});

test("parsePath rejects *splat in middle", () => {
  expect(() => parsePath("/a/*x/b")).toThrow();
});
