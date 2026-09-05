import { describe, expect, expectTypeOf, spyOn, test } from "bun:test";
import { MemoryStore } from "../src/store.ts";
import type { SessionStore } from "../src/store.ts";

/** Minimal backend with no expiry: proves the interface is not memory-store shaped. */
class FakeStore implements SessionStore {
  private readonly data = new Map<string, unknown>();

  get(id: string): Promise<unknown | undefined> {
    return Promise.resolve(this.data.get(id));
  }

  set(id: string, data: unknown): Promise<void> {
    this.data.set(id, data);
    return Promise.resolve();
  }

  touch(_id: string, _ttl?: number): Promise<void> {
    return Promise.resolve();
  }

  destroy(id: string): Promise<void> {
    this.data.delete(id);
    return Promise.resolve();
  }
}

/** Behavioral contract shared by every SessionStore implementation. */
async function assertStoreContract(store: SessionStore): Promise<void> {
  await store.set("a", { visits: 1, user: "alice" });
  expect(await store.get("a")).toEqual({ visits: 1, user: "alice" });

  await store.set("zero", 0);
  expect(await store.get("zero")).toBe(0);
  await store.set("empty", "");
  expect(await store.get("empty")).toBe("");
  await store.set("false", false);
  expect(await store.get("false")).toBe(false);
  await store.set("null", null);
  expect(await store.get("null")).toBeNull();

  expect(await store.get("missing")).toBeUndefined();

  await store.set("a", "overwritten");
  expect(await store.get("a")).toBe("overwritten");

  await store.destroy("a");
  expect(await store.get("a")).toBeUndefined();
}

test("contract holds for MemoryStore", () => assertStoreContract(new MemoryStore({ ttl: 60_000 })));

test("contract holds for an unrelated fake implementation", () =>
  assertStoreContract(new FakeStore()));

