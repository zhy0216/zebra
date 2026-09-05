import "reflect-metadata";
import { expect, test } from "bun:test";
import { type StandardSchemaV1, zc } from "@zebra-web/contract";
import { z } from "zod";
import { Zebra } from "../../src/app/app.ts";
import { Container } from "../../src/di/container.ts";

test("routeTable returns frozen copies of registered routes", async () => {
  const app = new Zebra({ container: new Container() });
  app.get("/plain", async () => "ok");
  const proc = zc.get("/blogs/:id").output(z.string()).status(200);
  app.implement(proc, () => "x");

  const table = app.routeTable;
  expect(table.length).toBe(2);
  const contract = table.find((r) => r.path === "/blogs/:id")!;
  const plain = table.find((r) => r.path === "/plain")!;

  expect(contract.method).toBe("GET");
  expect(contract.contract).toBeDefined();
  expect(contract.contract!.version).toBe(1);
  expect(contract.contract!.path).toBe("/blogs/:id");
  expect(contract.contract!.method).toBe("GET");
  expect(contract.contract!.status).toBe(200);
  expect(contract.contract!.output).toBeDefined();
  expect(plain.contract).toBeUndefined();

  expect(Object.isFrozen(table)).toBe(true);
  expect(Object.isFrozen(contract)).toBe(true);
  expect(Object.isFrozen(contract.contract)).toBe(true);

  // frozen copies cannot be mutated — and the live route is untouched
  expect(() => {
    contract.path = "/mutated";
  }).toThrow();
  const res = await app.dispatch(new Request("http://x/blogs/1"));
  expect(res.status).toBe(200);
});

test("routeTable reflects bulk implement with def metadata", () => {
  const app = new Zebra({ container: new Container() });
  const router = {
    create: zc
      .post("/blogs")
      .status(201)
      .errors({ bad: { status: 400 } })
      .meta({ tags: ["x"] }),
    nested: { remove: zc.delete("/blogs/:id").status(204) },
  };
  app.implement(router, {
    create: () => ({ id: 1, title: "t", content: "c" }),
    nested: { remove: () => undefined },
  });

  const create = app.routeTable.find((r) => r.path === "/blogs" && r.method === "POST")!;
  const remove = app.routeTable.find((r) => r.path === "/blogs/:id" && r.method === "DELETE")!;
  expect(create.contract!.status).toBe(201);
  expect(create.contract!.errors).toEqual({ bad: { status: 400 } });
  expect(create.contract!.meta).toEqual({ tags: ["x"] });
  expect(remove.contract!.status).toBe(204);
  expect(remove.contract!.body).toBeUndefined();
});

test("routeTable isolates metadata, errors and MCP data without freezing the originals", () => {
  const app = new Zebra();
  const meta = { tags: ["before"], nested: { label: "before" } };
  const errors = { bad: { status: 400 } };
  const mcp = { name: "read", description: "Before", readOnly: true };
  const proc = zc.get("/data").meta(meta).errors(errors).mcp(mcp);
  app.implement(proc, () => "ok");

  const snapshot = app.routeTable[0]!.contract!;
  expect(snapshot.meta).not.toBe(meta);
  expect(snapshot.errors).not.toBe(proc.def.errors);
  expect(snapshot.mcp).not.toBe(mcp);
  for (const value of [
    snapshot.meta,
    snapshot.meta!.tags,
    snapshot.meta!.nested,
    snapshot.errors,
    snapshot.errors.bad,
    snapshot.mcp,
  ]) {
    expect(Object.isFrozen(value)).toBe(true);
  }
  for (const value of [meta, meta.tags, meta.nested, errors, errors.bad, proc.def.errors, mcp]) {
    expect(Object.isFrozen(value)).toBe(false);
  }

  meta.tags.push("after");
  meta.nested.label = "after";
  errors.bad.status = 409;
  proc.def.errors.bad = { status: 422 };
  mcp.description = "After";
  expect(snapshot.meta).toEqual({ tags: ["before"], nested: { label: "before" } });
  expect(snapshot.errors).toEqual({ bad: { status: 400 } });
  expect(snapshot.mcp).toEqual({ name: "read", description: "Before", readOnly: true });
  expect(app.routeTable[0]!.contract!.meta).toEqual(meta);
  expect(app.routeTable[0]!.contract!.errors.bad!.status).toBe(422);
  expect(app.routeTable[0]!.contract!.mcp!.description).toBe("After");
});

test("routeTable preserves cycles and shared data across contract fields and routes", () => {
  const app = new Zebra();
  const shared = { status: 409, label: "before" };
  const meta: Record<PropertyKey, unknown> = Object.create(null);
  const items: unknown[] = [meta];
  const symbol = Symbol("shared");
  meta.self = meta;
  meta.items = items;
  meta.left = shared;
  meta.right = shared;
  meta.__proto__ = shared;
  meta[symbol] = shared;
  Object.defineProperty(meta, "hidden", { value: shared });
  items.push(items, shared);
  const mcp = { name: "cyclic", description: "Shared data", extra: shared };
  const proc = zc.get("/cycle").meta(meta).errors({ bad: shared }).mcp(mcp);
  meta.contract = proc.def;
  app.implement(proc, () => "ok");
  app.implement(zc.get("/shared").meta(meta), () => "ok");

  const table = app.routeTable;
  const contract = table[0]!.contract!;
  const snapshot = contract.meta!;
  const copiedItems = snapshot.items as unknown[];
  expect(Object.getPrototypeOf(snapshot)).toBeNull();
  expect(snapshot).not.toBe(meta);
  expect(snapshot.self).toBe(snapshot);
  expect(snapshot.contract).toBe(contract);
  expect(copiedItems).not.toBe(items);
  expect(copiedItems[0]).toBe(snapshot);
  expect(copiedItems[1]).toBe(copiedItems);
  expect(copiedItems[2]).toBe(snapshot.left);
  expect(snapshot.left).not.toBe(shared);
  expect(snapshot.right).toBe(snapshot.left);
  expect(snapshot.__proto__).toBe(snapshot.left);
  expect(snapshot.hidden).toBe(snapshot.left);
  expect((snapshot as Record<PropertyKey, unknown>)[symbol]).toBe(snapshot.left);
  expect(snapshot.left).toBe(contract.errors.bad);
  expect(snapshot.left).toBe((contract.mcp as typeof mcp).extra);
  expect(table[1]!.contract!.meta).toBe(snapshot);
  for (const value of [snapshot, copiedItems, snapshot.left]) {
    expect(Object.isFrozen(value)).toBe(true);
  }
  shared.label = "after";
  items.push("after");
  expect(snapshot.left).toEqual({ status: 409, label: "before" });
  expect(copiedItems).toHaveLength(3);
});

