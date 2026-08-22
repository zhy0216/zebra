import "reflect-metadata";
import { expect, test } from "bun:test";
import { Zebra } from "../../src/app/app.ts";
import type { RegisteredRoute } from "../../src/app/types.ts";
import { Container } from "../../src/di/container.ts";
import { HttpError } from "../../src/http/errors.ts";
import type { Middleware } from "../../src/middleware/types.ts";

declare global {
  interface ZebraEvents {
    "user.created": { id: string; email: string };
  }
}

test("lifecycle hooks and EventBus are the same store", async () => {
  const app = new Zebra();
  const order: string[] = [];
  app.on("boot", () => {
    order.push("boot");
  });
  app.events.on("ready", () => {
    order.push("ready");
  });
  app.on("shutdown", () => {
    order.push("shutdown");
  });
  await app.listen({ port: 0 });
  await app.stop();
  expect(order).toEqual(["boot", "ready", "shutdown"]);
});

test("events accessor exposes listener counts for the same bus", () => {
  const app = new Zebra();
  const handler = () => {};
  app.on("boot", handler);
  expect(app.events.listenerCount("boot")).toBe(1);
  app.off("boot", handler);
  expect(app.events.listenerCount("boot")).toBe(0);
});

test("before.request fires after routing and before middleware; after.request last", async () => {
  const app = new Zebra();
  const order: string[] = [];
  app.on("before.request", (ev) => {
    order.push("before.request");
    expect(ev.route?.path).toBe("/hello");
  });
  app.use(async (_req, next) => {
    order.push("mw");
    return next();
  });
  app.get("/hello", () => {
    order.push("handler");
    return new Response("ok");
  });
  app.on("after.request", (ev) => {
    order.push("after.request");
    expect(ev.response.status).toBe(200);
    expect(typeof ev.duration).toBe("number");
  });
  await app.listen({ port: 0 });
  const res = await app.dispatch(new Request("http://x/hello"));
  expect(await res.text()).toBe("ok");
  expect(order).toEqual(["before.request", "mw", "handler", "after.request"]);
  await app.stop();
});

test("before.request carries the matched route, or undefined on 404", async () => {
  const app = new Zebra();
  const routes: Array<RegisteredRoute | undefined> = [];
  app.on("before.request", (ev) => {
    routes.push(ev.route);
  });
  app.get("/hello", () => "ok");
  await app.listen({ port: 0 });
  await app.dispatch(new Request("http://x/hello"));
  await app.dispatch(new Request("http://x/missing"));
  expect(routes[0]?.path).toBe("/hello");
  expect(routes[1]).toBeUndefined();
  await app.stop();
});

test("request.error observes the original error and Problem+Json is preserved", async () => {
  const app = new Zebra();
  const errors: unknown[] = [];
  app.on("request.error", (ev) => {
    errors.push(ev.error);
    expect(typeof ev.duration).toBe("number");
  });
  app.get("/boom", () => {
    throw new HttpError(401, "unauthorized", "Nope");
  });
  await app.listen({ port: 0 });
  const res = await app.dispatch(new Request("http://x/boom"));
  expect(res.status).toBe(401);
  expect(res.headers.get("content-type")).toContain("application/problem+json");
  expect(errors).toHaveLength(1);
  expect(errors[0]).toBeInstanceOf(HttpError);
  await app.stop();
});

test("request.error and after.request both fire for the same failing request", async () => {
  const app = new Zebra();
  const seen: string[] = [];
  app.on("request.error", () => {
    seen.push("error");
  });
  app.on("after.request", (ev) => {
    seen.push(`after:${ev.response.status}`);
  });
  app.get("/boom", () => {
    throw new Error("kaboom");
  });
  await app.listen({ port: 0 });
  const res = await app.dispatch(new Request("http://x/boom"));
  expect(res.status).toBe(500);
  expect(seen).toEqual(["error", "after:500"]);
  await app.stop();
});

test("middleware before/after events fire around each middleware in plan order", async () => {
  const app = new Zebra();
  const order: string[] = [];
  const mw = async (_req: any, next: any) => next();
  app.on("before.middleware", (ev) => {
    order.push(`before:${ev.index}`);
  });
  app.on("after.middleware", (ev) => {
    order.push(`after:${ev.index}`);
    expect(ev.response.status).toBe(200);
  });
  app.use(mw);
  app.use(mw);
  app.get("/hello", () => "ok");
  await app.listen({ port: 0 });
  const res = await app.dispatch(new Request("http://x/hello"));
  expect(res.status).toBe(200);
  expect(order).toEqual(["before:0", "before:1", "after:1", "after:0"]);
  await app.stop();
});

