import "reflect-metadata";
import { expect, test } from "bun:test";
import { Zebra } from "../../src/app/app.ts";
import { Container } from "../../src/di/container.ts";
import { injectable } from "../../src/di/decorators.ts";

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

@injectable()
class SingletonResource {
  constructor(private readonly order: string[]) {}
  dispose() {
    this.order.push("dispose");
  }
}

test("stop disposes singleton resources before shutdown hooks", async () => {
  const order: string[] = [];
  const app = new Zebra();
  app.injectFactorySingleton(SingletonResource, () => new SingletonResource(order));
  app.get("/", { resource: SingletonResource }, async () => "ok");
  app.on("shutdown", () => {
    order.push("shutdown");
  });

  const { port } = await app.listen({ port: 0 });
  await fetch(`http://localhost:${port}/`);
  await app.stop();
  expect(order).toEqual(["dispose", "shutdown"]);
});

test("listen freezes routes, middleware, hooks, and direct container bindings", async () => {
  const container = new Container();
  const app = new Zebra({ container });
  app.get("/", async () => "ok");
  await app.listen({ port: 0 });

  expect(() => app.get("/late", async () => "late")).toThrow(/routes after app.listen/);
  expect(() => app.use(async (_req, next) => next())).toThrow(/middleware after app.listen/);
  expect(() => app.on("ready", () => {})).toThrow(/lifecycle hooks after app.listen/);
  expect(() => container.bind(SingletonResource).toSelf()).toThrow(/bindings after app.listen/);
  await app.stop();
});

test("stop waits for in-flight requests within the grace period", async () => {
  let markStarted: (() => void) | undefined;
  let release: (() => void) | undefined;
  const started = new Promise<void>((resolve) => {
    markStarted = resolve;
  });
  const blocked = new Promise<void>((resolve) => {
    release = resolve;
  });
  const app = new Zebra({ gracePeriod: 1_000 });
  app.get("/slow", async () => {
    markStarted?.();
    await blocked;
    return "done";
  });

  const { port } = await app.listen({ port: 0 });
  const response = fetch(`http://localhost:${port}/slow`);
  await started;

  let stopped = false;
  const stopping = app.stop().then(() => {
    stopped = true;
  });
  await Bun.sleep(10);
  expect(stopped).toBe(false);

  release?.();
  expect(await (await response).json()).toBe("done");
  await stopping;
  expect(stopped).toBe(true);
});
