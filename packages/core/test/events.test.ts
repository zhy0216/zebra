import { expect, test } from "bun:test";
import { EventBus, EventEmitter } from "../src/events.ts";

interface TestEvents {
  ready: undefined;
  "user.created": { id: string; email: string };
  count: { n: number };
}

test("on + emit deliver the payload to the listener", async () => {
  const bus = new EventBus<TestEvents>();
  let received: { id: string; email: string } | undefined;
  bus.on("user.created", (payload) => {
    received = payload;
  });
  const payload = { id: "u1", email: "a@example.com" };
  await bus.emit("user.created", payload);
  expect(received).toBe(payload);
});

test("undefined-payload events take no arguments", async () => {
  const bus = new EventBus<TestEvents>();
  let fired = 0;
  bus.on("ready", () => {
    fired++;
  });
  await bus.emit("ready");
  expect(fired).toBe(1);
});

test("listeners run in registration order and are awaited serially", async () => {
  const bus = new EventBus<TestEvents>();
  const order: string[] = [];
  bus.on("count", async () => {
    await Bun.sleep(5);
    order.push("a");
  });
  bus.on("count", () => {
    order.push("b");
  });
  await bus.emit("count", { n: 1 });
  expect(order).toEqual(["a", "b"]);
});

test("async listeners are awaited before emit resolves", async () => {
  const bus = new EventBus<TestEvents>();
  let done = false;
  bus.on("count", async () => {
    await Bun.sleep(10);
    done = true;
  });
  await bus.emit("count", { n: 1 });
  expect(done).toBe(true);
});

test("once fires exactly once", async () => {
  const bus = new EventBus<TestEvents>();
  let calls = 0;
  bus.once("count", () => {
    calls++;
  });
  await bus.emit("count", { n: 1 });
  await bus.emit("count", { n: 2 });
  expect(calls).toBe(1);
});

test("off removes a plain listener", async () => {
  const bus = new EventBus<TestEvents>();
  let calls = 0;
  const handler = () => {
    calls++;
  };
  bus.on("count", handler);
  await bus.emit("count", { n: 1 });
  bus.off("count", handler);
  await bus.emit("count", { n: 2 });
  expect(calls).toBe(1);
});

test("off removes a once listener by its original handler", async () => {
  const bus = new EventBus<TestEvents>();
  let calls = 0;
  const handler = () => {
    calls++;
  };
  bus.once("count", handler);
  bus.off("count", handler);
  await bus.emit("count", { n: 1 });
  await bus.emit("count", { n: 2 });
  expect(calls).toBe(0);
});

test("registering the same handler twice is deduplicated", async () => {
  const bus = new EventBus<TestEvents>();
  let calls = 0;
  const handler = () => {
    calls++;
  };
  bus.on("count", handler);
  bus.on("count", handler);
  await bus.emit("count", { n: 1 });
  expect(calls).toBe(1);
});

test("removeAllListeners clears one event or the whole bus", async () => {
  const bus = new EventBus<TestEvents>();
  let a = 0;
  let b = 0;
  bus.on("count", () => {
    a++;
  });
  bus.on("ready", () => {
    b++;
  });
  bus.removeAllListeners("count");
  await bus.emit("count", { n: 1 });
  await bus.emit("ready");
  expect(a).toBe(0);
  expect(b).toBe(1);
  bus.removeAllListeners();
  await bus.emit("ready");
  expect(b).toBe(1);
});

test("listenerCount reports live registrations", async () => {
  const bus = new EventBus<TestEvents>();
  expect(bus.listenerCount("count")).toBe(0);
  const h1 = () => {};
  const h2 = () => {};
  bus.on("count", h1);
  bus.on("count", h2);
  expect(bus.listenerCount("count")).toBe(2);
  bus.off("count", h1);
  expect(bus.listenerCount("count")).toBe(1);
});

test("a throwing listener rejects emit and stops the remaining listeners", async () => {
  const bus = new EventBus<TestEvents>();
  const order: string[] = [];
  bus.on("count", () => {
    order.push("a");
    throw new Error("boom");
  });
  bus.on("count", () => {
    order.push("b");
  });
  await expect(bus.emit("count", { n: 1 })).rejects.toThrow("boom");
  expect(order).toEqual(["a"]);
});

test("a rejected async listener stops the remaining listeners", async () => {
  const bus = new EventBus<TestEvents>();
  const order: string[] = [];
  bus.on("count", async () => {
    order.push("a");
    throw new Error("async boom");
  });
  bus.on("count", () => {
    order.push("b");
  });
  await expect(bus.emit("count", { n: 1 })).rejects.toThrow("async boom");
  expect(order).toEqual(["a"]);
});

test("a throwing once listener never fires again", async () => {
  const bus = new EventBus<TestEvents>();
  let calls = 0;
  bus.once("count", () => {
    calls++;
    throw new Error("boom");
  });
  await expect(bus.emit("count", { n: 1 })).rejects.toThrow("boom");
  await expect(bus.emit("count", { n: 2 })).resolves.toBeUndefined();
  expect(calls).toBe(1);
});

test("listeners added or removed during emit only affect the next emit", async () => {
  const bus = new EventBus<TestEvents>();
  const order: string[] = [];
  const late = () => {
    order.push("late");
  };
  const first = () => {
    order.push("first");
    bus.on("count", late);
    bus.off("count", first);
  };
  bus.on("count", first);
  await bus.emit("count", { n: 1 });
  expect(order).toEqual(["first"]);
  await bus.emit("count", { n: 2 });
  expect(order).toEqual(["first", "late"]);
});

test("emit with no listeners resolves immediately and creates no state", async () => {
  const bus = new EventBus<TestEvents>();
  await expect(bus.emit("count", { n: 1 })).resolves.toBeUndefined();
  expect(bus.listenerCount("count")).toBe(0);
});

test("off for an unregistered event is a no-op", async () => {
  const bus = new EventBus<TestEvents>();
  bus.off("count", () => {});
  await expect(bus.emit("count", { n: 1 })).resolves.toBeUndefined();
});

test("EventEmitter is a compatible alias for EventBus", () => {
  expect(EventEmitter).toBe(EventBus);
  const bus = new EventEmitter<TestEvents>();
  let fired = false;
  bus.on("ready", () => {
    fired = true;
  });
  void bus.emit("ready").then(() => {
    expect(fired).toBe(true);
  });
});
