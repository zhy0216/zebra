import { test, expect } from "bun:test";
import { errorMiddleware } from "../../src/middleware/error.ts";
import { HttpError } from "../../src/http/errors.ts";
import { buildRequest } from "../../src/http/request.ts";

test("HttpError → Problem+Json with status", async () => {
  const mw = errorMiddleware({ exposeStack: false });
  const req = buildRequest(new Request("http://x/blogs/42"), {});
  const res = await mw(req, async () => {
    throw new HttpError(404, "not_found", "blog gone");
  });
  expect(res.status).toBe(404);
  expect(res.headers.get("content-type")).toContain("application/problem+json");
  const body = await res.json() as any;
  expect(body.title).toBe("blog gone");
  expect(body.instance).toBe("/blogs/42");
});

test("Unknown error → 500 generic, no stack by default", async () => {
  const mw = errorMiddleware({ exposeStack: false });
  const req = buildRequest(new Request("http://x/"), {});
  const res = await mw(req, async () => { throw new Error("boom"); });
  expect(res.status).toBe(500);
  const body = await res.json() as any;
  expect(body.title).toBe("Internal Server Error");
  expect("stack" in body).toBe(false);
});
