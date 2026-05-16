import "reflect-metadata";
import { expect, test } from "bun:test";
import { Zebra } from "../../src/app/app.ts";
import { Container } from "../../src/di/container.ts";

test("boot handlers run in registration order before listen completes", async () => {
  const order: string[] = [];
  const app = new Zebra({ container: new Container() });
  app.on("boot", async () => {
    order.push("a");
  });
  app.on("boot", async () => {
    order.push("b");
  });
  app.on("ready", () => {
    order.push("ready");
  });

  await app.listen({ port: 0 });
  expect(order).toEqual(["a", "b", "ready"]);
  await app.stop();
});

test("shutdown handlers run on stop", async () => {
  const order: string[] = [];
  const app = new Zebra({ container: new Container() });
  app.on("shutdown", async () => {
    order.push("shutdown");
  });

  await app.listen({ port: 0 });
  await app.stop();
  expect(order).toEqual(["shutdown"]);
});
