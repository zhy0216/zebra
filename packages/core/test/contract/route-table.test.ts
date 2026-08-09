import "reflect-metadata";
import { expect, test } from "bun:test";
import { zc } from "@zebra/contract";
import { z } from "zod";
import { Zebra } from "../../src/app/app.ts";
import { Container } from "../../src/di/container.ts";
import { token } from "../../src/di/token.ts";

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
    create: zc.post("/blogs").status(201).errors({ bad: { status: 400 } }).meta({ tags: ["x"] }),
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
