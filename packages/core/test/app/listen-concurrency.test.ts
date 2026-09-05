import { expect, spyOn, test } from "bun:test";
import { Zebra } from "../../src/app/app.ts";
import type { Disposable } from "../../src/di/disposable.ts";
import { token } from "../../src/di/token.ts";

function monitorServers() {
  const serve = spyOn(Bun, "serve");
  return {
    serve,
    async close() {
      const results = [...serve.mock.results];
      serve.mockRestore();
      for (const result of results) {
        if (result.type === "return") await result.value.stop(true);
      }
    },
  };
}

test("concurrent listens during async boot reject the duplicate and create one server", async () => {
  const app = new Zebra();
  const servers = monitorServers();
  const entered = Promise.withResolvers<void>();
  const gate = Promise.withResolvers<void>();
  let boots = 0;
  let readies = 0;
  app.get("/", () => "ok");
  app.on("boot", async () => {
    boots++;
    entered.resolve();
    await gate.promise;
  });
  app.on("ready", () => void readies++);
  const first = app.listen({ port: 0, hostname: "127.0.0.1" });
  let results: Promise<PromiseSettledResult<{ port: number }>[]> | undefined;
  try {
    await entered.promise;
    results = Promise.allSettled([first, app.listen({ port: 0, hostname: "127.0.0.1" })]);
    gate.resolve();
    const [initial, duplicate] = await results;
    expect(initial?.status).toBe("fulfilled");
    expect(duplicate?.status).toBe("rejected");
    if (duplicate?.status === "rejected")
      expect(duplicate.reason.message).toBe("Zebra is already listening");
    expect(boots).toBe(1);
    expect(readies).toBe(1);
    expect(servers.serve).toHaveBeenCalledTimes(1);
    if (initial?.status === "fulfilled") {
      const url = `http://127.0.0.1:${initial.value.port}`;
      expect(await (await fetch(url)).json()).toBe("ok");
      await app.stop();
      await expect(fetch(url)).rejects.toThrow();
    }
  } finally {
    gate.resolve();
    await results;
    await first.catch(() => {});
    await app.stop().catch(() => {});
    await servers.close();
  }
});

test("a listen invoked from a boot hook rejects without starting a nested server", async () => {
  const app = new Zebra();
  const servers = monitorServers();
  let nestedResult: unknown;
  let boots = 0;
  app.on("boot", async () => {
    if (++boots === 1) {
      nestedResult = await app.listen({ port: 0 }).catch((error: unknown) => error);
    }
  });
  try {
    await app.listen({ port: 0 });
    expect(nestedResult).toBeInstanceOf(Error);
    expect(nestedResult).toMatchObject({ message: "Zebra is already listening" });
    expect(boots).toBe(1);
    expect(servers.serve).toHaveBeenCalledTimes(1);
  } finally {
    await app.stop().catch(() => {});
    await servers.close();
  }
});

test("stop while boot is suspended prevents any later server creation or ready event", async () => {
  const app = new Zebra();
  const servers = monitorServers();
  const entered = Promise.withResolvers<void>();
  const gate = Promise.withResolvers<void>();
  let ready = false;
  let shutdowns = 0;
  app.on("boot", async () => {
    entered.resolve();
    await gate.promise;
  });
  app.on("ready", () => void (ready = true));
  app.on("shutdown", () => void shutdowns++);
  const listening = app.listen({ port: 0 });
  const result = Promise.allSettled([listening]);
  try {
    await entered.promise;
    await app.stop();
    gate.resolve();
    expect((await result)[0]).toMatchObject({
      status: "rejected",
      reason: { message: "Zebra has been stopped and cannot listen again" },
    });
    expect(servers.serve).not.toHaveBeenCalled();
    expect(ready).toBe(false);
    expect(shutdowns).toBe(1);
    await expect(app.listen({ port: 0 })).rejects.toThrow("has been stopped");
  } finally {
    gate.resolve();
    await result;
    await app.stop().catch(() => {});
    await servers.close();
  }
});

