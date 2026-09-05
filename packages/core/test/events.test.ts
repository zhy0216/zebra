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

test("once removes its registration before calling the handler and permits reuse", async () => {
  const bus = new EventBus<TestEvents>();
  const counts: number[] = [];
  const listening: boolean[] = [];
  const handler = () => {
    counts.push(bus.listenerCount("count"));
    listening.push(bus.hasAnyOf(["ready", "count"]));
  };

  for (let n = 1; n <= 2; n++) {
    bus.once("count", handler);
    expect(bus.listenerCount("count")).toBe(1);
    expect(bus.hasAnyOf(["count"])).toBe(true);
    await bus.emit("count", { n });
    expect(bus.listenerCount("count")).toBe(0);
    expect(bus.hasAnyOf(["ready", "count"])).toBe(false);
  }
  expect(counts).toEqual([0, 0]);
  expect(listening).toEqual([false, false]);

  bus.on("count", handler);
  await bus.emit("count", { n: 3 });
  await bus.emit("count", { n: 4 });
  expect(counts).toEqual([0, 0, 1, 1]);
});

test.each(["on", "once"] as const)(
  "a once handler can re-register itself with %s for future emits",
  async (registration) => {
    const bus = new EventBus<TestEvents>();
    const seen: number[] = [];
    const handler = ({ n }: TestEvents["count"]) => {
      seen.push(n);
      if (n === 1) bus[registration]("count", handler);
    };
    bus.once("count", handler);

    await bus.emit("count", { n: 1 });
    expect(seen).toEqual([1]);
    expect(bus.listenerCount("count")).toBe(1);
    await bus.emit("count", { n: 2 });
    await bus.emit("count", { n: 3 });
    expect(seen).toEqual(registration === "once" ? [1, 2] : [1, 2, 3]);
    expect(bus.listenerCount("count")).toBe(registration === "once" ? 0 : 1);
  },
);

test("interleaved emits consume a shared once entry before its async handler completes", async () => {
  const bus = new EventBus<TestEvents>();
  const resumeFirst = Promise.withResolvers<void>();
  const onceEntered = Promise.withResolvers<void>();
  const resumeOnce = Promise.withResolvers<void>();
  const seen: number[] = [];
  const completed: number[] = [];
  bus.on("count", async ({ n }) => {
    if (n === 1) await resumeFirst.promise;
  });
  bus.once("count", async ({ n }) => {
    seen.push(n);
    onceEntered.resolve();
    await resumeOnce.promise;
  });
  bus.on("count", ({ n }) => {
    completed.push(n);
  });

  const first = bus.emit("count", { n: 1 });
  const second = bus.emit("count", { n: 2 });
  try {
    await onceEntered.promise;
    expect(seen).toEqual([2]);
    expect(bus.listenerCount("count")).toBe(2);
    expect(completed).toEqual([]);

    resumeFirst.resolve();
    await first;
    expect(seen).toEqual([2]);
    expect(completed).toEqual([1]);

    resumeOnce.resolve();
    await second;
    expect(seen).toEqual([2]);
    expect(completed).toEqual([1, 2]);
  } finally {
    resumeFirst.resolve();
    resumeOnce.resolve();
    await Promise.allSettled([first, second]);
  }
});

