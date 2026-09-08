import { expect, expectTypeOf, spyOn, test } from "bun:test";
import { Zebra, type ZebraOptions } from "../../src/index.ts";

const signals = ["SIGINT", "SIGTERM"] as const;
const cases: [string, ZebraOptions][] = [
  ["omitted", {}],
  ["true", { signalHandlers: true }],
  ["false", { signalHandlers: false }],
];

function userSignals() {
  const listener = () => {};
  const once = () => {};
  for (const signal of signals) {
    process.on(signal, listener);
    process.once(signal, once);
  }
  const before = signals.map((signal) => process.rawListeners(signal));
  const changes: string[] = [];
  const added = (event: string | symbol) => {
    if (event === "SIGINT" || event === "SIGTERM") changes.push(`add:${event}`);
  };
  process.on("newListener", added);
  return {
    changes,
    expectListeners(extra = 0) {
      signals.forEach((signal, index) => {
        const current = process.rawListeners(signal);
        expect(current).toHaveLength(before[index]!.length + extra);
        expect(current.slice(0, before[index]!.length)).toEqual(before[index]!);
      });
    },
    close() {
      process.off("newListener", added);
      for (const signal of signals) {
        process.off(signal, listener);
        process.off(signal, once);
      }
    },
  };
}

test("core publicly types signalHandlers as an optional boolean", () => {
  expectTypeOf<ZebraOptions["signalHandlers"]>().toEqualTypeOf<boolean | undefined>();
  expectTypeOf<Pick<ZebraOptions, "signalHandlers">>().toEqualTypeOf<{
    signalHandlers?: boolean;
  }>();
  // @ts-expect-error signal ownership accepts only a boolean
  const invalid: ZebraOptions = { signalHandlers: "false" };
  void invalid;
});

test.each(cases)(
  "signalHandlers %s preserves user listeners across prepare, listen and stop",
  async (_name, options) => {
    const users = userSignals();
    const app = new Zebra(options);
    const entered = Promise.withResolvers<void>();
    const gate = Promise.withResolvers<void>();
    let shutdowns = 0;
    app.get("/", () => "ok");
    app.on("shutdown", async () => {
      shutdowns++;
      entered.resolve();
      await gate.promise;
    });
    try {
      users.expectListeners();
      await app.prepare();
      await app.prepare();
      users.expectListeners();
      expect(users.changes).toEqual([]);
      const { port } = await app.listen({ port: 0, hostname: "127.0.0.1" });
      users.expectListeners(options.signalHandlers === false ? 0 : 1);
      expect(await (await fetch(`http://127.0.0.1:${port}/`)).json()).toBe("ok");
      await expect(app.listen({ port: 0 })).rejects.toThrow("already listening");
      users.expectListeners(options.signalHandlers === false ? 0 : 1);
      const stopping = Promise.all([app.stop(), app.stop()]);
      await entered.promise;
      users.expectListeners();
      gate.resolve();
      await stopping;
      await app.stop();
      expect(shutdowns).toBe(1);
      users.expectListeners();
      expect(users.changes).toEqual(
        options.signalHandlers === false ? [] : ["add:SIGTERM", "add:SIGINT"],
      );
      await expect(fetch(`http://127.0.0.1:${port}/`)).rejects.toThrow();
    } finally {
      gate.resolve();
      await app.stop();
      users.close();
    }
  },
);

test.each(cases)(
  "signalHandlers %s leaves preparation-only cleanup free of signal changes",
  async (_name, options) => {
    const users = userSignals();
    const app = new Zebra(options);
    try {
      await app.prepare();
      await app.stop();
      users.expectListeners();
      expect(users.changes).toEqual([]);
    } finally {
      await app.stop();
      users.close();
    }
  },
);

test.each(cases)(
  "signalHandlers %s preserves cleanup failure caching and user listeners",
  async (_name, options) => {
    const users = userSignals();
    const app = new Zebra(options);
    const failure = new Error("shutdown failed");
    let shutdowns = 0;
    app.on("shutdown", () => {
      shutdowns++;
      throw failure;
    });
    try {
      await app.listen({ port: 0 });
      const results = await Promise.allSettled([app.stop(), app.stop()]);
      for (const result of results) {
        expect(result.status).toBe("rejected");
        if (result.status === "rejected") expect(result.reason).toBe(failure);
      }
      await expect(app.stop()).rejects.toBe(failure);
      expect(shutdowns).toBe(1);
      users.expectListeners();
      if (options.signalHandlers === false) expect(users.changes).toEqual([]);
    } finally {
      await app.stop().catch(() => {});
      users.close();
    }
  },
);

for (const stage of ["boot", "bind", "ready"] as const) {
  test.each(cases)(`signalHandlers %s cleans up after ${stage} failure`, async (_name, options) => {
    const users = userSignals();
    const app = new Zebra(options);
    const failure = new Error(`${stage} failed`);
    const serve = spyOn(Bun, "serve");
    const blocker =
      stage === "bind"
        ? Bun.serve({ port: 0, hostname: "127.0.0.1", fetch: () => new Response("occupied") })
        : undefined;
    let fail = true;
    if (stage !== "bind")
      app.on(stage, () => {
        if (fail) throw failure;
      });
    let shutdowns = 0;
    app.on("shutdown", () => void shutdowns++);
    try {
      const listening = app.listen({ port: blocker?.port ?? 0, hostname: "127.0.0.1" });
      if (stage === "bind") await expect(listening).rejects.toThrow();
      else await expect(listening).rejects.toBe(failure);
      users.expectListeners();
      if (options.signalHandlers === false || stage !== "ready") {
        expect(users.changes).toEqual([]);
      }
      if (stage === "ready") {
        const created = serve.mock.results.find((result) => result.type === "return");
        if (created?.type !== "return") throw new Error("listener was not created");
        await expect(fetch(`http://127.0.0.1:${created.value.port}/`)).rejects.toThrow();
        expect(shutdowns).toBe(1);
        await expect(app.listen({ port: 0 })).rejects.toThrow("has been stopped");
      } else {
        fail = false;
        await blocker?.stop(true);
        await app.listen({ port: 0, hostname: "127.0.0.1" });
        users.expectListeners(options.signalHandlers === false ? 0 : 1);
      }
      await app.stop();
      expect(shutdowns).toBe(1);
      users.expectListeners();
      if (options.signalHandlers === false) expect(users.changes).toEqual([]);
    } finally {
      const created = [...serve.mock.results];
      serve.mockRestore();
      await app.stop().catch(() => {});
      for (const result of created) {
        if (result.type === "return") await result.value.stop(true);
      }
      users.close();
    }
  });
}