test("routeTable leaves Zod schemas callable for input and output validation and transforms", async () => {
  const app = new Zebra();
  const params = z.object({ id: z.coerce.number() });
  const query = z.object({ add: z.coerce.number() });
  const body = z.object({ title: z.string().transform((value) => value.trim()) });
  const output = z.object({ id: z.number(), title: z.string() }).transform((value) => ({
    ...value,
    title: value.title.toUpperCase(),
  }));
  const proc = zc.post("/items/:id").params(params).query(query).body(body).output(output);
  let calls = 0;
  app.implement(proc, async (req) => {
    calls++;
    return { id: req.params.id + req.query.add, title: (await req.body()).title, extra: true };
  });
  app.implement(zc.get("/bad-output").output(output), () => ({ id: "bad" }) as never);

  const snapshot = app.routeTable[0]!.contract!;
  for (const key of ["params", "query", "body", "output"] as const) {
    expect(snapshot[key]).toBe(proc.def[key]);
    expect(Object.isFrozen(proc.def[key])).toBe(false);
    expect(Object.isFrozen(proc.def[key].def)).toBe(false);
  }
  const request = (path: string, payload: unknown) =>
    new Request(`http://x${path}`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(payload),
    });
  const success = await app.dispatch(request("/items/2?add=3", { title: " title ", extra: true }));
  expect(success.status).toBe(200);
  expect(await success.json()).toEqual({ id: 5, title: "TITLE" });
  const invalidParams = await app.dispatch(request("/items/no?add=no", { title: "ok" }));
  expect(invalidParams.status).toBe(422);
  expect(await invalidParams.json()).toMatchObject({
    errors: [
      expect.objectContaining({ path: "params.id" }),
      expect.objectContaining({ path: "query.add" }),
    ],
  });
  const invalidBody = await app.dispatch(request("/items/2?add=3", { title: 1 }));
  expect(invalidBody.status).toBe(422);
  expect(await invalidBody.json()).toMatchObject({ errors: [{ path: "body.title" }] });
  expect(calls).toBe(1);
  const invalidOutput = await app.dispatch(new Request("http://x/bad-output"));
  expect(invalidOutput.status).toBe(500);
  expect(await invalidOutput.json()).toMatchObject({
    type: "https://errors.zebra.dev/output_validation_failed",
  });
});

test("routeTable treats custom schemas, functions and external instances as opaque references", async () => {
  const app = new Zebra();
  let standardReads = 0;
  const state = { calls: 0 };
  const standard: StandardSchemaV1.Props<string, string> = {
    version: 1,
    vendor: "test",
    validate(value) {
      state.calls++;
      return typeof value === "string"
        ? { value: value.toUpperCase() }
        : { issues: [{ message: "Expected string" }] };
    },
  };
  const schema = {
    state,
    get "~standard"() {
      standardReads++;
      return standard;
    },
    get internal() {
      throw new Error("schema internals must not be inspected");
    },
  };
  class External {
    state = { calls: 0 };
    get internal() {
      throw new Error("external internals must not be inspected");
    }
  }
  const external = new External();
  class ExternalArray extends Array<string> {
    first() {
      return this[0];
    }
  }
  const externalArray = new ExternalArray("item");
  const callback = Object.assign(() => ++external.state.calls, { state: { mutable: true } });
  const date = new Date(0);
  const bytes = new Uint8Array([1]);
  const meta = { schema, external, externalArray, callback, date, bytes };
  app.implement(zc.post("/custom").body(schema).output(schema).meta(meta), (req) => req.body());

  const snapshot = app.routeTable[0]!.contract!;
  expect(standardReads).toBe(0);
  expect(snapshot.body).toBe(schema);
  expect(snapshot.output).toBe(schema);
  for (const [key, value] of Object.entries(meta)) {
    expect(snapshot.meta![key]).toBe(value);
    expect(Object.isFrozen(value)).toBe(false);
  }
  expect(Object.isFrozen(standard)).toBe(false);
  expect(Object.isFrozen(state)).toBe(false);
  expect(Object.isFrozen(callback.state)).toBe(false);
  expect((snapshot.meta!.externalArray as ExternalArray).first()).toBe("item");
  expect((snapshot.meta!.callback as typeof callback)()).toBe(1);
  const request = (value: unknown) =>
    new Request("http://x/custom", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(value),
    });
  const success = await app.dispatch(request("ok"));
  expect(success.status).toBe(200);
  expect(await success.json()).toBe("OK");
  const failure = await app.dispatch(request(1));
  expect(failure.status).toBe(422);
  expect(await failure.json()).toMatchObject({
    errors: [{ path: "body.", message: "Expected string" }],
  });
  expect(state.calls).toBe(3);
  expect(standardReads).toBe(3);
});
