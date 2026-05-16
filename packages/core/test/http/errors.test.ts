import { test, expect } from "bun:test";
import { HttpError, toProblemJson } from "../../src/http/errors.ts";

test("HttpError holds status, code, title", () => {
  const e = new HttpError(404, "blog_not_found", "no such blog", { id: "42" });
  expect(e.status).toBe(404);
  expect(e.code).toBe("blog_not_found");
  expect(e.title).toBe("no such blog");
  expect(e.detail).toEqual({ id: "42" });
});

test("toProblemJson(HttpError) returns RFC 9457 shape", () => {
  const e = new HttpError(404, "blog_not_found", "no such blog", { id: "42" });
  const p = toProblemJson(e, "/blogs/42");
  expect(p).toEqual({
    type: "https://errors.zebra.dev/blog_not_found",
    status: 404,
    title: "no such blog",
    detail: { id: "42" },
    instance: "/blogs/42",
  });
});

test("toProblemJson(unknown) returns 500 generic", () => {
  const p = toProblemJson(new Error("boom"), "/x", { exposeStack: false });
  expect(p.status).toBe(500);
  expect(p.title).toBe("Internal Server Error");
  expect("stack" in p).toBe(false);
});

test("toProblemJson exposes stack when configured", () => {
  const p = toProblemJson(new Error("boom"), "/x", { exposeStack: true });
  expect(typeof p.stack).toBe("string");
});
