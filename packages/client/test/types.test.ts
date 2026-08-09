import { expectTypeOf, test } from "bun:test";
import { zc, type ContractRouter } from "@zebra/contract";
import { z } from "zod";
import { createClient, type ClientArgs, type ClientOutput } from "../src/index.ts";

const Blog = z.object({ id: z.number(), title: z.string(), content: z.string() });

const blogContract = {
  list: zc
    .get("/blogs")
    .query(z.object({ page: z.coerce.number().min(1).default(1) }))
    .output(z.array(Blog)),
  get: zc.get("/blogs/:id").params(z.object({ id: z.coerce.number().int() })).output(Blog),
  create: zc
    .post("/blogs")
    .body(z.object({ title: z.string().min(1), content: z.string() }))
    .output(Blog)
    .status(201),
  remove: zc.delete("/blogs/:id").status(204),
};

test("client call args: declared keys exist and are required", () => {
  const api = createClient(blogContract, { baseUrl: "http://x" });
  api.create({ body: { title: "hi", content: "x" } });
  api.get({ params: { id: 1 } });
  api.list({ query: { page: 2 } });
});

test("missing declared key is a compile error", () => {
  const api = createClient(blogContract, { baseUrl: "http://x" });
  try {
    // @ts-expect-error create requires body
    api.create({});
  } catch {
    // expected runtime throw
  }
});

test("wrong argument type is a compile error", () => {
  const api = createClient(blogContract, { baseUrl: "http://x" });
  try {
    // @ts-expect-error body.title must be a string
    api.create({ body: { title: 42, content: "x" } });
  } catch {
    // expected runtime throw
  }
});

test("undeclared key is a compile error", () => {
  const api = createClient(blogContract, { baseUrl: "http://x" });
  try {
    // @ts-expect-error params is not declared on create
    api.create({ body: { title: "t", content: "c" }, params: { id: 1 } });
  } catch {
    // expected runtime throw
  }
});

test("all-optional procedure: the whole args object can be omitted", () => {
  const bare = { ping: zc.get("/ping") };
  const api = createClient(bare, { baseUrl: "http://x" });
  api.ping();
  api.ping({});
});

test("client args: keys exist per declaration with correct optionality", () => {
  type ListArgs = ClientArgs<(typeof blogContract)["list"]["def"]>;
  type CreateArgs = ClientArgs<(typeof blogContract)["create"]["def"]>;

  expectTypeOf<ListArgs["query"]>().toEqualTypeOf<{ page?: number }>();
  const _headers: Record<string, string> | undefined = null as unknown as ListArgs["headers"];
  void _headers;
  const _listRequiresArgs: {} extends ListArgs ? true : false = false;
  void _listRequiresArgs;

  expectTypeOf<CreateArgs["body"]>().toEqualTypeOf<{ title: string; content: string }>();
  const _createRequiresArgs: {} extends CreateArgs ? true : false = false;
  void _createRequiresArgs;
});

test("all-optional procedure args are omittable at the type level", () => {
  type PingArgs = ClientArgs<ReturnType<typeof zc.get<"/ping">>["def"]>;
  const _pingArgsOmittable: {} extends PingArgs ? true : false = true;
  void _pingArgsOmittable;
});

test("client output types: InferOutput, 204 → undefined", () => {

  type ListOut = ClientOutput<(typeof blogContract)["list"]["def"]>;
  expectTypeOf<ListOut>().toEqualTypeOf<Array<{ id: number; title: string; content: string }>>();

  type CreateOut = ClientOutput<(typeof blogContract)["create"]["def"]>;
  expectTypeOf<CreateOut>().toEqualTypeOf<{ id: number; title: string; content: string }>();

  type RemoveOut = ClientOutput<(typeof blogContract)["remove"]["def"]>;
  expectTypeOf<RemoveOut>().toEqualTypeOf<undefined>();
});

test("createClient maps a router to a client with nested structure", () => {
  const router = {
    a: zc.get("/a"),
    nested: { b: zc.post("/b") },
  };
  const api = createClient(router, { baseUrl: "http://x" });
  expectTypeOf(api.a).toEqualTypeOf<
    (args: { headers?: Record<string, string>; signal?: AbortSignal } | void) => Promise<unknown>
  >();
  void api.nested.b;
});
