import "reflect-metadata";
import { expect, test } from "bun:test";
import { zc } from "@zebra/contract";
import { z } from "zod";
import { Zebra } from "../../src/app/app.ts";
import { Container } from "../../src/di/container.ts";
import { token } from "../../src/di/token.ts";
import { HttpError, ValidationError } from "../../src/http/errors.ts";

const Blog = z.object({ id: z.number(), title: z.string(), content: z.string() });

const blogContract = {
  list: zc.get("/blogs").query(z.object({ page: z.coerce.number().min(1).default(1) })).output(z.array(Blog)),
  get: zc.get("/blogs/:id").params(z.object({ id: z.coerce.number().int() })).output(Blog),
  create: zc
    .post("/blogs")
    .body(z.object({ title: z.string().min(1), content: z.string() }))
    .output(Blog)
    .status(201),
  remove: zc.delete("/blogs/:id").status(204),
};

const store: Array<{ id: number; title: string; content: string }> = [];

function makeApp(): Zebra {
  return new Zebra({ container: new Container() });
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any -- runtime-focused assertions
function json(res: Response): Promise<any> {
  return res.json();
}

test("params + query validation failures aggregate into one 422 with prefixed paths", async () => {
  const app = makeApp();
  app.implement(
    zc.get("/blogs/:id")
      .params(z.object({ id: z.coerce.number().int() }))
      .query(z.object({ page: z.coerce.number().min(1) })),
    () => "ok",
  );

  const res = await app.dispatch(new Request("http://x/blogs/abc?page=xyz"));
  expect(res.status).toBe(422);
  const body = await json(res);
  expect(body.errors).toEqual([
    { path: "params.id", message: "Expected number, received nan" },
    { path: "query.page", message: "Expected number, received nan" },
  ]);
});

test("coerce is visible to the handler: params.id is a number", async () => {
  const app = makeApp();
  let seen: unknown;
  app.implement(blogContract.get, (req) => {
    seen = req.params.id;
    return { id: req.params.id, title: "t", content: "c" };
  });
  const res = await app.dispatch(new Request("http://x/blogs/42"));
  expect(res.status).toBe(200);
  expect(seen).toBe(42);
  expect(await res.json()).toEqual({ id: 42, title: "t", content: "c" });
});

test("body validation failure → 422 with body. prefix", async () => {
  const app = makeApp();
  app.implement(blogContract.create, (req) => req.body() as never);
  const res = await app.dispatch(
    new Request("http://x/blogs", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ title: "", content: "x" }),
    }),
  );
  expect(res.status).toBe(422);
  const body = await json(res);
  expect(body.errors).toEqual([{ path: "body.title", message: "String must contain at least 1 character(s)" }]);
});

test("valid body: handler receives validated value and the thunk is replaced (parser runs once)", async () => {
  const app = makeApp();
  let bodyCalls = 0;
  let first: unknown;
  let second: unknown;
  app.implement(blogContract.create, async (req) => {
    first = await req.body();
    second = await req.body();
    bodyCalls++;
    return { id: 1, ...(first as { title: string; content: string }) };
  });
  const res = await app.dispatch(
    new Request("http://x/blogs", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ title: "hi", content: "world" }),
    }),
  );
  expect(res.status).toBe(201);
  expect(first).toEqual({ title: "hi", content: "world" });
  expect(second).toEqual({ title: "hi", content: "world" });
  expect(await res.json()).toEqual({ id: 1, title: "hi", content: "world" });
  expect(bodyCalls).toBe(1);
});

test("invalid JSON body still yields 400 (parse error passes through)", async () => {
  const app = makeApp();
  app.implement(blogContract.create, (req) => req.body() as never);
  const res = await app.dispatch(
    new Request("http://x/blogs", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: "{not json",
    }),
  );
  expect(res.status).toBe(400);
});

test("status 201 / 204 and empty body", async () => {
  const app = makeApp();
  app.implement(blogContract.create, () => ({ id: 1, title: "t", content: "c" }));
  app.implement(blogContract.remove, () => undefined);
  const created = await app.dispatch(
    new Request("http://x/blogs", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ title: "t", content: "c" }),
    }),
  );
  expect(created.status).toBe(201);
  expect(await created.json()).toEqual({ id: 1, title: "t", content: "c" });

  const removed = await app.dispatch(new Request("http://x/blogs/1", { method: "DELETE" }));
  expect(removed.status).toBe(204);
  expect(await removed.text()).toBe("");
});

test("output validation strips extra fields (schema strip) and leaks nothing", async () => {
  const app = makeApp();
  app.implement(blogContract.get, () => ({ id: 1, title: "t", content: "c", secret: "leak" }));
  const res = await app.dispatch(new Request("http://x/blogs/1"));
  expect(res.status).toBe(200);
  expect(await res.json()).toEqual({ id: 1, title: "t", content: "c" });
});

