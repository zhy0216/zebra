import { expect, spyOn, test } from "bun:test";
import { Zebra } from "../../src/app/app.ts";
import { AppInternals } from "../../src/app/internals.ts";
import { SessionScopeRegistry } from "../../src/app/scope-registry.ts";
import { Container } from "../../src/di/container.ts";
import type { Disposable } from "../../src/di/disposable.ts";
import { token } from "../../src/di/token.ts";
import type { WsData } from "../../src/ws/types.ts";

function internals(container: Container): AppInternals {
  return new AppInternals({
    container,
    sessionResolver: (request) => request.headers.get("x-session") ?? undefined,
    sessionTtl: 60_000,
    gracePeriod: 1_000,
    wsSession: undefined,
    requestTimeout: undefined,
    exposeStack: false,
    bodyOpts: {
      maxSize: 1024,
      json: { limit: 1024 },
      form: { limit: 1024 },
      multipart: { limit: 1024, maxFiles: 1, maxFileSize: 1024 },
    },
  });
}

function causes(error: unknown): unknown[] {
  return error instanceof AggregateError ? error.errors.flatMap(causes) : [error];
}

async function openSession(registry: SessionScopeRegistry, id: string) {
  return registry.createRequestScopes(new Request("http://x", { headers: { "x-session": id } }));
}

test("bulk session cleanup cancels all idle timers before awaiting a failing resource", async () => {
  const root = new Container();
  const registry = new SessionScopeRegistry(root, (req) => req.headers.get("x-session")!, 60_000);
  const resource = token<Disposable>("resource");
  const entered = Promise.withResolvers<void>();
  const gate = Promise.withResolvers<void>();
  const failure = new Error("first session failed");
  const order: number[] = [];
  let nextId = 0;
  root
    .bind(resource)
    .toFactory(() => {
      const id = ++nextId;
      return {
        async dispose() {
          order.push(id);
          if (id === 1) {
            entered.resolve();
            await gate.promise;
            throw failure;
          }
        },
      };
    })
    .inSessionScope();
  const schedule = spyOn(globalThis, "setTimeout");
  const clear = spyOn(globalThis, "clearTimeout");
  let cleanup: Promise<unknown> | undefined;
  try {
    for (const id of ["a", "b"]) {
      const scopes = await openSession(registry, id);
      scopes.request.resolve(resource);
      await registry.disposeScopes(scopes);
    }
    const timers = schedule.mock.results.map((result) => result.value);
    expect(timers).toHaveLength(2);
    cleanup = registry.disposeAll().catch((error: unknown) => error);
    await entered.promise;
    for (const timer of timers) {
      expect(clear.mock.calls.some(([actual]) => actual === timer)).toBe(true);
    }
    gate.resolve();
    expect(await cleanup).toBe(failure);
    expect(order).toEqual([1, 2]);
    await registry.disposeAll();
    expect(order).toEqual([1, 2]);
  } finally {
    gate.resolve();
    await cleanup;
    await registry.disposeAll().catch(() => {});
    clear.mockRestore();
    schedule.mockRestore();
  }
});

test("bulk cleanup waits for a session disposal that already started", async () => {
  const root = new Container();
  const registry = new SessionScopeRegistry(root, () => "a", 60_000);
  const entered = Promise.withResolvers<void>();
  const gate = Promise.withResolvers<void>();
  const failure = new Error("in-progress session failed");
  const resource = token<Disposable>("resource");
  root
    .bind(resource)
    .toFactory(() => ({
      async dispose() {
        entered.resolve();
        await gate.promise;
        throw failure;
      },
    }))
    .inSessionScope();
  const scopes = await openSession(registry, "a");
  scopes.request.resolve(resource);
  await registry.disposeScopes(scopes);
  const single = registry.disposeSession("a");
  await entered.promise;
  const results = Promise.allSettled([single, registry.disposeAll()]);
  gate.resolve();
  expect(await results).toEqual([
    { status: "rejected", reason: failure },
    { status: "rejected", reason: failure },
  ]);
});

