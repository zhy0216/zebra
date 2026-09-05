import { describe, expect, test } from "bun:test";
import { Zebra } from "@zebra-web/core";
import { type SessionStore, createSession, getSession, sessionMiddleware } from "../src/index.ts";

function deferred<T>() {
  let resolve!: (value: T | PromiseLike<T>) => void;
  let reject!: (reason: unknown) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

class ControlledStore implements SessionStore {
  value: unknown;
  reads = 0;
  readonly writes: unknown[] = [];
  readonly events: string[] = [];
  onGet?: () => Promise<unknown>;
  onSet?: (data: unknown, index: number) => Promise<void>;
  onDestroy?: () => Promise<void>;

  constructor(value?: unknown) {
    this.value = value;
  }

  async get(): Promise<unknown> {
    this.reads++;
    return this.onGet === undefined ? this.value : this.onGet();
  }

  async set(_id: string, data: unknown): Promise<void> {
    const snapshot = structuredClone(data);
    const index = this.writes.push(snapshot) - 1;
    this.events.push(`set:${index}:start`);
    await this.onSet?.(snapshot, index);
    this.value = snapshot;
    this.events.push(`set:${index}:end`);
  }

  async touch(): Promise<void> {}

  async destroy(): Promise<void> {
    this.events.push("destroy");
    await this.onDestroy?.();
    this.value = undefined;
  }
}

function session(store: SessionStore, initial?: Record<string, unknown>) {
  return createSession({
    id: "session-id",
    isNew: false,
    store,
    ...(initial === undefined ? {} : { initial }),
  });
}

describe("session concurrent loading", () => {
  test("two first writes share one pending read and preserve both fields", async () => {
    const store = new ControlledStore();
    const read = deferred<unknown>();
    store.onGet = () => read.promise;
    const handle = session(store);
    const a = handle.set("a", 1);
    const b = handle.set("b", 2);
    expect(store.reads).toBe(1);
    read.resolve({});
    await Promise.all([a, b]);
    expect(await handle.data()).toEqual({ a: 1, b: 2 });
    expect(handle.isDirty()).toBe(true);
  });

  test("mixed reads, writes and deletes observe their invocation order after loading", async () => {
    const store = new ControlledStore();
    const read = deferred<unknown>();
    store.onGet = () => read.promise;
    const handle = session(store);
    const operations = [
      handle.get("value"),
      handle.set("value", "updated"),
      handle.get("value"),
      handle.delete("value"),
      handle.has("value"),
      handle.set("other", true),
      handle.data(),
    ];
    expect(store.reads).toBe(1);
    read.resolve({ value: "original" });
    expect(await Promise.all(operations)).toEqual([
      "original",
      undefined,
      "updated",
      undefined,
      false,
      undefined,
      { other: true },
    ]);
    expect(await handle.data()).toEqual({ other: true });
  });

  test("a failed shared load rejects every caller and the next access retries", async () => {
    const store = new ControlledStore();
    const firstRead = deferred<unknown>();
    store.onGet = () => firstRead.promise;
    const handle = session(store);
    const failure = new Error("store read failed");
    const results = Promise.allSettled([handle.get("a"), handle.set("b", 2)]);
    firstRead.reject(failure);
    expect(await results).toEqual([
      { status: "rejected", reason: failure },
      { status: "rejected", reason: failure },
    ]);
    expect(store.reads).toBe(1);
    expect(handle.isDirty()).toBe(false);
    const retry = deferred<unknown>();
    store.onGet = () => retry.promise;
    const value = handle.get("a");
    const write = handle.set("b", 2);
    expect(store.reads).toBe(2);
    retry.resolve({ a: 1 });
    expect(await value).toBe(1);
    await write;
    expect(await handle.data()).toEqual({ a: 1, b: 2 });
  });

  test("preloaded data bypasses storage and remains isolated", async () => {
    const store = new ControlledStore();
    const initial = { a: 1 };
    const handle = session(store, initial);
    await Promise.all([handle.set("a", 2), handle.set("b", 3)]);
    expect(store.reads).toBe(0);
    expect(initial).toEqual({ a: 1 });
    expect(await handle.data()).toEqual({ a: 2, b: 3 });
  });

  test("new HTTP sessions preserve concurrent first mutations at response end", async () => {
    const store = new ControlledStore(undefined);
    const app = new Zebra();
    app.use(sessionMiddleware({ secret: "test-only-secret", store }));
    app.get("/", async (req) => {
      const handle = getSession(req)!;
      await Promise.all([handle.set("a", 1), handle.set("b", 2)]);
      return Response.json(await handle.data());
    });
    const response = await app.dispatch(new Request("http://test.local/"));
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ a: 1, b: 2 });
    expect(response.headers.get("set-cookie")).toContain("sid=");
    expect(store.value).toEqual({ a: 1, b: 2 });
    expect(store.reads).toBe(1);
  });

  test("WebSocket handles use the same shared loading behavior", async () => {
    const store = new ControlledStore();
    const read = deferred<unknown>();
    store.onGet = () => read.promise;
    const middleware = sessionMiddleware({ secret: "test-only-secret", store });
    const handle = (await middleware.wsSession(new Request("http://test.local/"), "session-id"))!;
    const writes = [handle.set("a", 1), handle.set("b", 2)];
    expect(store.reads).toBe(1);
    read.resolve({});
    await Promise.all(writes);
    await handle.flush();
    expect(store.value).toEqual({ a: 1, b: 2 });
  });
});

