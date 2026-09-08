import "reflect-metadata";
import { expect, spyOn, test } from "bun:test";
import { Zebra } from "../../src/app/app.ts";
import { HttpError } from "../../src/http/errors.ts";
import { middleware } from "../../src/middleware/helper.ts";
import type { Middleware } from "../../src/middleware/types.ts";

test.each([false, true])(
  "a middleware promise accessor failure stays a structured response (booted: %s)",
  async (booted) => {
    const app = new Zebra();
    const failure = new HttpError(409, "custom_then", "Promise accessor failed");
    app.use(() => {
      const result = Promise.resolve(new Response("unexpected success"));
      // biome-ignore lint/suspicious/noThenProperty: Preserve the public error response for custom promises.
      Object.defineProperty(result, "then", {
        get() {
          throw failure;
        },
      });
      return result;
    });
    app.get("/", () => new Response("unused"));
    try {
      if (booted) await app.listen({ port: 0 });
      const res = await app.dispatch(new Request("http://x/"));
      expect(res.status).toBe(409);
      expect(res.headers.get("content-type")).toContain("application/problem+json");
      expect(await res.json()).toMatchObject({ type: "https://errors.zebra.dev/custom_then" });
    } finally {
      await app.stop();
    }
  },
);

for (const booted of [false, true]) {
  test.each([0, 5])(
    `dispatch assimilates handler results and errors with %d middleware (booted: ${booted})`,
    async (layers) => {
      const app = new Zebra();
      for (let i = 0; i < layers; i++) app.use((_req, next) => next());
      const failure = new HttpError(409, "original", "Original failure");
      app.get("/sync", () => new Response("sync"));
      app.get("/async", async () => new Response("async"));
      app.get("/thenable", () => ({
        // biome-ignore lint/suspicious/noThenProperty: Handler results must assimilate thenables.
        then(resolve: (value: unknown) => void) {
          // biome-ignore lint/suspicious/noThenProperty: Cover recursive thenable assimilation.
          resolve({ then: (resolve: (value: unknown) => void) => resolve({ value: 7 }) });
        },
      }));
      app.get("/throw", () => {
        throw failure;
      });
      app.get("/reject", () => Promise.reject(failure));
      app.get("/then-reject", () => ({
        // biome-ignore lint/suspicious/noThenProperty: Preserve thenable rejections.
        then(_resolve: unknown, reject: (error: unknown) => void) {
          reject(failure);
        },
      }));
      app.get("/then-getter", () => ({
        // biome-ignore lint/suspicious/noThenProperty: Preserve accessor failures during assimilation.
        get then() {
          throw failure;
        },
      }));
      app.get("/serialize", () => ({
        // biome-ignore lint/suspicious/noThenProperty: Handler results must assimilate thenables.
        then(resolve: (value: unknown) => void) {
          resolve(1n);
        },
      }));
      app.get("/await-conversion", () => {
        const value = { ready: false };
        queueMicrotask(() => {
          value.ready = true;
        });
        return value;
      });
      try {
        if (booted) await app.listen({ port: 0 });
        for (const path of ["sync", "async"]) {
          const res = await app.dispatch(new Request(`http://x/${path}`));
          expect(await res.text()).toBe(path);
        }
        const thenable = await app.dispatch(new Request("http://x/thenable"));
        expect(await thenable.json()).toEqual({ value: 7 });
        const converted = await app.dispatch(new Request("http://x/await-conversion"));
        expect(await converted.json()).toEqual({ ready: true });
        for (const path of ["throw", "reject", "then-reject", "then-getter", "serialize"]) {
          const pending = app.dispatch(new Request(`http://x/${path}`));
          expect(pending).toBeInstanceOf(Promise);
          const res = await pending;
          expect(res.status).toBe(path === "serialize" ? 500 : 409);
          expect(res.headers.get("content-type")).toContain("application/problem+json");
          expect(await res.json()).toMatchObject({
            type: `https://errors.zebra.dev/${path === "serialize" ? "response_serialization" : "original"}`,
          });
        }
      } finally {
        await app.stop();
      }
    },
  );
}