test("stop while ready is suspended closes the port and prevents a successful listen result", async () => {
  const app = new Zebra();
  const servers = monitorServers();
  const entered = Promise.withResolvers<void>();
  const gate = Promise.withResolvers<void>();
  app.get("/", () => "ok");
  app.on("ready", async () => {
    entered.resolve();
    await gate.promise;
  });
  const result = Promise.allSettled([app.listen({ port: 0, hostname: "127.0.0.1" })]);
  try {
    await entered.promise;
    const created = servers.serve.mock.results[0];
    if (created?.type !== "return") throw new Error("server was not created");
    const url = `http://127.0.0.1:${created.value.port}`;
    expect(await (await fetch(url)).json()).toBe("ok");
    await app.stop();
    await expect(fetch(url)).rejects.toThrow();
    gate.resolve();
    expect((await result)[0]).toMatchObject({
      status: "rejected",
      reason: { message: "Zebra has been stopped and cannot listen again" },
    });
    expect(servers.serve).toHaveBeenCalledTimes(1);
  } finally {
    gate.resolve();
    await result;
    await app.stop().catch(() => {});
    await servers.close();
  }
});

test.each(["boot", "ready"] as const)(
  "a %s hook can await stop without deadlocking startup",
  async (event) => {
    const app = new Zebra();
    const servers = monitorServers();
    let shutdowns = 0;
    app.on(event, async () => {
      await app.stop();
    });
    app.on("shutdown", () => void shutdowns++);
    try {
      await expect(app.listen({ port: 0 })).rejects.toThrow("has been stopped");
      expect(shutdowns).toBe(1);
      expect(servers.serve).toHaveBeenCalledTimes(event === "boot" ? 0 : 1);
    } finally {
      await app.stop().catch(() => {});
      await servers.close();
    }
  },
);

test.each(["successful", "failing"])(
  "ready failure is rethrown after %s cleanup",
  async (cleanup) => {
    const cleanupFails = cleanup === "failing";
    const app = new Zebra();
    const servers = monitorServers();
    const readyFailure = new Error("ready failed");
    const cleanupFailure = new Error("cleanup failed");
    const report = spyOn(console, "error").mockImplementation(() => {});
    let disposed = 0;
    let shutdowns = 0;
    let url: string | undefined;
    app.injectValue(token<Disposable>("resource"), {
      dispose() {
        disposed++;
        if (cleanupFails) throw cleanupFailure;
      },
    });
    app.on("ready", () => {
      const created = servers.serve.mock.results[0];
      if (created?.type === "return") url = `http://127.0.0.1:${created.value.port}`;
      throw readyFailure;
    });
    app.on("shutdown", () => void shutdowns++);
    try {
      await expect(app.listen({ port: 0, hostname: "127.0.0.1" })).rejects.toBe(readyFailure);
      expect(disposed).toBe(1);
      expect(shutdowns).toBe(1);
      expect(servers.serve).toHaveBeenCalledTimes(1);
      expect(url).toBeDefined();
      if (url !== undefined) await expect(fetch(url)).rejects.toThrow();
      if (cleanupFails) {
        expect(report).toHaveBeenCalledWith(
          "[zebra] shutdown after ready failure failed:",
          cleanupFailure,
        );
      } else {
        expect(report).not.toHaveBeenCalled();
      }
      await expect(app.listen({ port: 0 })).rejects.toThrow("has been stopped");
    } finally {
      await app.stop().catch(() => {});
      report.mockRestore();
      await servers.close();
    }
  },
);

test("a failed boot releases the startup guard so listen can be retried", async () => {
  const app = new Zebra();
  const servers = monitorServers();
  const failure = new Error("boot failed once");
  let boots = 0;
  app.on("boot", () => {
    if (++boots === 1) throw failure;
  });
  try {
    await expect(app.listen({ port: 0 })).rejects.toBe(failure);
    expect(servers.serve).not.toHaveBeenCalled();
    await app.listen({ port: 0 });
    expect(boots).toBe(2);
    expect(servers.serve).toHaveBeenCalledTimes(1);
    await expect(app.listen({ port: 0 })).rejects.toThrow("already listening");
  } finally {
    await app.stop().catch(() => {});
    await servers.close();
  }
});

test("a failed Bun.serve releases the startup guard without rerunning successful boot", async () => {
  const app = new Zebra();
  const servers = monitorServers();
  const failure = new Error("server bind failed once");
  let boots = 0;
  app.on("boot", () => void boots++);
  servers.serve.mockImplementationOnce(() => {
    throw failure;
  });
  try {
    await expect(app.listen({ port: 0 })).rejects.toBe(failure);
    await app.listen({ port: 0 });
    expect(boots).toBe(1);
    expect(servers.serve).toHaveBeenCalledTimes(2);
  } finally {
    await app.stop().catch(() => {});
    await servers.close();
  }
});
