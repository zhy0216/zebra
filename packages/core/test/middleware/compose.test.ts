import { expect, test } from "bun:test";
import { compose } from "../../src/middleware/compose.ts";
import type { Middleware } from "../../src/middleware/types.ts";

test("compose runs in onion order: pre → final → post (reverse)", async () => {
  const calls: string[] = [];
  const mw1: Middleware = async (_req, next) => {
    calls.push("1 pre");
    const r = await next();
    calls.push("1 post");
    return r;
  };
  const mw2: Middleware = async (_req, next) => {
    calls.push("2 pre");
    const r = await next();
    calls.push("2 post");
    return r;
  };
  const final = async () => {
    calls.push("final");
    return new Response("ok");
  };
  const fakeReq = {} as any;
  const res = await compose(fakeReq, [mw1, mw2], final);
  expect(await res.text()).toBe("ok");
  expect(calls).toEqual(["1 pre", "2 pre", "final", "2 post", "1 post"]);
});

test("calling next twice throws", async () => {
  const bad: Middleware = async (_req, next) => {
    await next();
    return next();
  };
  await expect(compose({} as any, [bad], async () => new Response("x"))).rejects.toThrow();
});

for (const location of ["middleware", "terminal"]) {
  test.each(["throw", "reject", "then-getter", "then-reject"])(
    `${location} %s rejects with the original error without a synchronous escape`,
    async (mode) => {
      const error = new Error("original failure");
      const fail = (): any => {
        if (mode === "throw") throw error;
        if (mode === "reject") return Promise.reject(error);
        return {
          // biome-ignore lint/suspicious/noThenProperty: Exercise thenable error assimilation.
          get then() {
            if (mode === "then-getter") throw error;
            return (_resolve: unknown, reject: (error: unknown) => void) => reject(error);
          },
        };
      };
      const pending = compose({}, location === "middleware" ? [fail] : [], fail);
      expect(pending).toBeInstanceOf(Promise);
      await expect(pending).rejects.toBe(error);
    },
  );
}

test("middleware and terminal thenables assimilate nested results", async () => {
  const response = new Response("thenable");
  const calls: string[] = [];
  const wrap = (value: unknown, label: string): any => ({
    // biome-ignore lint/suspicious/noThenProperty: Exercise nested thenable assimilation.
    then(resolve: (value: unknown) => void) {
      calls.push(label);
      resolve(value);
    },
  });
  const mw: Middleware = (_req, next) => wrap(next(), "middleware");
  const res = await compose({}, [mw], () => wrap(wrap(response, "inner"), "terminal"));
  expect(res).toBe(response);
  expect(calls.toSorted()).toEqual(["inner", "middleware", "terminal"]);
});

test("a synchronous short circuit never calls downstream work", async () => {
  const response = new Response("short");
  const mw = (() => response) as unknown as Middleware;
  let calls = 0;
  const res = await compose({}, [mw], async () => {
    calls++;
    return new Response("unexpected");
  });
  expect(res).toBe(response);
  expect(calls).toBe(0);
});

test.each(["middleware", "terminal"])(
  "%s promise with a throwing then getter retains its rejection behavior",
  async (location) => {
    const failure = new Error("then access failed");
    const promise = Promise.resolve(new Response("ok"));
    // biome-ignore lint/suspicious/noThenProperty: A custom promise accessor must retain its error.
    Object.defineProperty(promise, "then", {
      get() {
        throw failure;
      },
    });
    const work = () => promise;
    let observed: unknown;
    try {
      await compose({}, location === "middleware" ? [work] : [], work);
    } catch (error) {
      observed = error;
    }
    expect(observed).toBe(failure);
  },
);

test.each(["pending", "throw", "reject"])(
  "concurrent and later repeated next calls stay rejected after downstream %s",
  async (mode) => {
    const gate = Promise.withResolvers<Response>();
    const original = new Error("downstream failed");
    let calls = 0;
    const mw: Middleware = async (_req, next) => {
      const first = next();
      const duplicate = next();
      expect(first).toBeInstanceOf(Promise);
      expect(duplicate).toBeInstanceOf(Promise);
      const settled = Promise.allSettled([first, duplicate]);
      gate.resolve(new Response("ok"));
      const results = await settled;
      if (mode === "pending") expect(results[0]?.status).toBe("fulfilled");
      else expect(results[0]).toEqual({ status: "rejected", reason: original });
      expect(results[1]?.status).toBe("rejected");
      if (results[1]?.status === "rejected") {
        expect(results[1].reason.message).toBe("next() called multiple times");
      }
      await expect(next()).rejects.toThrow("next() called multiple times");
      return new Response("recovered");
    };
    const response = await compose({}, [mw], () => {
      calls++;
      if (mode === "throw") throw original;
      if (mode === "reject") return Promise.reject(original);
      return gate.promise;
    });
    expect(await response.text()).toBe("recovered");
    expect(calls).toBe(1);
  },
);
