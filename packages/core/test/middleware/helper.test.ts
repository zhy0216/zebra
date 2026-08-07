import "reflect-metadata";
import { expect, test } from "bun:test";
import { Zebra } from "../../src/app/app.ts";
import { Container } from "../../src/di/container.ts";
import { injectable } from "../../src/di/decorators.ts";
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

test("Zebra resolves middleware deps from the request scope", async () => {
  const app = new Zebra();
  app.injectSingleton(Audit);
  app.use(
    middleware({ audit: Audit }, async (_req, next, { audit }) => {
      audit.log("before");
      const response = await next();
      audit.log("after");
      return response;
    }),
  );
  app.get("/", { audit: Audit }, async (_req, { audit }) => audit.events);

  const response = await app.dispatch(new Request("http://x/"));
  expect(await response.json()).toEqual(["before"]);

  const audit = (app as any).container.resolve(Audit) as Audit;
  expect(audit.events).toEqual(["before", "after"]);
});

@injectable()
class RequestResource {
  static disposed = 0;
  dispose() {
    RequestResource.disposed++;
  }
}

test("request-scoped middleware deps are disposed when middleware throws", async () => {
  RequestResource.disposed = 0;
  const app = new Zebra();
  app.injectRequest(RequestResource);
  app.use(
    middleware({ resource: RequestResource }, async () => {
      throw new Error("middleware failed");
    }),
  );
  app.get("/", async () => "unreachable");

  const response = await app.dispatch(new Request("http://x/"));
  expect(response.status).toBe(500);
  expect(RequestResource.disposed).toBe(1);
});