test("output validation failure → 500 output_validation_failed; issues only in detail when exposeStack", async () => {
  const app = makeApp();
  app.implement(blogContract.get, () => ({ id: "not-a-number", title: "t", content: "c" }) as never);
  const res = await app.dispatch(new Request("http://x/blogs/1"));
  expect(res.status).toBe(500);
  const body = await json(res);
  expect(body.type).toBe("https://errors.zebra.dev/output_validation_failed");
  expect(body.detail).toBeUndefined();

  const app2 = new Zebra({ errors: { exposeStack: true } });
  app2.implement(blogContract.get, () => ({ id: "not-a-number", title: "t", content: "c" }) as never);
  const res2 = await app2.dispatch(new Request("http://x/blogs/1"));
  const body2 = await json(res2);
  expect(body2.status).toBe(500);
  expect(body2.detail).toEqual([{ path: "id", message: "Expected number, received string" }]);
});

test("raw Response from handler passes through unchanged (skips output validation and status)", async () => {
  const app = makeApp();
  app.implement(
    zc.get("/raw").output(Blog).status(201),
    () => new Response("custom", { status: 418, headers: { "content-type": "text/plain" } }),
  );
  const res = await app.dispatch(new Request("http://x/raw"));
  expect(res.status).toBe(418);
  expect(await res.text()).toBe("custom");
});

test("validateOutput: false skips output validation", async () => {
  const app = makeApp();
  app.implement(
    blogContract.get,
    {},
    () => ({ id: "nope", title: 1 }) as never,
    { validateOutput: false },
  );
  const res = await app.dispatch(new Request("http://x/blogs/1"));
  expect(res.status).toBe(200);
  expect(await res.json()).toEqual({ id: "nope", title: 1 });
});

test("deps resolve into contract handlers and participate in boot validation", async () => {
  const Db = token<{ read: () => string }>("Db");
  const app = makeApp();
  app.injectValue(Db, { read: () => "from-db" });
  app.implement(zc.get("/db").output(z.string()), { db: Db }, (req, { db }) => db.read());
  const res = await app.dispatch(new Request("http://x/db"));
  expect(await res.json()).toBe("from-db");

  const Missing = token<string>("Missing");
  const app2 = makeApp();
  app2.implement(zc.get("/x"), { missing: Missing }, () => "ok");
  await expect(app2.listen({ port: 0 })).rejects.toThrow();
  await app2.stop();
});

test("middlewares in opts run per implementation", async () => {
  const app = makeApp();
  let ran = 0;
  app.implement(
    zc.get("/mw"),
    {},
    () => "ok",
    {
      middlewares: [
        async (_req, next) => {
          ran++;
          return next();
        },
      ],
    },
  );
  await app.dispatch(new Request("http://x/mw"));
  expect(ran).toBe(1);
});

test("implement after listen() throws", async () => {
  const app = makeApp();
  app.get("/", async () => "ok");
  await app.listen({ port: 0 });
  expect(() => app.implement(zc.get("/late"), () => "x")).toThrow(/after app\.listen/);
  await app.stop();
});

test("user handler can throw HttpError/ValidationError and error middleware renders them", async () => {
  const app = makeApp();
  app.implement(
    zc.get("/err").errors({ boom: { status: 418 } }),
    () => {
      throw new HttpError(418, "boom", "teapot");
    },
  );
  const res = await app.dispatch(new Request("http://x/err"));
  expect(res.status).toBe(418);
  expect((await json(res)).type).toBe("https://errors.zebra.dev/boom");

  app.implement(zc.get("/ve"), () => {
    throw new ValidationError([{ path: "x", message: "nope" }]);
  });
  const res2 = await app.dispatch(new Request("http://x/ve"));
  expect(res2.status).toBe(422);
});

test("unhandled rejection in handler → 500", async () => {
  const app = makeApp();
  app.implement(zc.get("/crash"), () => {
    throw new Error("boom");
  });
  const res = await app.dispatch(new Request("http://x/crash"));
  expect(res.status).toBe(500);
});

test("duplicate method+path throws at registration instead of silently overwriting", async () => {
  const app = makeApp();
  app.implement(zc.get("/dup"), () => "first");
  expect(() => app.implement(zc.get("/dup"), () => "second")).toThrow(/Duplicate route/);
});

test("query last-wins for repeated keys", async () => {
  const app = makeApp();
  let seen: unknown;
  app.implement(
    zc.get("/dupq").query(z.object({ v: z.coerce.number() })),
    (req) => {
      seen = req.query.v;
      return "ok";
    },
  );
  const res = await app.dispatch(new Request("http://x/dupq?v=1&v=2"));
  expect(res.status).toBe(200);
  expect(seen).toBe(2);
  void res;
});