test("request and anonymous session cleanup failures are both reported, including thrown undefined", async () => {
  const root = new Container();
  const registry = new SessionScopeRegistry(root, undefined, 60_000);
  const requestResource = token<Disposable>("request resource");
  const sessionResource = token<Disposable>("session resource");
  const sessionFailure = new Error("anonymous session failed");
  root
    .bind(requestResource)
    .toFactory(() => ({
      dispose() {
        throw undefined;
      },
    }))
    .inRequestScope();
  root
    .bind(sessionResource)
    .toFactory(() => ({
      dispose() {
        throw sessionFailure;
      },
    }))
    .inSessionScope();
  const scopes = await registry.createRequestScopes(new Request("http://x"));
  scopes.request.resolve(requestResource);
  scopes.request.resolve(sessionResource);
  const results = await Promise.allSettled([registry.disposeScopes(scopes)]);
  expect(results[0]?.status).toBe("rejected");
  if (results[0]?.status === "rejected") {
    expect(causes(results[0].reason)).toEqual([undefined, sessionFailure]);
  }
  await registry.disposeScopes(scopes);
});

test("idle expiry reports cleanup failure without leaving an unhandled rejection or session", async () => {
  const root = new Container();
  const registry = new SessionScopeRegistry(root, () => "a", 1);
  const resource = token<Disposable>("resource");
  const failure = new Error("expiry cleanup failed");
  const logged = Promise.withResolvers<unknown[]>();
  const report = spyOn(console, "error").mockImplementation((...args: unknown[]) =>
    logged.resolve(args),
  );
  let calls = 0;
  root
    .bind(resource)
    .toFactory(() => ({
      dispose() {
        calls++;
        throw failure;
      },
    }))
    .inSessionScope();
  try {
    const scopes = await openSession(registry, "a");
    scopes.request.resolve(resource);
    await registry.disposeScopes(scopes);
    expect(await logged.promise).toEqual(["[zebra] session cleanup failed:", failure]);
    await registry.disposeAll();
    expect(calls).toBe(1);
    expect(report).toHaveBeenCalledTimes(1);
  } finally {
    await registry.disposeAll().catch(() => {});
    report.mockRestore();
  }
});

test("stop closes the server and attempts sessions, root and shutdown despite multiple failures", async () => {
  const root = new Container();
  const app = internals(root);
  const order: string[] = [];
  const sessionFailure = new Error("session failed");
  const rootFailure = new Error("root failed");
  const hookFailure = new Error("shutdown failed");
  const resource = token<Disposable>("session resource");
  let nextId = 0;
  root
    .bind(resource)
    .toFactory(() => {
      const id = ++nextId;
      return {
        dispose() {
          order.push(`session ${id}`);
          if (id === 1) throw sessionFailure;
        },
      };
    })
    .inSessionScope();
  root.bind(token<Disposable>("root resource")).toValue({
    dispose() {
      order.push("root");
      throw rootFailure;
    },
  });
  app.events.on("shutdown", () => {
    order.push("shutdown");
    throw hookFailure;
  });
  const server = Bun.serve<WsData>({
    port: 0,
    hostname: "127.0.0.1",
    fetch: () => new Response("ok"),
  });
  const url = `http://127.0.0.1:${server.port}`;
  app.server = server;
  try {
    expect(await (await fetch(url)).text()).toBe("ok");
    for (const id of ["a", "b"]) {
      const scopes = await openSession(app.sessions, id);
      scopes.request.resolve(resource);
      await app.sessions.disposeScopes(scopes);
    }
    const results = await Promise.allSettled([app.stop(), app.stop()]);
    for (const result of results) {
      expect(result.status).toBe("rejected");
      if (result.status === "rejected") {
        expect(causes(result.reason)).toEqual([sessionFailure, rootFailure, hookFailure]);
      }
    }
    expect(order).toEqual(["session 1", "session 2", "root", "shutdown"]);
    await expect(fetch(url)).rejects.toThrow();
    await app.stop().catch(() => {});
    expect(order).toEqual(["session 1", "session 2", "root", "shutdown"]);
  } finally {
    await server.stop(true);
    await app.stop().catch(() => {});
    await app.sessions.disposeAll().catch(() => {});
    await root.dispose().catch(() => {});
  }
});