describe("session flush sequencing", () => {
  test("a mutation during persistence stays dirty until the following flush", async () => {
    const store = new ControlledStore();
    const entered = deferred<void>();
    const release = deferred<void>();
    store.onSet = async (_data, index) => {
      if (index === 0) {
        entered.resolve();
        await release.promise;
      }
    };
    const handle = session(store, {});
    await handle.set("a", 1);
    const first = handle.flush();
    await entered.promise;
    await handle.set("b", 2);
    release.resolve();
    await first;
    expect(store.value).toEqual({ a: 1 });
    expect(handle.isDirty()).toBe(true);
    await handle.flush();
    expect(store.value).toEqual({ a: 1, b: 2 });
    expect(handle.isDirty()).toBe(false);
  });

  test("concurrent flushes cannot let an older delayed write overwrite newer data", async () => {
    const store = new ControlledStore();
    const entered = deferred<void>();
    const release = deferred<void>();
    store.onSet = async (_data, index) => {
      if (index === 0) {
        entered.resolve();
        await release.promise;
      }
    };
    const handle = session(store, {});
    await handle.set("a", 1);
    const first = handle.flush();
    await entered.promise;
    await handle.set("b", 2);
    const second = handle.flush();
    // This read completes while the first write is held at the barrier.
    expect(await handle.get<number>("b")).toBe(2);
    expect(store.writes).toEqual([{ a: 1 }]);
    release.resolve();
    await Promise.all([first, second]);
    expect(store.writes).toEqual([{ a: 1 }, { a: 1, b: 2 }]);
    expect(store.value).toEqual({ a: 1, b: 2 });
    expect(handle.isDirty()).toBe(false);
  });

  test("concurrent flushes of one revision do not duplicate writes", async () => {
    const store = new ControlledStore();
    const handle = session(store, {});
    await handle.set("a", 1);
    await Promise.all([handle.flush(), handle.flush(), handle.flush()]);
    expect(store.writes).toEqual([{ a: 1 }]);
    expect(handle.isDirty()).toBe(false);
  });

  test("a failed write stays dirty and does not poison the queued retry", async () => {
    const store = new ControlledStore();
    const entered = deferred<void>();
    const release = deferred<void>();
    const failure = new Error("store write failed");
    store.onSet = async (_data, index) => {
      if (index === 0) {
        entered.resolve();
        await release.promise;
        throw failure;
      }
    };
    const handle = session(store, {});
    await handle.set("a", 1);
    const first = handle.flush().catch((error) => error);
    await entered.promise;
    await handle.set("b", 2);
    const retry = handle.flush();
    release.resolve();
    expect(await first).toBe(failure);
    await retry;
    expect(store.writes).toEqual([{ a: 1 }, { a: 1, b: 2 }]);
    expect(store.value).toEqual({ a: 1, b: 2 });
    expect(handle.isDirty()).toBe(false);
  });

  test("failure without a queued retry leaves the handle dirty", async () => {
    const store = new ControlledStore();
    const failure = new Error("store write failed");
    store.onSet = async () => {
      throw failure;
    };
    const handle = session(store, {});
    await handle.set("a", 1);
    await expect(handle.flush()).rejects.toBe(failure);
    expect(handle.isDirty()).toBe(true);
    store.onSet = async () => {};
    await handle.flush();
    expect(store.value).toEqual({ a: 1 });
    expect(handle.isDirty()).toBe(false);
  });

  test("a write receives a stable top-level snapshot even if storage reads it later", async () => {
    const entered = deferred<void>();
    const release = deferred<void>();
    let persisted: unknown;
    const store: SessionStore = {
      async get() {
        return {};
      },
      async set(_id, data) {
        entered.resolve();
        await release.promise;
        persisted = { ...(data as Record<string, unknown>) };
      },
      async touch() {},
      async destroy() {},
    };
    const handle = session(store, {});
    await handle.set("a", 1);
    const write = handle.flush();
    await entered.promise;
    await handle.set("b", 2);
    release.resolve();
    await write;
    expect(persisted).toEqual({ a: 1 });
    expect(handle.isDirty()).toBe(true);
  });
});