describe("MemoryStore", () => {
  test("get returns undefined after ttl expires", async () => {
    const store = new MemoryStore({ ttl: 50 });
    await store.set("s", "value");
    expect(await store.get("s")).toBe("value");
    await Bun.sleep(80);
    expect(await store.get("s")).toBeUndefined();
  });

  test("touch renews the expiry with the store default ttl", async () => {
    const store = new MemoryStore({ ttl: 80 });
    await store.set("s", 1);
    await Bun.sleep(40);
    expect(await store.get("s")).toBe(1);
    await store.touch("s");
    await Bun.sleep(40);
    expect(await store.get("s")).toBe(1);
  });

  test("touch accepts a per-call ttl override", async () => {
    const store = new MemoryStore({ ttl: 50 });
    await store.set("s", 1);
    await store.touch("s", 200);
    await Bun.sleep(100);
    expect(await store.get("s")).toBe(1);
    await Bun.sleep(150);
    expect(await store.get("s")).toBeUndefined();
  });

  test("touch on a missing or already-expired session is a no-op", async () => {
    const store = new MemoryStore({ ttl: 50 });
    await store.touch("never-set");
    await store.set("s", 1);
    await Bun.sleep(80);
    await store.touch("s");
    expect(await store.get("s")).toBeUndefined();
  });

  test("lazy sweep keeps expired entries from accumulating", async () => {
    const store = new MemoryStore({ ttl: 50 });
    const entries = (store as unknown as { entries: Map<string, unknown> }).entries;

    for (let i = 0; i < 50; i++) await store.set(`k${i}`, i);
    expect(entries.size).toBe(50);
    await Bun.sleep(80);
    await store.get("missing");
    expect(entries.size).toBe(0);

    for (let i = 0; i < 10; i++) {
      await store.set("x", i);
      expect(entries.size).toBe(1);
    }
    // destroy leaves a tombstone until its ttl elapses, then the sweep removes it.
    await store.destroy("x");
    expect(entries.size).toBe(1);
    await Bun.sleep(80);
    await store.get("missing");
    expect(entries.size).toBe(0);
  });

  test("sweep is budget-bounded per call for large stores", async () => {
    const store = new MemoryStore({ ttl: 50 });
    const entries = (store as unknown as { entries: Map<string, unknown> }).entries;

    // 1200 expired entries: one access sweeps only the first 512 (the sweep
    // budget), not the whole store — no single access pays an O(n) scan.
    for (let i = 0; i < 1200; i++) await store.set(`k${i}`, i);
    expect(entries.size).toBe(1200);
    await Bun.sleep(80);
    await store.get("missing");
    expect(entries.size).toBe(1200 - 512);

    // Correctness never depends on the sweep: expired ids still read as missing.
    expect(await store.get("k0")).toBeUndefined();
    expect(await store.get("k1199")).toBeUndefined();
    // Repeated accesses drain the rest of the store in bounded passes.
    await store.get("missing");
    expect(entries.size).toBe(0);
  });

  test("bounded sweeps reach expired tails behind 512 live entries", async () => {
    let now = 0;
    const clock = spyOn(Date, "now").mockImplementation(() => now);
    const store = new MemoryStore({ ttl: 100 });
    const entries = (store as unknown as { entries: Map<string, { expiresAt: number }> }).entries;
    try {
      for (let i = 0; i < 512; i++) {
        await store.set(`live${i}`, i);
        await store.touch(`live${i}`, 10_000);
      }
      for (let i = 0; i < 1200; i++) await store.set(`expired${i}`, i);
      expect(entries.size).toBe(1712);

      let inspected = 0;
      for (const entry of entries.values()) {
        const expiresAt = entry.expiresAt;
        Object.defineProperty(entry, "expiresAt", {
          get() {
            inspected++;
            return expiresAt;
          },
        });
      }
      now = 100;
      const calls = Math.ceil(entries.size / 512) + 1;
      for (let i = 0; i < calls; i++) {
        inspected = 0;
        await store.get("missing");
        expect(inspected).toBeLessThanOrEqual(512);
      }
      expect(entries.size).toBe(512);
      expect([...entries.keys()].every((key) => key.startsWith("live"))).toBe(true);
      expect(await store.get("live0")).toBe(0);
    } finally {
      clock.mockRestore();
    }
  });

  test("sweeps progress across insertion, deletion, tombstones, empty maps and regrowth", async () => {
    let now = 0;
    const clock = spyOn(Date, "now").mockImplementation(() => now);
    const store = new MemoryStore({ ttl: 100 });
    const entries = (store as unknown as { entries: Map<string, unknown> }).entries;
    try {
      for (let i = 0; i < 1200; i++) {
        await store.set(`live${i}`, i);
        await store.touch(`live${i}`, 10_000);
      }
      for (let i = 0; i < 600; i++) await store.set(`expired${i}`, i);
      now = 100;
      for (let i = 0; i < 8; i++) {
        await store.get(`expired${i * 70}`);
        await store.destroy(`live${i}`);
        await store.set(`new${i}`, i);
      }
      expect([...entries.keys()].some((key) => key.startsWith("expired"))).toBe(false);
      now = 200;
      for (let i = 0; i < 5; i++) await store.get("missing");
      expect(entries.size).toBe(1200 - 8);
      expect([...entries.keys()].every((key) => key.startsWith("live"))).toBe(true);

      now = 10_000;
      for (let i = 0; i < 4; i++) await store.get("missing");
      expect(entries.size).toBe(0);
      await store.get("missing");
      await store.set("regrown", "ok");
      expect(await store.get("regrown")).toBe("ok");
      now += 100;
      await store.get("missing");
      expect(entries.size).toBe(0);
    } finally {
      clock.mockRestore();
    }
  });

  test("touch never revives an expired target even when the sweep does not reach it", async () => {
    let now = 0;
    const clock = spyOn(Date, "now").mockImplementation(() => now);
    const store = new MemoryStore({ ttl: 100 });
    try {
      for (let i = 0; i < 512; i++) {
        await store.set(`live${i}`, i);
        await store.touch(`live${i}`, 10_000);
      }
      await store.set("target", "expired");
      // Maintenance is advisory. Suppress it to guarantee this request's
      // target is outside the sweep, independent of the cursor position.
      const sweep = spyOn(store as unknown as { sweep(): void }, "sweep").mockImplementation(
        () => {},
      );
      try {
        now = 100;
        await store.touch("target", 10_000);
        expect(await store.get("target")).toBeUndefined();
      } finally {
        sweep.mockRestore();
      }
    } finally {
      clock.mockRestore();
    }
  });

  test("set reuses an expired tombstone without a sweep and preserves a live tombstone", async () => {
    let now = 0;
    const clock = spyOn(Date, "now").mockImplementation(() => now);
    const store = new MemoryStore({ ttl: 100 });
    try {
      for (let i = 0; i < 512; i++) {
        await store.set(`live${i}`, i);
        await store.touch(`live${i}`, 10_000);
      }
      await store.destroy("target");
      const sweep = spyOn(store as unknown as { sweep(): void }, "sweep").mockImplementation(
        () => {},
      );
      try {
        now = 99;
        await store.touch("target", 10_000);
        await store.set("target", "blocked");
        expect(await store.get("target")).toBeUndefined();
        now = 100;
        await store.set("target", "reused");
        expect(await store.get("target")).toBe("reused");
      } finally {
        sweep.mockRestore();
      }
    } finally {
      clock.mockRestore();
    }
  });

  test("set resets the expiry for an existing id", async () => {
    const store = new MemoryStore({ ttl: 50 });
    await store.set("s", "old");
    await Bun.sleep(30);
    await store.set("s", "new");
    await Bun.sleep(40);
    expect(await store.get("s")).toBe("new");
  });

  test("destroy tombstones the id: get/touch/set cannot revive it", async () => {
    const store = new MemoryStore({ ttl: 200 });
    await store.set("s", { v: 1 });
    await store.destroy("s");

    expect(await store.get("s")).toBeUndefined();
    await store.touch("s");
    expect(await store.get("s")).toBeUndefined();
    // An in-flight request that read the record before the destroy must not
    // resurrect it (anti-session-fixation).
    await store.set("s", { v: 2 });
    expect(await store.get("s")).toBeUndefined();
  });

  test("a destroyed id is reusable once the tombstone expires", async () => {
    const store = new MemoryStore({ ttl: 50 });
    await store.set("s", 1);
    await store.destroy("s");
    expect(await store.get("s")).toBeUndefined();
    await Bun.sleep(80);
    await store.set("s", 2);
    expect(await store.get("s")).toBe(2);
  });
});

describe("SessionStore interface", () => {
  test("any implementation is assignable", () => {
    const store: SessionStore = new FakeStore();
    const memory: SessionStore = new MemoryStore({ ttl: 1000 });
    expectTypeOf<FakeStore>().toMatchTypeOf<SessionStore>();
    expectTypeOf<MemoryStore>().toMatchTypeOf<SessionStore>();
    expectTypeOf(store.get("x")).resolves.toEqualTypeOf<unknown | undefined>();
    expectTypeOf(store.set("x", { any: [1, "v"] })).resolves.toBeVoid();
    expectTypeOf(store.touch("x")).resolves.toBeVoid();
    expectTypeOf(store.touch("x", 5)).resolves.toBeVoid();
    expectTypeOf(store.destroy("x")).resolves.toBeVoid();
    expectTypeOf(memory.get("x")).resolves.toEqualTypeOf<unknown | undefined>();
  });
});
