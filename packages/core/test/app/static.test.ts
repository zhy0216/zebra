import "reflect-metadata";
import { resolve } from "node:path";
import { test, expect } from "bun:test";
import { Zebra } from "../../src/app/app.ts";
import { Container } from "../../src/di/container.ts";

const fixtures = resolve(import.meta.dir, "fixtures/public");

test("app.static serves a file", async () => {
  const app = new Zebra({ container: new Container() });
  app.static("/assets", fixtures, { index: "index.html", maxAge: 60 });

  const res = await app.dispatch(new Request("http://x/assets/hello.txt"));
  expect(res.status).toBe(200);
  expect(await res.text()).toBe("static hello\n");
});

test("app.static blocks traversal", async () => {
  const app = new Zebra({ container: new Container() });
  app.static("/assets", fixtures, { index: "index.html", maxAge: 60 });
  const res = await app.dispatch(new Request("http://x/assets/..%2Fpackage.json"));
  expect(res.status).toBe(403);
});
