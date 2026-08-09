import "reflect-metadata";
import { expect, test } from "bun:test";
import { zc } from "@zebra/contract";
import { z } from "zod";
import { Zebra } from "../../src/app/app.ts";
import { Container } from "../../src/di/container.ts";
import { HttpError } from "../../src/http/errors.ts";

function makeApp(): Zebra {
  return new Zebra({ container: new Container() });
}

test("HEAD falls back to GET with an empty body and preserved headers", async () => {
  const app = makeApp();
  app.get("/hello", async () =>
    new Response("hello", {
      headers: { "content-type": "text/plain", "content-length": "5", "x-custom": "v" },
    }),
  );

  const res = await app.dispatch(new Request("http://x/hello", { method: "HEAD" }));
  expect(res.status).toBe(200);
  expect(await res.text()).toBe("");
  expect(res.headers.get("content-type")).toBe("text/plain");
  expect(res.headers.get("content-length")).toBe("5");
  expect(res.headers.get("x-custom")).toBe("v");

  const get = await app.dispatch(new Request("http://x/hello"));
  expect(get.status).toBe(200);
  expect(await get.text()).toBe("hello");
});

test("HEAD fallback on param route", async () => {
  const app = makeApp();
  app.get("/users/:id", async (req) => ({ id: req.params.id }));

  const res = await app.dispatch(new Request("http://x/users/42", { method: "HEAD" }));
  expect(res.status).toBe(200);
  expect(await res.text()).toBe("");
  expect(res.headers.get("content-type")).toContain("application/json");
});

test("HEAD fallback on wildcard route", async () => {
  const app = makeApp();
  app.get("/files/*path", async (req) => ({ path: req.params.path }));

  const res = await app.dispatch(new Request("http://x/files/a/b.txt", { method: "HEAD" }));
  expect(res.status).toBe(200);
  expect(await res.text()).toBe("");
});

test("explicit HEAD route wins over the GET fallback", async () => {
  const app = makeApp();
  app.get("/x", async () => new Response("get"));
  app.head("/x", async () => new Response("head"));

  const res = await app.dispatch(new Request("http://x/x", { method: "HEAD" }));
  expect(res.status).toBe(200);
  expect(await res.text()).toBe("head");
});

test("HEAD fallback strips the body of error responses too", async () => {
  const app = makeApp();
  app.get("/x", async () => {
    throw new HttpError(404, "not_found", "gone");
  });

  const res = await app.dispatch(new Request("http://x/x", { method: "HEAD" }));
  expect(res.status).toBe(404);
  expect(await res.text()).toBe("");
});

test("HEAD on unknown path returns 404", async () => {
  const app = makeApp();
  const res = await app.dispatch(new Request("http://x/nope", { method: "HEAD" }));
  expect(res.status).toBe(404);
});

test("HEAD on a path without GET returns 405 with Allow", async () => {
  const app = makeApp();
  app.post("/x", async () => "ok");

  const res = await app.dispatch(new Request("http://x/x", { method: "HEAD" }));
  expect(res.status).toBe(405);
  expect(res.headers.get("allow")).toBe("POST");
});

test("OPTIONS on a known GET route returns 204 with Allow", async () => {
  const app = makeApp();
  app.get("/api", async () => "ok");

  const res = await app.dispatch(new Request("http://x/api", { method: "OPTIONS" }));
  expect(res.status).toBe(204);
  expect(res.headers.get("allow")).toBe("GET, HEAD");
  expect(await res.text()).toBe("");
});

test("OPTIONS on unknown path returns 404", async () => {
  const app = makeApp();
  const res = await app.dispatch(new Request("http://x/nope", { method: "OPTIONS" }));
  expect(res.status).toBe(404);
});

test("405 Allow header lists the path's methods with HEAD implied by GET", async () => {
  const app = makeApp();
  app.get("/x", async () => "ok");

  const res = await app.dispatch(new Request("http://x/x", { method: "POST" }));
  expect(res.status).toBe(405);
  expect(res.headers.get("allow")).toBe("GET, HEAD");
});

test("405 Allow lists explicit HEAD and OPTIONS registrations", async () => {
  const app = makeApp();
  app.get("/x", async () => "ok");
  app.head("/x", async () => "ok");
  app.options("/x", async () => new Response(null, { status: 204 }));

  const res = await app.dispatch(new Request("http://x/x", { method: "PUT" }));
  expect(res.status).toBe(405);
  expect(res.headers.get("allow")).toBe("GET, HEAD, OPTIONS");
});

test("explicit OPTIONS route takes precedence over the auto-response", async () => {
  const app = makeApp();
  app.get("/x", async () => "ok");
  app.options("/x", async () => new Response("opts", { status: 200 }));

  const res = await app.dispatch(new Request("http://x/x", { method: "OPTIONS" }));
  expect(res.status).toBe(200);
  expect(await res.text()).toBe("opts");
});

test("app.route registers a custom method", async () => {
  const app = makeApp();
  app.route("PURGE", "/cache", async () => new Response("purged"));

  const res = await app.dispatch(new Request("http://x/cache", { method: "PURGE" }));
  expect(res.status).toBe(200);
  expect(await res.text()).toBe("purged");

  const bad = await app.dispatch(new Request("http://x/cache", { method: "GET" }));
  expect(bad.status).toBe(405);
  expect(bad.headers.get("allow")).toBe("PURGE");
});

test("app.route with deps resolves the declared dependencies", async () => {
  const app = makeApp();
  class Svc {
    ping(): string {
      return "pong";
    }
  }
  app.injectSingleton(Svc);
  app.route("REPORT", "/r", { svc: Svc }, async (_req, { svc }) => new Response(svc.ping()));

  const res = await app.dispatch(new Request("http://x/r", { method: "REPORT" }));
  expect(res.status).toBe(200);
  expect(await res.text()).toBe("pong");
});

test("contract procedure with HEAD method registers and dispatches", async () => {
  const app = makeApp();
  app.implement(zc.head("/ping").output(z.string()), () => "pong");

  const res = await app.dispatch(new Request("http://x/ping", { method: "HEAD" }));
  expect(res.status).toBe(200);
  expect(await res.json()).toBe("pong");
});

test("contract procedure with OPTIONS method registers and dispatches", async () => {
  const app = makeApp();
  app.implement(zc.options("/caps"), () => "ok");

  const res = await app.dispatch(new Request("http://x/caps", { method: "OPTIONS" }));
  expect(res.status).toBe(200);
  expect(await res.json()).toBe("ok");
});

test("group supports head/options/route under its prefix", async () => {
  const app = makeApp();
  app.group("/g", (g) => {
    g.get("/x", async () => "get");
    g.options("/x", async () => new Response(null, { status: 204 }));
    g.route("PURGE", "/y", async () => new Response("purged"));
  });

  const head = await app.dispatch(new Request("http://x/g/x", { method: "HEAD" }));
  expect(head.status).toBe(200);
  expect(await head.text()).toBe("");

  const opts = await app.dispatch(new Request("http://x/g/x", { method: "OPTIONS" }));
  expect(opts.status).toBe(204);

  const purge = await app.dispatch(new Request("http://x/g/y", { method: "PURGE" }));
  expect(purge.status).toBe(200);
  expect(await purge.text()).toBe("purged");
});
