import { expect, test } from "bun:test";
import { runInNewContext } from "node:vm";
import { type ContractProcedure, type StandardSchemaV1, zc } from "@zebra-web/contract";
import { Zebra } from "../../src/app/app.ts";

type Result = StandardSchemaV1.Result<unknown>;

function schema(validate: StandardSchemaV1["~standard"]["validate"]): StandardSchemaV1 {
  return { "~standard": { version: 1, vendor: "async-validation-test", validate } };
}

function request(): Request {
  return new Request("http://x/items/42?page=2", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ title: " hello " }),
  });
}

const modes = [
  { name: "sync", resolve: (result: Result) => result },
  { name: "current realm Promise", resolve: (result: Result) => Promise.resolve(result) },
  {
    name: "cross realm Promise",
    resolve: (result: Result): Promise<Result> => {
      const promise: Promise<Result> = runInNewContext("Promise.resolve(result)", { result });
      expect(promise).not.toBeInstanceOf(Promise);
      return promise;
    },
  },
];

for (const { name, resolve } of modes) {
  test.each([
    ["params", "id"],
    ["query", "page"],
    ["body", "title"],
  ] as const)(`${name}: %s issues return 422 without running the handler`, async (part, field) => {
    const app = new Zebra();
    let handlerCalls = 0;
    const invalid = schema(() =>
      resolve({ issues: [{ path: [field], message: "Invalid value" }] }),
    );
    const procedure: ContractProcedure = zc.post("/items/:id")[part](invalid);
    app.implement(procedure, () => {
      handlerCalls++;
      return "unexpected";
    });

    const response = await app.dispatch(request());
    expect(response.status).toBe(422);
    expect(response.headers.get("content-type")).toBe("application/problem+json; charset=utf-8");
    expect(await response.json()).toEqual({
      type: "https://errors.zebra.dev/validation_failed",
      status: 422,
      title: "Validation failed",
      instance: "/items/42",
      errors: [{ path: `${part}.${field}`, message: "Invalid value" }],
    });
    expect(handlerCalls).toBe(0);
  });

  test(`${name}: params and query issues retain aggregation and path prefixes`, async () => {
    const app = new Zebra();
    let handlerCalls = 0;
    app.implement(
      zc
        .post("/items/:id")
        .params(schema(() => resolve({ issues: [{ path: ["id"], message: "Invalid id" }] })))
        .query(schema(() => resolve({ issues: [{ path: ["page"], message: "Invalid page" }] }))),
      () => {
        handlerCalls++;
        return "unexpected";
      },
    );

    const response = await app.dispatch(request());
    expect(response.status).toBe(422);
    expect(await response.json()).toMatchObject({
      errors: [
        { path: "params.id", message: "Invalid id" },
        { path: "query.page", message: "Invalid page" },
      ],
    });
    expect(handlerCalls).toBe(0);
  });

  test(`${name}: transformed inputs reach the handler and output is stripped`, async () => {
    const app = new Zebra();
    let seen: unknown;
    let bodyValidations = 0;
    app.implement(
      zc
        .post("/items/:id")
        .params(
          schema((value) => {
            expect(value).toEqual({ id: "42" });
            return resolve({ value: { id: 42 } });
          }),
        )
        .query(
          schema((value) => {
            expect(value).toEqual({ page: "2" });
            return resolve({ value: { page: 2 } });
          }),
        )
        .body(
          schema((value) => {
            bodyValidations++;
            expect(value).toEqual({ title: " hello " });
            return resolve({ value: { title: "hello" } });
          }),
        )
        .output(
          schema((value) => {
            expect(value).toEqual({ id: 42, title: "hello", secret: "private" });
            return resolve({ value: { id: 42, title: "hello" } });
          }),
        ),
      async (req) => {
        const body = await req.body();
        expect(await req.body()).toBe(body);
        seen = { params: req.params, query: req.query, body };
        return { id: 42, title: "hello", secret: "private" };
      },
    );

    const response = await app.dispatch(request());
    expect(response.status).toBe(200);
    expect(seen).toEqual({ params: { id: 42 }, query: { page: 2 }, body: { title: "hello" } });
    expect(bodyValidations).toBe(1);
    expect(await response.json()).toEqual({ id: 42, title: "hello" });
  });

  for (const exposeStack of [false, true]) {
    test(`${name}: output issues return 500 with exposeStack=${exposeStack}`, async () => {
      const app = new Zebra({ errors: { exposeStack } });
      let handlerCalls = 0;
      app.implement(
        zc
          .post("/items/:id")
          .output(schema(() => resolve({ issues: [{ path: ["id"], message: "Invalid id" }] }))),
        () => {
          handlerCalls++;
          return { id: "invalid" };
        },
      );

      const response = await app.dispatch(request());
      expect(response.status).toBe(500);
      expect(await response.json()).toEqual({
        type: "https://errors.zebra.dev/output_validation_failed",
        status: 500,
        title: "Output validation failed",
        instance: "/items/42",
        ...(exposeStack ? { detail: [{ path: "id", message: "Invalid id" }] } : {}),
      });
      expect(handlerCalls).toBe(1);
    });
  }
}

for (const realm of ["current", "cross"] as const) {
  test.each(["params", "query", "body", "output"] as const)(
    `${realm} realm Promise: %s rejection becomes an internal error response`,
    async (part) => {
      const app = new Zebra();
      let handlerCalls = 0;
      const rejected = schema(() => {
        if (realm === "current") return Promise.reject(new Error("schema unavailable"));
        const promise: Promise<Result> = runInNewContext(
          'Promise.reject(new Error("schema unavailable"))',
        );
        expect(promise).not.toBeInstanceOf(Promise);
        return promise;
      });
      const procedure: ContractProcedure = zc.post("/items/:id")[part](rejected);
      app.implement(procedure, () => {
        handlerCalls++;
        return { id: 42 };
      });

      const response = await app.dispatch(request());
      expect(response.status).toBe(500);
      expect(response.headers.get("content-type")).toBe("application/problem+json; charset=utf-8");
      expect(await response.json()).toEqual({
        type: "https://errors.zebra.dev/internal",
        status: 500,
        title: "Internal Server Error",
        instance: "/items/42",
      });
      expect(handlerCalls).toBe(part === "output" ? 1 : 0);
    },
  );
}
