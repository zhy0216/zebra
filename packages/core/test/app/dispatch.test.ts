import "reflect-metadata";
import { expect, test } from "bun:test";
import { Zebra } from "../../src/app/app.ts";
import { Container } from "../../src/di/container.ts";

test("registers a GET route and dispatches it", async () => {
  const app = new Zebra({ container: new Container() });
  app.get("/hello/:name", async (req) => new Response(`hi ${req.params.name}`));

  const res = await app.dispatch(new Request("http://x/hello/yang"));
  expect(res.status).toBe(200);
  expect(await res.text()).toBe("hi yang");
});

test("handler returning non-Response gets JSON-wrapped", async () => {
  const app = new Zebra({ container: new Container() });
  app.get("/data", async () => ({ a: 1 }));
  const res = await app.dispatch(new Request("http://x/data"));
  expect(res.headers.get("content-type")).toContain("application/json");
  expect(await res.json()).toEqual({ a: 1 });
});

test("unmatched path returns 404 Problem+Json", async () => {
  const app = new Zebra({ container: new Container() });
  const res = await app.dispatch(new Request("http://x/none"));
  expect(res.status).toBe(404);
});
