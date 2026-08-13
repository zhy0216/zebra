import { expect, test } from "bun:test";
import { HttpError, ValidationError } from "../../src/http/errors.ts";
import { buildRequest } from "../../src/http/request.ts";
import { errorMiddleware } from "../../src/middleware/error.ts";

test("HttpError → Problem+Json with status", async () => {
  const mw = errorMiddleware({ exposeStack: false });
  const req = buildRequest(new Request("http://x/blogs/42"), {});
  const res = await mw(req, async () => {
    throw new HttpError(404, "not_found", "blog gone");
  });
  expect(res.status).toBe(404);
  expect(res.headers.get("content-type")).toContain("application/problem+json");
  const body = (await res.json()) as any;
  expect(body.title).toBe("blog gone");
  expect(body.instance).toBe("/blogs/42");
});

test("Unknown error → 500 generic, no stack by default", async () => {
  const mw = errorMiddleware({ exposeStack: false });
  const req = buildRequest(new Request("http://x/"), {});
  const res = await mw(req, async () => {
    throw new Error("boom");
  });
  expect(res.status).toBe(500);
  const body = (await res.json()) as any;
  expect(body.title).toBe("Internal Server Error");
  expect("stack" in body).toBe(false);
});

test("ValidationError → 422 Problem+Json with field issues", async () => {
  const mw = errorMiddleware({ exposeStack: false });
  const req = { url: new URL("http://x/blogs") } as any;
  const res = await mw(req, async () => {
    throw new ValidationError([{ path: "body.title", message: "Required" }]);
  });
  expect(res.status).toBe(422);
  expect(await res.json()).toMatchObject({
    errors: [{ path: "body.title", message: "Required" }],
  });
});

test("stashed Set-Cookie values survive error responses and are appended individually", async () => {
  const mw = errorMiddleware({ exposeStack: false });
  const req = buildRequest(new Request("http://x/"), {});
  req.ctx.set(Symbol.for("zebra.set-cookie"), ["sid=abc; Path=/", "sid=; Max-Age=0"]);
  const res = await mw(req, async () => {
    throw new HttpError(500, "boom", "boom");
  });
  expect(res.status).toBe(500);
  // Two distinct Set-Cookie headers, never comma-joined into one.
  expect(res.headers.getSetCookie()).toEqual(["sid=abc; Path=/", "sid=; Max-Age=0"]);
});