test("recursive emits share once consumption and preserve ordinary listener order", async () => {
  const bus = new EventBus<TestEvents>();
  const order: string[] = [];
  bus.on("count", async ({ n }) => {
    order.push(`first:${n}`);
    if (n === 1) await bus.emit("count", { n: 2 });
  });
  bus.once("count", async ({ n }) => {
    order.push(`once:${n}`);
    if (n === 2) await bus.emit("count", { n: 3 });
  });
  bus.on("count", ({ n }) => {
    order.push(`last:${n}`);
  });

  await bus.emit("count", { n: 1 });
  expect(order).toEqual(["first:1", "first:2", "once:2", "first:3", "last:3", "last:2", "last:1"]);
  expect(bus.listenerCount("count")).toBe(2);
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

test.each(["throw", "reject"] as const)(
  "a once listener that fails via %s is removed and only aborts the current emit",
  async (failure) => {
    const bus = new EventBus<TestEvents>();
    const error = new Error("once failed");
    let calls = 0;
    let followingCalls = 0;
    const following = () => {
      followingCalls++;
    };
    bus.once("count", () => {
      calls++;
      if (failure === "throw") throw error;
      return Promise.resolve().then(() => {
        throw error;
      });
    });
    bus.on("count", following);

    await expect(bus.emit("count", { n: 1 })).rejects.toBe(error);
    expect(calls).toBe(1);
    expect(followingCalls).toBe(0);
    expect(bus.listenerCount("count")).toBe(1);
    await bus.emit("count", { n: 2 });
    expect(calls).toBe(1);
    expect(followingCalls).toBe(1);
    bus.off("count", following);
    expect(bus.listenerCount("count")).toBe(0);
    expect(bus.hasAnyOf(["count"])).toBe(false);
  },
);

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

test("off of a later listener preserves its current snapshot invocation", async () => {
  const bus = new EventBus<TestEvents>();
  const order: string[] = [];
  const second = () => {
    order.push("second");
  };
  bus.on("count", () => {
    order.push("first");
    bus.off("count", second);
  });
  bus.on("count", second);

  await bus.emit("count", { n: 1 });
  expect(order).toEqual(["first", "second"]);
  expect(bus.listenerCount("count")).toBe(1);
  await bus.emit("count", { n: 2 });
  expect(order).toEqual(["first", "second", "first"]);
});

test.each(["event", "all"] as const)(
  "removeAllListeners(%s) preserves the snapshot and defers new listeners",
  async (scope) => {
    const bus = new EventBus<TestEvents>();
    const order: string[] = [];
    const late = () => {
      order.push("late");
    };
    bus.on("ready", () => {
      order.push("ready");
    });
    bus.on("count", () => {
      order.push("first");
      if (scope === "event") bus.removeAllListeners("count");
      else bus.removeAllListeners();
      bus.on("count", late);
    });
    bus.on("count", () => {
      order.push("second");
    });
    bus.once("count", () => {
      order.push("once");
    });

    await bus.emit("count", { n: 1 });
    expect(order).toEqual(["first", "second", "once"]);
    expect(bus.listenerCount("count")).toBe(1);
    expect(bus.listenerCount("ready")).toBe(scope === "event" ? 1 : 0);
    await bus.emit("count", { n: 2 });
    expect(order).toEqual(["first", "second", "once", "late"]);
    await bus.emit("ready");
    expect(order).toEqual(
      scope === "event"
        ? ["first", "second", "once", "late", "ready"]
        : ["first", "second", "once", "late"],
    );
  },
);

test.each(["off", "event", "all"] as const)(
  "%s during an async pause affects new emits but preserves the paused snapshot",
  async (removal) => {
    const bus = new EventBus<TestEvents>();
    const entered = Promise.withResolvers<void>();
    const resume = Promise.withResolvers<void>();
    const order: string[] = [];
    const second = ({ n }: TestEvents["count"]) => {
      order.push(`second:${n}`);
    };
    bus.on("count", async ({ n }) => {
      order.push(`first:${n}`);
      if (n === 1) {
        entered.resolve();
        await resume.promise;
      }
    });
    bus.on("count", second);

    const pending = bus.emit("count", { n: 1 });
    try {
      await entered.promise;
      if (removal === "off") bus.off("count", second);
      else if (removal === "event") bus.removeAllListeners("count");
      else bus.removeAllListeners();
      expect(bus.listenerCount("count")).toBe(removal === "off" ? 1 : 0);

      await bus.emit("count", { n: 2 });
      const beforeResume = removal === "off" ? ["first:1", "first:2"] : ["first:1"];
      expect(order).toEqual(beforeResume);
      resume.resolve();
      await pending;
      expect(order).toEqual([...beforeResume, "second:1"]);
    } finally {
      resume.resolve();
      await Promise.allSettled([pending]);
    }
  },
);

test.each([
  ["on", "on"],
  ["on", "once"],
  ["once", "on"],
  ["once", "once"],
] as const)(
  "replacing %s with %s for the same handler preserves both registration identities",
  async (original, replacement) => {
    const bus = new EventBus<TestEvents>();
    const order: string[] = [];
    const second = ({ n }: TestEvents["count"]) => {
      order.push(`second:${n}`);
    };
    bus.on("count", ({ n }) => {
      order.push(`first:${n}`);
      if (n === 1) {
        bus.off("count", second);
        bus[replacement]("count", second);
      }
    });
    bus[original]("count", second);
    bus.on("count", ({ n }) => {
      order.push(`last:${n}`);
    });

    await bus.emit("count", { n: 1 });
    expect(order).toEqual(["first:1", "second:1", "last:1"]);
    expect(bus.listenerCount("count")).toBe(3);
    order.length = 0;
    await bus.emit("count", { n: 2 });
    expect(order).toEqual(["first:2", "last:2", "second:2"]);
    expect(bus.listenerCount("count")).toBe(replacement === "once" ? 2 : 3);
    order.length = 0;
    await bus.emit("count", { n: 3 });
    expect(order).toEqual(
      replacement === "once" ? ["first:3", "last:3"] : ["first:3", "last:3", "second:3"],
    );
  },
);

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