describe("session destruction during concurrent work", () => {
  test("destroy prevents a pending load's mutations from becoming dirty or persisted", async () => {
    const store = new ControlledStore({ old: true });
    const read = deferred<unknown>();
    store.onGet = () => read.promise;
    const handle = session(store);
    const pending = [handle.set("a", 1), handle.delete("old")];
    await handle.destroy();
    read.resolve({ old: true });
    await Promise.all(pending);
    await handle.flush();
    expect(handle.isDestroyed()).toBe(true);
    expect(handle.isDirty()).toBe(false);
    expect(store.writes).toEqual([]);
    expect(store.value).toBeUndefined();
  });

  test("destroy cancels a flush that has not started its store write", async () => {
    const store = new ControlledStore();
    const handle = session(store, {});
    await handle.set("a", 1);
    const flush = handle.flush();
    const destroy = handle.destroy();
    await Promise.all([flush, destroy]);
    expect(store.writes).toEqual([]);
    expect(store.value).toBeUndefined();
    expect(handle.isDirty()).toBe(false);
  });

  test("destroy waits for this handle's started write, skips queued writes and deletes last", async () => {
    const store = new ControlledStore();
    const entered = deferred<void>();
    const release = deferred<void>();
    store.onSet = async () => {
      entered.resolve();
      await release.promise;
    };
    const handle = session(store, {});
    await handle.set("a", 1);
    const first = handle.flush();
    await entered.promise;
    await handle.set("b", 2);
    const queued = handle.flush();
    const destroying = handle.destroy();
    expect(handle.isDestroyed()).toBe(true);
    expect(handle.isDirty()).toBe(false);
    await handle.set("afterDestroy", true);
    await handle.flush();
    release.resolve();
    await Promise.all([first, queued, destroying, handle.destroy()]);
    expect(store.events).toEqual(["set:0:start", "set:0:end", "destroy"]);
    expect(store.writes).toEqual([{ a: 1 }]);
    expect(store.value).toBeUndefined();
    expect(handle.isDirty()).toBe(false);
  });

  test("a failed in-flight write still allows destroy to complete", async () => {
    const store = new ControlledStore();
    const entered = deferred<void>();
    const release = deferred<void>();
    const failure = new Error("store write failed");
    store.onSet = async () => {
      entered.resolve();
      await release.promise;
      throw failure;
    };
    const handle = session(store, {});
    await handle.set("a", 1);
    const flush = handle.flush().catch((error) => error);
    await entered.promise;
    const destroy = handle.destroy();
    release.resolve();
    expect(await flush).toBe(failure);
    await destroy;
    expect(store.events).toEqual(["set:0:start", "destroy"]);
    expect(store.value).toBeUndefined();
    expect(handle.isDirty()).toBe(false);
  });

  test("destroy backend failures keep the handle inert without changing the existing error policy", async () => {
    const store = new ControlledStore();
    store.onDestroy = async () => {
      throw new Error("store destroy failed");
    };
    const handle = session(store, {});
    await handle.set("a", 1);
    await handle.destroy();
    await handle.set("b", 2);
    await handle.delete("a");
    await handle.flush();
    expect(handle.isDestroyed()).toBe(true);
    expect(handle.isDirty()).toBe(false);
    expect(store.writes).toEqual([]);
  });
});
