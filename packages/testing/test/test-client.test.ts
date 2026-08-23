import { expect, expectTypeOf, test } from "bun:test";
import { createClient } from "@zebra-web/client";
import { zc } from "@zebra-web/contract";
import { z } from "zod";
import { createTestApp } from "../src/index.ts";
import { createTestClient } from "../src/index.ts";

const Blog = z.object({ id: z.number(), title: z.string(), content: z.string() });

const blogContract = {
  list: zc
    .get("/blogs")
    .query(z.object({ page: z.coerce.number().min(1).default(1) }))
    .output(z.array(Blog)),
  get: zc
    .get("/blogs/:id")
    .params(z.object({ id: z.coerce.number().int() }))
    .output(Blog),
  create: zc
    .post("/blogs")
    .body(z.object({ title: z.string().min(1), content: z.string() }))
    .output(Blog)
    .status(201),
};

const store: Array<{ id: number; title: string; content: string }> = [];

function makeApp(): ReturnType<typeof createTestApp> {
  store.length = 0;
  const app = createTestApp();
  app.implement(blogContract, {
    list: () => store,
    get: (req) => {
      const found = store.find((b) => b.id === req.params.id);
      if (!found) throw new Error("nope");
      return found;
    },
    create: async (req) => {
      const body = await req.body();
      const created = { id: store.length + 1, ...body };
      store.push(created);
      return created;
    },
  });
  return app;
}

test("createTestClient drives a full contract round-trip without sockets", async () => {
  const app = makeApp();
  const api = createTestClient(app, blogContract);

  expectTypeOf(api.list).toBeFunction();

  const listed = await api.list({ query: { page: 1 } });
  expect(listed).toEqual([]);

  const created = await api.create({ body: { title: "hi", content: "world" } });
  expect(created).toEqual({ id: 1, title: "hi", content: "world" });

  const again = await api.list({ query: { page: 1 } });
  expect(again).toEqual([{ id: 1, title: "hi", content: "world" }]);
});

test("createTestClient surfaces 422 as ClientError with problem errors", async () => {
  const app = makeApp();
  const api = createTestClient(app, blogContract);
  try {
    await api.create({ body: { title: "", content: "x" } });
    expect.unreachable();
  } catch (err) {
    const e = err as {
      status: number;
      code: string;
      problem: { errors: Array<{ path: string; message: string }> };
    };
    expect(e.status).toBe(422);
    expect(e.code).toBe("validation_failed");
    expect(e.problem.errors).toEqual([
      { path: "body.title", message: "Too small: expected string to have >=1 characters" },
    ]);
  }
});

test("createTestClient surfaces handler-thrown HttpError as ClientError", async () => {
  const app = createTestApp();
  app.implement(blogContract.get, () => {
    throw new Error("nope");
  });
  const api = createTestClient(app, blogContract);
  await expect(api.get({ params: { id: 1 } })).rejects.toThrow();
});

test("createTestClient is createClient with an in-process fetch", async () => {
  const app = makeApp();
  const api = createTestClient(app, blogContract);
  const direct = createClient(blogContract, {
    baseUrl: "http://test.local",
    fetch: (url, init) => app.request(url, init),
  });
  await expect(api.list({ query: { page: 1 } })).resolves.toEqual([]);
  await expect(direct.list({ query: { page: 1 } })).resolves.toEqual([]);
});