test("middleware.error fires and existing error handling is preserved", async () => {
  const app = new Zebra();
  const seen: unknown[] = [];
  app.on("middleware.error", (ev) => {
    seen.push(ev.error);
    expect(ev.index).toBe(0);
    expect(ev.middleware).toBe(boomMw);
  });
  const boomMw: Middleware = async () => {
    throw new Error("mw boom");
  };
  app.use(boomMw);
  app.get("/hello", () => "ok");
  await app.listen({ port: 0 });
  const res = await app.dispatch(new Request("http://x/hello"));
  expect(res.status).toBe(500);
  expect(res.headers.get("content-type")).toContain("application/problem+json");
  expect(seen).toHaveLength(1);
  await app.stop();
});

test("middleware events carry the original function reference, not a name", async () => {
  const app = new Zebra();
  const mw = async (_req: any, next: any) => next();
  const observed: Array<Middleware> = [];
  app.on("before.middleware", (ev) => {
    observed.push(ev.middleware);
  });
  app.use(mw);
  app.get("/hello", () => "ok");
  await app.listen({ port: 0 });
  await app.dispatch(new Request("http://x/hello"));
  expect(observed[0]).toBe(mw);
  await app.stop();
});

test("request timeout semantics still apply with request event listeners", async () => {
  const app = new Zebra({ requestTimeout: 20 });
  app.on("before.request", () => {});
  app.on("request.error", () => {});
  app.get("/slow", async () => {
    await Bun.sleep(200);
    return "never";
  });
  await app.listen({ port: 0 });
  const res = await app.dispatch(new Request("http://x/slow"));
  expect(res.status).toBe(504);
  await app.stop();
});

test("custom events can on/once/off/emit at runtime", async () => {
  const app = new Zebra();
  const seen: string[] = [];
  const handler = (u: { id: string; email: string }) => {
    seen.push(`once:${u.id}`);
  };
  app.once("user.created", handler);
  await app.emit("user.created", { id: "u1", email: "a@example.com" });
  await app.emit("user.created", { id: "u2", email: "b@example.com" });
  expect(seen).toEqual(["once:u1"]);

  const onHandler = (u: { id: string; email: string }) => {
    seen.push(`on:${u.id}`);
  };
  app.on("user.created", onHandler);
  await app.emit("user.created", { id: "u3", email: "c@example.com" });
  expect(seen).toEqual(["once:u1", "on:u3"]);
  app.off("user.created", onHandler);
  await app.emit("user.created", { id: "u4", email: "d@example.com" });
  expect(seen).toEqual(["once:u1", "on:u3"]);
});

test("custom event listeners can be registered after listen()", async () => {
  const app = new Zebra();
  app.get("/", () => "ok");
  await app.listen({ port: 0 });
  let fired = 0;
  app.on("user.created", () => {
    fired++;
  });
  await app.emit("user.created", { id: "u1", email: "a@example.com" });
  expect(fired).toBe(1);
  await app.stop();
});

test("no event listeners leaves the zero-cost fast path intact", async () => {
  const app = new Zebra();
  app.get("/hello", () => new Response("ok"));
  await app.listen({ port: 0 });
  const res = await app.dispatch(new Request("http://x/hello"));
  expect(res.status).toBe(200);
  expect(await res.text()).toBe("ok");
  await app.stop();
});

test("a throwing before.request listener is converted to Problem+Json", async () => {
  const app = new Zebra();
  app.on("before.request", () => {
    throw new Error("listener boom");
  });
  app.get("/hello", () => "ok");
  await app.listen({ port: 0 });
  const res = await app.dispatch(new Request("http://x/hello"));
  expect(res.status).toBe(500);
  expect(res.headers.get("content-type")).toContain("application/problem+json");
  await app.stop();
});

test("events bus works on the default container app too", async () => {
  const app = new Zebra({ container: new Container() });
  let fired = 0;
  app.on("user.created", () => {
    fired++;
  });
  await app.emit("user.created", { id: "u1", email: "a@example.com" });
  expect(fired).toBe(1);
});