test.each([false, true])("listener add/remove/once stays live (booted: %s)", async (booted) => {
  const app = new Zebra();
  const calls: string[] = [];
  const mw: Middleware = (_req, next) => next();
  app.use(mw);
  app.get("/", () => new Response("ok"));
  const before = () => {
    calls.push("request");
  };
  const after = () => {
    calls.push("after");
  };
  const onMiddleware = (event: ZebraEvents["before.middleware"]) => {
    expect(event.middleware).toBe(mw);
    expect(event.index).toBe(0);
    calls.push("middleware");
  };
  app.on("before.request", before);
  app.once("after.request", after);
  app.once("before.middleware", onMiddleware);
  try {
    if (booted) await app.listen({ port: 0 });
    const dispatch = async () => {
      expect(await (await app.dispatch(new Request("http://x/"))).text()).toBe("ok");
    };
    await dispatch();
    app.off("before.request", before);
    app.once("before.middleware", onMiddleware);
    app.once("after.request", after);
    await dispatch();
    const emit = spyOn(app.events, "emit");
    try {
      await dispatch();
      expect(emit).not.toHaveBeenCalled();
    } finally {
      emit.mockRestore();
    }
    app.on("before.middleware", onMiddleware);
    await dispatch();
    app.off("before.middleware", onMiddleware);
    await dispatch();
    expect(calls).toEqual(["request", "middleware", "after", "middleware", "after", "middleware"]);
  } finally {
    await app.stop();
  }
});

test("short circuit middleware does not resolve downstream middleware or handler dependencies", async () => {
  const app = new Zebra();
  let resolutions = 0;
  class Resource {
    constructor() {
      resolutions++;
    }
  }
  app.injectRequest(Resource);
  app.use(async () => new Response("short"));
  app.use(middleware({ resource: Resource }, (_req, next) => next()));
  app.get("/", { resource: Resource }, () => new Response("unexpected"));
  try {
    await app.listen({ port: 0 });
    expect(await (await app.dispatch(new Request("http://x/"))).text()).toBe("short");
    expect(resolutions).toBe(0);
  } finally {
    await app.stop();
  }
});

test("middleware listeners added during dispatch observe later original functions and DI timing", async () => {
  const app = new Zebra();
  const order: string[] = [];
  const seen: Middleware[] = [];
  class Resource {
    constructor() {
      order.push("resolve");
    }
  }
  app.injectRequest(Resource);
  const dependent = middleware({ resource: Resource }, (_req, next, { resource }) => {
    expect(resource).toBeInstanceOf(Resource);
    order.push("dependent");
    return next();
  });
  app.use((_req, next) => {
    app.once("before.middleware", (event) => {
      order.push(`before:${event.index}`);
      seen.push(event.middleware);
    });
    return next();
  });
  app.use(dependent);
  app.get("/", () => new Response("ok"));
  try {
    await app.listen({ port: 0 });
    expect(await (await app.dispatch(new Request("http://x/"))).text()).toBe("ok");
    expect(order).toEqual(["resolve", "before:1", "dependent"]);
    expect(seen).toEqual([dependent]);
  } finally {
    await app.stop();
  }
});

test.each(["handler", "completion"])("stop drains outstanding direct %s work", async (phase) => {
  const app = new Zebra({ gracePeriod: 1_000 });
  const started = Promise.withResolvers<void>();
  const release = Promise.withResolvers<void>();
  const wait = () => {
    started.resolve();
    return release.promise;
  };
  app.get("/", async () => {
    if (phase === "handler") await wait();
    return new Response("ok");
  });
  if (phase === "completion") app.on("after.request", wait);
  await app.listen({ port: 0 });
  const pending = app.dispatch(new Request("http://x/"));
  let stopped = false;
  await started.promise;
  const stopping = app.stop().then(() => {
    stopped = true;
  });
  try {
    await new Promise<void>((resolve) => setImmediate(resolve));
    expect(stopped).toBe(false);
    release.resolve();
    expect(await (await pending).text()).toBe("ok");
    await stopping;
    expect(stopped).toBe(true);
  } finally {
    release.resolve();
    await pending;
    await stopping;
  }
});