test("a graceful server stop failure forces closure and still reaches shutdown", async () => {
  const root = new Container();
  const app = internals(root);
  const failure = new Error("graceful stop failed");
  let cleaned = false;
  let shutdown = false;
  root.bind(token<Disposable>("resource")).toValue({ dispose: () => void (cleaned = true) });
  app.events.on("shutdown", () => void (shutdown = true));
  const server = Bun.serve<WsData>({
    port: 0,
    hostname: "127.0.0.1",
    fetch: () => new Response("ok"),
  });
  const stopServer = server.stop.bind(server);
  const stop = spyOn(server, "stop").mockImplementation((force) => {
    if (!force) throw failure;
    return stopServer(force);
  });
  app.server = server;
  try {
    await expect(app.stop()).rejects.toBe(failure);
    expect(stop).toHaveBeenCalledWith(true);
    expect(cleaned).toBe(true);
    expect(shutdown).toBe(true);
  } finally {
    stop.mockRestore();
    await stopServer(true);
    await root.dispose().catch(() => {});
  }
});

test("forced server stop failure is reported together with the graceful failure after cleanup", async () => {
  const root = new Container();
  const app = internals(root);
  const gracefulFailure = new Error("graceful stop failed");
  const forceFailure = new Error("forced stop failed");
  let cleaned = false;
  let shutdown = false;
  root.bind(token<Disposable>("resource")).toValue({ dispose: () => void (cleaned = true) });
  app.events.on("shutdown", () => void (shutdown = true));
  const server = Bun.serve<WsData>({
    port: 0,
    hostname: "127.0.0.1",
    fetch: () => new Response("ok"),
  });
  const stopServer = server.stop.bind(server);
  const stop = spyOn(server, "stop").mockImplementation((force) =>
    Promise.reject(force ? forceFailure : gracefulFailure),
  );
  app.server = server;
  try {
    const results = await Promise.allSettled([app.stop()]);
    expect(results[0]?.status).toBe("rejected");
    if (results[0]?.status === "rejected") {
      expect(causes(results[0].reason)).toEqual([gracefulFailure, forceFailure]);
    }
    expect(cleaned).toBe(true);
    expect(shutdown).toBe(true);
  } finally {
    stop.mockRestore();
    await stopServer(true);
    await root.dispose().catch(() => {});
  }
});

test("signal-triggered shutdown reports cleanup errors and removes its signal listeners", async () => {
  const root = new Container();
  const app = internals(root);
  const failure = new Error("signal cleanup failed");
  root.bind(token<Disposable>("resource")).toValue({
    dispose() {
      throw failure;
    },
  });
  const logged = Promise.withResolvers<unknown[]>();
  const report = spyOn(console, "error").mockImplementation((...args: unknown[]) =>
    logged.resolve(args),
  );
  const previous = new Set(process.listeners("SIGTERM"));
  app.installSignalHandlers();
  const handler = process.listeners("SIGTERM").find((listener) => !previous.has(listener));
  try {
    expect(handler).toBeDefined();
    // Invoke only this app's listener, without delivering an OS signal or
    // triggering another app's shutdown handlers in the test process.
    handler?.("SIGTERM");
    expect(await logged.promise).toEqual(["[zebra] shutdown failed:", failure]);
    expect(process.listeners("SIGTERM")).not.toContain(handler);
    expect(process.listeners("SIGINT")).not.toContain(handler);
    expect(report).toHaveBeenCalledTimes(1);
  } finally {
    await app.stop().catch(() => {});
    report.mockRestore();
  }
});

test("request cancellation still answers 504 when request resource cleanup fails", async () => {
  const app = new Zebra({ requestTimeout: 5_000 });
  const abort = new AbortController();
  const entered = Promise.withResolvers<void>();
  const resource = token<Disposable>("resource");
  let calls = 0;
  app.injectFactoryRequest(resource, () => ({
    dispose() {
      calls++;
      throw new Error("request cleanup failed");
    },
  }));
  app.get("/", { resource }, async () => {
    entered.resolve();
    return new Promise<Response>(() => {});
  });
  try {
    const response = app.dispatch(new Request("http://x/", { signal: abort.signal }));
    await entered.promise;
    abort.abort();
    expect((await response).status).toBe(504);
    expect(calls).toBe(1);
  } finally {
    abort.abort();
    await app.stop();
  }
});
