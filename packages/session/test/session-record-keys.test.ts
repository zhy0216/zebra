import { describe, expect, test } from "bun:test";
import { MemoryStore, createSession } from "../src/index.ts";

const specialKeys = ["__proto__", "constructor", "toString", "hasOwnProperty"];

describe("session own record keys", () => {
  test.each(["missing", "initial", "stored"])(
    "%s empty records do not expose inherited properties",
    async (source) => {
      const store = new MemoryStore({ ttl: 30_000 });
      if (source === "stored") await store.set("session-id", {});
      const handle = createSession({
        id: "session-id",
        isNew: source !== "stored",
        store,
        ...(source === "initial" ? { initial: {} } : {}),
      });

      for (const key of specialKeys) {
        expect(await handle.has(key)).toBe(false);
        expect(await handle.get(key)).toBeUndefined();
        await handle.delete(key);
        expect(await handle.has(key)).toBe(false);
        expect(await handle.get(key)).toBeUndefined();
      }
      const data = await handle.data();
      expect(data).toEqual({});
      expect(Object.getPrototypeOf(data)).toBe(Object.prototype);
    },
  );

  test.each(specialKeys)("%s is ordinary data through persistence and deletion", async (key) => {
    const prototypeBefore = Object.getOwnPropertyDescriptors(Object.prototype);
    const store = new MemoryStore({ ttl: 30_000 });
    const handle = createSession({ id: "session-id", isNew: true, store });
    const value = { admin: true };
    const expected = { [key]: value };

    await handle.set(key, value);
    expect(await handle.has(key)).toBe(true);
    expect(await handle.get<typeof value>(key)).toBe(value);
    expect(await handle.get("admin")).toBeUndefined();
    expect(await handle.has("admin")).toBe(false);

    const data = await handle.data();
    expect(Object.getPrototypeOf(data)).toBe(Object.prototype);
    expect(Object.getOwnPropertyDescriptor(data, key)).toEqual({
      value,
      writable: true,
      enumerable: true,
      configurable: true,
    });
    expect(Object.keys(data)).toEqual([key]);
    expect(JSON.stringify(data)).toBe(JSON.stringify(expected));

    await handle.flush();
    const stored = (await store.get(handle.id)) as Record<string, unknown>;
    expect(Object.getPrototypeOf(stored)).toBe(Object.prototype);
    expect(Object.getOwnPropertyDescriptor(stored, key)).toEqual(
      Object.getOwnPropertyDescriptor(data, key),
    );
    expect(stored[key]).toBe(value);
    expect(JSON.stringify(stored)).toBe(JSON.stringify(expected));

    await store.set(handle.id, JSON.parse(JSON.stringify(stored)));
    const reopened = createSession({ id: handle.id, isNew: false, store });
    expect(await reopened.has(key)).toBe(true);
    expect(await reopened.get<typeof value>(key)).toEqual(value);
    expect(await reopened.get("admin")).toBeUndefined();
    expect(await reopened.data()).toEqual(expected);

    await reopened.delete(key);
    expect(await reopened.has(key)).toBe(false);
    expect(await reopened.get(key)).toBeUndefined();
    expect(Object.hasOwn(await reopened.data(), key)).toBe(false);
    await reopened.flush();
    expect(await store.get(handle.id)).toEqual({});

    expect(Object.getOwnPropertyDescriptors(Object.prototype)).toEqual(prototypeBefore);
    expect(Object.getPrototypeOf(value)).toBe(Object.prototype);
    expect(Object.getPrototypeOf({})).toBe(Object.prototype);
    expect(({} as Record<string, unknown>).admin).toBeUndefined();
  });

  test.each(["initial", "store.get"])(
    "%s copies only own enumerable data and preserves nested references",
    async (source) => {
      const nested = { admin: true };
      const inherited = { inherited: true };
      const input: Record<string, unknown> = Object.create(inherited, {
        ...Object.getOwnPropertyDescriptors({
          ["__proto__"]: nested,
          constructor: "own constructor",
          toString: "own toString",
          hasOwnProperty: "own hasOwnProperty",
          optional: undefined,
        }),
        hidden: { value: true },
      });
      const store = new MemoryStore({ ttl: 30_000 });
      if (source === "store.get") await store.set("session-id", input);
      const handle = createSession({
        id: "session-id",
        isNew: false,
        store,
        ...(source === "initial" ? { initial: input } : {}),
      });

      for (const key of [...specialKeys, "optional"]) {
        expect(await handle.has(key)).toBe(true);
        expect<unknown>(await handle.get(key)).toBe(input[key]);
      }
      for (const key of ["inherited", "hidden", "admin"]) {
        expect(await handle.has(key)).toBe(false);
        expect(await handle.get(key)).toBeUndefined();
      }

      const data = await handle.data();
      expect(Object.getPrototypeOf(data)).toBe(Object.prototype);
      expect(data).toEqual({ ...input });
      expect(data.__proto__).toBe(nested);
      data.__proto__ = { changed: true };
      Reflect.deleteProperty(data, "constructor");
      data.extra = true;
      expect(await handle.get<typeof nested>("__proto__")).toBe(nested);
      expect(await handle.get<string>("constructor")).toBe("own constructor");
      expect(await handle.has("extra")).toBe(false);
      expect(handle.isDirty()).toBe(false);

      await handle.set("toString", "updated");
      await handle.delete("hasOwnProperty");
      expect<unknown>(input.toString).toBe("own toString");
      expect<unknown>(input.hasOwnProperty).toBe("own hasOwnProperty");
      expect(Object.getPrototypeOf(input)).toBe(inherited);
      await handle.flush();
      const stored = (await store.get(handle.id)) as Record<string, unknown>;
      expect(Object.getPrototypeOf(stored)).toBe(Object.prototype);
      expect(stored.__proto__).toBe(nested);
      stored.__proto__ = { changed: true };
      stored.extra = true;
      expect(await handle.get<typeof nested>("__proto__")).toBe(nested);
      expect(await handle.has("extra")).toBe(false);
    },
  );

  test.each([...specialKeys, "optional"])("%s can own an undefined value", async (key) => {
    const store = new MemoryStore({ ttl: 30_000 });
    const handle = createSession({ id: "session-id", isNew: true, store });
    await handle.set(key, undefined);
    expect(await handle.get(key)).toBeUndefined();
    expect(await handle.has(key)).toBe(true);
    expect(Object.hasOwn(await handle.data(), key)).toBe(true);
    await handle.flush();

    const reopened = createSession({ id: handle.id, isNew: false, store });
    expect(await reopened.get(key)).toBeUndefined();
    expect(await reopened.has(key)).toBe(true);
    await reopened.delete(key);
    expect(await reopened.get(key)).toBeUndefined();
    expect(await reopened.has(key)).toBe(false);
    expect(Object.hasOwn(await reopened.data(), key)).toBe(false);
    expect(reopened.isDirty()).toBe(true);
    await reopened.flush();
    const afterDelete = createSession({ id: handle.id, isNew: false, store });
    expect(await afterDelete.has(key)).toBe(false);
    expect(await afterDelete.get(key)).toBeUndefined();
  });
});
