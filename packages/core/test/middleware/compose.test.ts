import { test, expect } from "bun:test";
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
  await expect(
    compose({} as any, [bad], async () => new Response("x")),
  ).rejects.toThrow();
});
