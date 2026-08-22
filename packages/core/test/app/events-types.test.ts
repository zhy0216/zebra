import "reflect-metadata";
import { expectTypeOf, test } from "bun:test";
import { Zebra } from "../../src/app/app.ts";
import type { ZebraEventMap } from "../../src/app/lifecycle.ts";
import type { RegisteredRoute } from "../../src/app/types.ts";
import { type EventArgs, EventBus } from "../../src/events.ts";
import type { ZebraRequest } from "../../src/http/request.ts";

declare global {
  interface ZebraEvents {
    "user.created": { id: string; email: string };
  }
}

test("EventArgs distinguishes undefined payloads from real payloads", () => {
  expectTypeOf<EventArgs<undefined>>().toEqualTypeOf<[]>();
  expectTypeOf<EventArgs<{ id: string }>>().toEqualTypeOf<[{ id: string }]>();
});

test("built-in lifecycle events carry undefined payloads", () => {
  const app = new Zebra();
  app.on("boot", () => {});
  app.on("ready", async () => {});
  app.once("shutdown", () => {});
  // undefined-payload events take no argument at the call site.
  app.emit("boot");
  // @ts-expect-error an undefined-payload event must not accept an argument
  app.emit("boot", {});
  // @ts-expect-error a payload-bearing emit on a lifecycle event is rejected
  app.emit("ready", "x");
});

test("request events carry typed payloads", () => {
  const app = new Zebra();
  app.on("before.request", (ev) => {
    expectTypeOf(ev.request).toEqualTypeOf<ZebraRequest>();
    expectTypeOf(ev.route).toEqualTypeOf<RegisteredRoute | undefined>();
  });
  app.on("after.request", (ev) => {
    expectTypeOf(ev.response).toEqualTypeOf<Response>();
    expectTypeOf(ev.duration).toEqualTypeOf<number>();
    expectTypeOf(ev.route).toEqualTypeOf<RegisteredRoute | undefined>();
  });
  app.on("request.error", (ev) => {
    expectTypeOf(ev.error).toEqualTypeOf<unknown>();
    expectTypeOf(ev.duration).toEqualTypeOf<number>();
  });
});

test("middleware events carry typed payloads", () => {
  const app = new Zebra();
  app.on("before.middleware", (ev) => {
    expectTypeOf(ev.middleware).toBeFunction();
    expectTypeOf(ev.index).toEqualTypeOf<number>();
    expectTypeOf(ev.request).toEqualTypeOf<ZebraRequest>();
  });
  app.on("after.middleware", (ev) => {
    expectTypeOf(ev.response).toEqualTypeOf<Response>();
    expectTypeOf(ev.duration).toEqualTypeOf<number>();
    expectTypeOf(ev.middleware).toBeFunction();
  });
  app.on("middleware.error", (ev) => {
    expectTypeOf(ev.error).toEqualTypeOf<unknown>();
    expectTypeOf(ev.middleware).toBeFunction();
    expectTypeOf(ev.index).toEqualTypeOf<number>();
  });
});

test("globally augmented custom events are usable on the app", async () => {
  const app = new Zebra();
  app.on("user.created", (user) => {
    expectTypeOf(user).toEqualTypeOf<{ id: string; email: string }>();
  });
  await app.emit("user.created", { id: "u1", email: "a@example.com" });
  // @ts-expect-error undeclared event name is rejected
  app.on("nope", () => {});
  // @ts-expect-error undeclared event name is rejected
  app.emit("nope");
  // @ts-expect-error wrong payload type is rejected
  app.emit("user.created", { id: 1 });
  // @ts-expect-error wrong listener parameter type is rejected
  app.on("user.created", (_user: { id: number }) => {});
});

test("on / once / off accept the same handler type", async () => {
  const app = new Zebra();
  const handler = (user: { id: string; email: string }) => {
    expectTypeOf(user).toEqualTypeOf<{ id: string; email: string }>();
  };
  app.on("user.created", handler);
  app.once("user.created", handler);
  app.off("user.created", handler);
  await app.emit("user.created", { id: "u1", email: "a@example.com" });
});

test("emit returns Promise<void> and lifecycle freeze keeps custom events open", () => {
  const app = new Zebra();
  expectTypeOf(app.emit("user.created", { id: "u1", email: "a@example.com" })).toMatchTypeOf<
    Promise<void>
  >();
  app.on("user.created", () => {});
});

test("EventBus is independently typed with the same single-payload model", () => {
  const bus = new EventBus<{ "order.paid": { amount: number } }>();
  bus.on("order.paid", (payload) => {
    expectTypeOf(payload).toEqualTypeOf<{ amount: number }>();
  });
  bus.once("order.paid", (payload) => {
    expectTypeOf(payload).toEqualTypeOf<{ amount: number }>();
  });
  bus.emit("order.paid", { amount: 42 });
  bus.removeAllListeners();
  bus.listenerCount("order.paid");
  // @ts-expect-error undeclared event name is rejected
  bus.on("nope", () => {});
  // @ts-expect-error wrong payload is rejected
  bus.emit("order.paid", { amount: "42" });
});

test("ZebraEventMap is the same table as the global ZebraEvents", () => {
  const eventNames: (keyof ZebraEventMap)[] = [
    "boot",
    "ready",
    "shutdown",
    "before.request",
    "after.request",
    "request.error",
    "before.middleware",
    "after.middleware",
    "middleware.error",
    "user.created",
  ];
  expectTypeOf(eventNames).toMatchTypeOf<(keyof ZebraEventMap)[]>();
});
