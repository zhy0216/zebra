import { expect, test } from "bun:test";
import { HttpError, ValidationError, toProblemJson } from "../../src/http/errors.ts";
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

test("Problem+Json keeps custom headers and independent error/session cookies", async () => {
  const headers = {
    "Content-Type": "application/vnd.example+json",
    "X-Custom": "kept",
    "Set-Cookie": "a=1; Expires=Wed, 09 Jun 2038 10:18:14 GMT",
  };
  const before = { ...headers };
  const err = new HttpError(409, "conflict", "冲突 🦓", { items: [null, true, 42] }, headers);
  const req = buildRequest(new Request("http://x/conflict"), {});
  const pending: [string, null, number, string] = ["b=2; Path=/", null, 3, "c=3; Path=/"];
  req.ctx.set(Symbol.for("zebra.set-cookie"), pending);
  const res = await errorMiddleware({ exposeStack: false })(req, async () => {
    throw err;
  });
  const expected = new Response(JSON.stringify(toProblemJson(err, "/conflict")), {
    status: 409,
    headers,
  });
  expect(res.status).toBe(expected.status);
  expect(res.statusText).toBe(expected.statusText);
  expect(res.headers.get("content-type")).toBe(headers["Content-Type"]);
  expect(res.headers.get("x-custom")).toBe("kept");
  expect(res.headers.getSetCookie()).toEqual([headers["Set-Cookie"], pending[0], pending[3]]);
  expect(await res.text()).toBe(await expected.text());
  expect(headers).toEqual(before);
  expect(pending).toEqual(["b=2; Path=/", null, 3, "c=3; Path=/"]);
});

test("Problem+Json retains detail toJSON/getter calls from safeSerialize and construction", async () => {
  const render = async (current: boolean) => {
    const calls: string[] = [];
    const err = new HttpError(400, "detail", "Bad Request", {
      get toJSON() {
        calls.push("get toJSON");
        return (key: string) => {
          calls.push(`toJSON:${key}`);
          return {
            get value() {
              calls.push("get value");
              return "🦓";
            },
          };
        };
      },
    });
    const res = current
      ? await errorMiddleware({ exposeStack: false })(
          buildRequest(new Request("http://x/"), {}),
          async () => {
            throw err;
          },
        )
      : new Response(JSON.stringify(toProblemJson(err, "/")), { status: 400 });
    return { body: await res.text(), calls };
  };
  const expected = await render(false);
  expect(expected.calls).toEqual([
    "get toJSON",
    "toJSON:",
    "get value",
    "get toJSON",
    "toJSON:detail",
    "get value",
  ]);
  expect(await render(true)).toEqual(expected);
});

test("Problem+Json keeps unserializable detail fallback and escaping serialization errors", async () => {
  const mw = errorMiddleware({ exposeStack: false });
  const req = buildRequest(new Request("http://x/"), {});
  const circular: Record<string, unknown> = {};
  circular.self = circular;
  let calls = 0;
  const throwing = {
    get value() {
      calls++;
      throw new Error("getter");
    },
  };
  for (const detail of [circular, throwing]) {
    const res = await mw(req, async () => {
      throw new HttpError(400, "detail", "Bad Request", detail);
    });
    expect(((await res.json()) as { detail: string }).detail).toBe("[object Object]");
  }
  expect(calls).toBe(1);
  await expect(
    mw(req, async () => {
      throw new HttpError(400, "bigint", "Bad Request", 1n);
    }),
  ).rejects.toThrow(TypeError);
  const failure = new Error("issues getter");
  let attempts = 0;
  const issues = [
    {
      path: "x",
      get message(): string {
        attempts++;
        throw failure;
      },
    },
  ];
  await expect(
    mw(req, async () => {
      throw new ValidationError(issues);
    }),
  ).rejects.toThrow(failure);
  expect(attempts).toBe(1);
});
