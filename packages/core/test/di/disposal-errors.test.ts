import { expect, test } from "bun:test";
import { Container } from "../../src/di/container.ts";
import type { Disposable } from "../../src/di/disposable.ts";
import { token } from "../../src/di/token.ts";

test.each(["sync", "async"])(
  "dispose continues in reverse order after a %s failure",
  async (mode) => {
    const container = new Container();
    const order: string[] = [];
    const failure = new Error("B failed");
    const ids = ["A", "B", "C"].map((name) => {
      const id = token<Disposable>(name);
      container.bind(id).toFactory(() => ({
        dispose() {
          order.push(name);
          if (name === "B") {
            if (mode === "async") return Promise.reject(failure);
            throw failure;
          }
        },
      }));
      return id;
    });
    const instances = ids.map((id) => container.resolve(id));

    await expect(container.dispose()).rejects.toBe(failure);
    expect(order).toEqual(["C", "B", "A"]);
    await container.dispose();
    expect(order).toEqual(["C", "B", "A"]);

    // Failed cleanup must evict the old cache, while a newly resolved resource
    // still belongs to the container and must be cleaned on a later call.
    expect(container.resolve(ids[0]!)).not.toBe(instances[0]);
    await container.dispose();
    expect(order).toEqual(["C", "B", "A", "A"]);
  },
);

test("dispose aggregates failures and attempts aliased value resources only once", async () => {
  const container = new Container();
  const first = new Error("first");
  const second = new Error("second");
  let sharedCalls = 0;
  const shared = { dispose: () => void sharedCalls++ };
  container.bind(token<Disposable>("shared")).toValue(shared);
  container.bind(token<Disposable>("alias")).toValue(shared);
  container.bind(token<Disposable>("first")).toValue({
    dispose() {
      throw first;
    },
  });
  container.bind(token<Disposable>("second")).toValue({
    dispose: () => Promise.reject(second),
  });

  const result = await Promise.allSettled([container.dispose()]);
  expect(result[0]).toMatchObject({ status: "rejected" });
  if (result[0]?.status !== "rejected") throw new Error("expected disposal failure");
  expect(result[0].reason).toBeInstanceOf(AggregateError);
  expect(result[0].reason.errors).toEqual([first, second]);
  expect(sharedCalls).toBe(1);
  await container.dispose();
  expect(sharedCalls).toBe(1);
});

test("concurrent disposal waits for the same attempt and reports its failure to every caller", async () => {
  const container = new Container();
  const entered = Promise.withResolvers<void>();
  const gate = Promise.withResolvers<void>();
  const failure = new Error("blocked cleanup failed");
  let calls = 0;
  container.bind(token<Disposable>("blocked")).toValue({
    async dispose() {
      calls++;
      entered.resolve();
      await gate.promise;
      throw failure;
    },
  });

  const results = Promise.allSettled([container.dispose(), container.dispose()]);
  try {
    await entered.promise;
    expect(calls).toBe(1);
  } finally {
    gate.resolve();
  }
  expect(await results).toEqual([
    { status: "rejected", reason: failure },
    { status: "rejected", reason: failure },
  ]);
  await container.dispose();
  expect(calls).toBe(1);
});

test("dependencies remain resolvable from the cache while their dependents are disposing", async () => {
  const container = new Container();
  const dependency = token<Disposable>("dependency");
  const dependent = token<Disposable>("dependent");
  const order: string[] = [];
  container.bind(dependency).toFactory(() => ({ dispose: () => void order.push("dependency") }));
  container.bind(dependent).toFactory(() => {
    const instance = container.resolve(dependency);
    return {
      dispose() {
        expect(container.resolve(dependency)).toBe(instance);
        order.push("dependent");
      },
    };
  });
  container.resolve(dependent);
  await container.dispose();
  expect(order).toEqual(["dependent", "dependency"]);
});
