import "reflect-metadata";
import { expect, test } from "bun:test";
import { Zebra } from "../../src/app/app.ts";

test("new Zebra() with no opts boots and serves a route with no deps", async () => {
  const app = new Zebra();
  app.get("/ping", async () => "pong");
  const { port } = await app.listen({ port: 0 });
  const res = await fetch(`http://localhost:${port}/ping`);
  expect(await res.text()).toBe('"pong"');
  await app.stop();
});

test("new Zebra({}) works the same as new Zebra()", async () => {
  const app = new Zebra({});
  app.get("/ping", async () => "pong");
  const { port } = await app.listen({ port: 0 });
  const res = await fetch(`http://localhost:${port}/ping`);
  expect(await res.text()).toBe('"pong"');
  await app.stop();
});
