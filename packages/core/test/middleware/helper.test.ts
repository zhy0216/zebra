import "reflect-metadata";
import { expect, test } from "bun:test";
import { Container } from "../../src/di/container.ts";
import { getMiddlewareDeps, middleware } from "../../src/middleware/helper.ts";

class Audit {
  events: string[] = [];
  log(e: string) {
    this.events.push(e);
  }
}

test("middleware() carries deps that can be inspected", () => {
  const mw = middleware({ audit: Audit }, async (req, next, { audit }) => {
    audit.log("before");
    const r = await next();
    audit.log("after");
    return r;
  });
  expect(getMiddlewareDeps(mw)).toEqual({ audit: Audit });
});

test("middleware() runs with deps resolved from container", async () => {
  const c = new Container();
  c.bind(Audit).toSelf();
  const audit = c.resolve(Audit);

  const mw = middleware({ audit: Audit }, async (req, next, { audit }) => {
    audit.log("hit");
    return next();
  });
  // Simulate one-shot call
  const deps = { audit };
  const res = await mw({} as any, async () => new Response("ok"), deps);
  expect(audit.events).toEqual(["hit"]);
  expect(await res.text()).toBe("ok");
});
