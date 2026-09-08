import { expect, expectTypeOf, spyOn, test } from "bun:test";
import { UnboundTokenError, Zebra, token } from "../../src/index.ts";

test("public prepare coalesces concurrent boot, freezes registration and dispatches without a listener", async () => {
  const app = new Zebra();
  const entered = Promise.withResolvers<void>();
  const gate = Promise.withResolvers<void>();
  const trace: string[] = [];
  const resource = token<{ name: string; dispose(): void }>("resource");
  const signals = [process.listenerCount("SIGINT"), process.listenerCount("SIGTERM")];
  const serve = spyOn(Bun, "serve");
  app.on("boot", async () => {
    trace.push("boot");
    entered.resolve();
    await gate.promise;
    app.injectValue(resource, {
      name: "zebra",
      dispose() {
        trace.push("dispose");
      },
    });
  });
  app.on("ready", () => {
    trace.push("ready");
  });
  app.on("shutdown", () => {
    trace.push("shutdown");
  });
  app.get("/hello/:id", { resource }, (req, { resource }) => `${resource.name}:${req.params.id}`);
  const first = app.prepare();
  expectTypeOf(first).toEqualTypeOf<Promise<void>>();
  try {
    await entered.promise;
    const second = app.prepare();
    gate.resolve();
    await Promise.all([first, second]);
    await app.prepare();
    expect(trace).toEqual(["boot"]);
    expect(serve).not.toHaveBeenCalled();
    expect([process.listenerCount("SIGINT"), process.listenerCount("SIGTERM")]).toEqual(signals);
    expect(() => app.get("/late", () => "late")).toThrow("Cannot register");
    expect(() => app.injectValue(token("late"), 1)).toThrow("Cannot register");
    const response = await app.dispatch(new Request("http://local/hello/42"));
    expect(response.status).toBe(200);
    expect(await response.json()).toBe("zebra:42");
    await app.stop();
    await app.stop();
    expect(trace).toEqual(["boot", "dispose", "shutdown"]);
  } finally {
    gate.resolve();
    await first.catch(() => {});
    serve.mockRestore();
    await app.stop();
  }
});

test("listen after public prepare reuses boot and emits ready only after the real listener starts", async () => {
  const app = new Zebra();
  const trace: string[] = [];
  app.on("boot", () => {
    trace.push("boot");
  });
  app.on("ready", () => {
    trace.push("ready");
  });
  app.get("/", () => "ok");
  try {
    await app.prepare();
    expect(trace).toEqual(["boot"]);
    const { port } = await app.listen({ port: 0 });
    await app.prepare();
    expect(trace).toEqual(["boot", "ready"]);
    expect(await (await fetch(`http://127.0.0.1:${port}/`)).json()).toBe("ok");
  } finally {
    await app.stop();
  }
});

test("public prepare propagates boot and graph errors and permits a corrected retry", async () => {
  const app = new Zebra();
  const value = token<string>("value");
  let boots = 0;
  const failure = new Error("boot failed once");
  app.on("boot", () => {
    if (++boots === 1) throw failure;
  });
  app.get("/", { value }, (_req, { value }) => value);
  try {
    await expect(app.prepare()).rejects.toBe(failure);
    await expect(app.prepare()).rejects.toBeInstanceOf(UnboundTokenError);
    app.injectValue(value, "fixed");
    await app.prepare();
    await app.prepare();
    expect(boots).toBe(3);
    expect(await (await app.dispatch(new Request("http://local/"))).json()).toBe("fixed");
  } finally {
    await app.stop();
  }
});
