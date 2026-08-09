import "reflect-metadata";
import { expect, test } from "bun:test";
import { Zebra } from "../../src/app/app.ts";
import { Container } from "../../src/di/container.ts";
import { ScopeKind } from "../../src/di/scope.ts";
import { token } from "../../src/di/token.ts";
import { middleware } from "../../src/middleware/helper.ts";

class SpyContainer extends Container {
  childScopes = 0;
  override createChildScope(kind: ScopeKind): Container {
    this.childScopes++;
    return super.createChildScope(kind);
  }
}

test("minimal GET route creates no container child scope (zero-cost fast path)", async () => {
  const c = new SpyContainer();
  const app = new Zebra({ container: c });
  app.get("/hello", () => new Response("ok"));
  await app.listen({ port: 0 });

  const res = await app.dispatch(new Request("http://x/hello"));
  expect(res.status).toBe(200);
  expect(await res.text()).toBe("ok");
  expect(c.childScopes).toBe(0);
  await app.stop();
});

test("404 path with no deps creates no container child scope", async () => {
  const c = new SpyContainer();
  const app = new Zebra({ container: c });
  app.get("/hello", () => new Response("ok"));
  await app.listen({ port: 0 });

  const res = await app.dispatch(new Request("http://x/none"));
  expect(res.status).toBe(404);
  expect(c.childScopes).toBe(0);
  await app.stop();
});

test("a middleware that throws still yields Problem+Json on the fast path", async () => {
  const app = new Zebra();
  app.use(async () => {
    throw new Error("boom");
  });
  app.get("/hello", () => new Response("ok"));
  await app.listen({ port: 0 });

  const res = await app.dispatch(new Request("http://x/hello"));
  expect(res.status).toBe(500);
  expect(res.headers.get("content-type")).toContain("application/problem+json");
  await app.stop();
});

test("route deps force a child scope and resolve correctly", async () => {
  const T = token<{ v: number }>("T");
  const c = new SpyContainer();
  const app = new Zebra({ container: c });
  app.injectValue(T, { v: 7 });
  app.get("/d", { t: T }, (_req, { t }) => (t as { v: number }).v);
  await app.listen({ port: 0 });

  const res = await app.dispatch(new Request("http://x/d"));
  expect(await res.json()).toBe(7);
  expect(c.childScopes).toBe(1);
  await app.stop();
});

test("session resolver present forces scopes even for a no-deps route", async () => {
  const c = new SpyContainer();
  const app = new Zebra({ container: c, session: { resolver: () => undefined } });
  app.get("/hello", () => new Response("ok"));
  await app.listen({ port: 0 });

  const res = await app.dispatch(new Request("http://x/hello"));
  expect(res.status).toBe(200);
  expect(c.childScopes).toBe(1);
  await app.stop();
});

test("middleware deps force a scope and resolve from the request scope", async () => {
  const T = token<{ tag: string }>("T");
  const c = new SpyContainer();
  const app = new Zebra({ container: c });
  app.injectValue(T, { tag: "mw" });
  let seen: string | undefined;
  app.use(
    middleware({ t: T }, async (_req, next, { t }) => {
      seen = (t as { tag: string }).tag;
      return next();
    }),
  );
  app.get("/hello", () => new Response("ok"));
  await app.listen({ port: 0 });

  const res = await app.dispatch(new Request("http://x/hello"));
  expect(res.status).toBe(200);
  expect(seen).toBe("mw");
  expect(c.childScopes).toBe(1);
  await app.stop();
});

test("dispatch before listen (no boot) still works and resolves deps", async () => {
  const T = token<{ v: number }>("T");
  const c = new SpyContainer();
  const app = new Zebra({ container: c });
  app.injectValue(T, { v: 3 });
  app.get("/d", { t: T }, (_req, { t }) => (t as { v: number }).v);

  const res = await app.dispatch(new Request("http://x/d"));
  expect(await res.json()).toBe(3);
  expect(c.childScopes).toBe(1);
});
