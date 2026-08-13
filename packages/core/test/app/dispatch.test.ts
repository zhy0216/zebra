import "reflect-metadata";
import { expect, test } from "bun:test";
import { Zebra } from "../../src/app/app.ts";
import { Container } from "../../src/di/container.ts";
import { html, json, redirect, text } from "../../src/http/response.ts";

test("registers a GET route and dispatches it", async () => {
  const app = new Zebra({ container: new Container() });
  app.get("/hello/:name", async (req) => new Response(`hi ${req.params.name}`));

  const res = await app.dispatch(new Request("http://x/hello/yang"));
  expect(res.status).toBe(200);
  expect(await res.text()).toBe("hi yang");
});

test("dispatch without a server leaves req.ip undefined", async () => {
  const app = new Zebra({ container: new Container() });
  let seen: string | undefined = "unset";
  app.get("/", async (req) => {
    seen = req.ip;
    return new Response("ok");
  });
  await app.dispatch(new Request("http://x/"));
  expect(seen).toBeUndefined();
});

test("dispatch forwards the socket ip to handlers (trustProxy never turns it into XFF)", async () => {
  const app = new Zebra({ container: new Container(), trustProxy: true });
  let seen: string | undefined;
  app.get("/", async (req) => {
    seen = req.ip;
    return new Response("ok");
  });
  await app.dispatch(
    new Request("http://x/", { headers: { "x-forwarded-for": "203.0.113.66" } }),
    "127.0.0.1",
  );
  // req.ip is the socket peer address, never the spoofable header.
  expect(seen).toBe("127.0.0.1");
});

test("non-JSON-serializable handler results become a structured 500", async () => {
  const app = new Zebra({ container: new Container() });
  app.get("/bigint", async () => 1n);
  const circular: Record<string, unknown> = {};
  circular.self = circular;
  app.get("/circular", async () => circular);

  for (const path of ["/bigint", "/circular"]) {
    const res = await app.dispatch(new Request(`http://x${path}`));
    expect(res.status).toBe(500);
    expect(res.headers.get("content-type")).toContain("application/problem+json");
    const problem = (await res.json()) as { type: string };
    expect(problem.type).toContain("response_serialization");
  }
});

test("listen() plumbs the real peer address into req.ip", async () => {
  const app = new Zebra({ container: new Container() });
  let seen: string | undefined;
  app.get("/", async (req) => {
    seen = req.ip;
    return new Response("ok");
  });
  const { port } = await app.listen({ port: 0 });
  try {
    await fetch(`http://localhost:${port}/`, {
      headers: { "x-forwarded-for": "203.0.113.66" },
    });
  } finally {
    await app.stop();
  }
  // The real socket peer address (loopback, v4 or v6), never the spoofed header.
  expect(seen === "127.0.0.1" || seen === "::1").toBe(true);
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

test("request and response helpers round-trip through dispatch", async () => {
  const app = new Zebra({ container: new Container() });
  app.post("/echo", async (req) => json({ got: await req.json() }));
  const res = await app.dispatch(
    new Request("http://x/echo", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: '{"k":1}',
    }),
  );
  expect(res.headers.get("content-type")).toBe("application/json; charset=utf-8");
  expect(await res.json()).toEqual({ got: { k: 1 } });
});

test("redirect() and html() responses pass through dispatch", async () => {
  const app = new Zebra({ container: new Container() });
  app.get("/old", () => redirect("/new"));
  app.get("/new", () => html("<h1>moved</h1>"));
  const res = await app.dispatch(new Request("http://x/old"));
  expect(res.status).toBe(302);
  expect(res.headers.get("location")).toBe("/new");
  expect(res.body).toBeNull();
  const target = await app.dispatch(new Request("http://x/new"));
  expect(target.headers.get("content-type")).toBe("text/html; charset=utf-8");
  expect(await target.text()).toBe("<h1>moved</h1>");
});

test("value returns stay JSON-encoded; text() is the escape hatch", async () => {
  const app = new Zebra({ container: new Container() });
  app.get("/str", () => "hello");
  app.get("/plain", () => text("hello"));
  const str = await app.dispatch(new Request("http://x/str"));
  expect(str.headers.get("content-type")).toContain("application/json");
  expect(await str.text()).toBe('"hello"');
  const plain = await app.dispatch(new Request("http://x/plain"));
  expect(plain.headers.get("content-type")).toBe("text/plain; charset=utf-8");
  expect(await plain.text()).toBe("hello");
});

test("request helpers honor app body limits through dispatch", async () => {
  const app = new Zebra({ container: new Container() });
  app.post("/u", async (req) => text(await req.text()));
  const res = await app.dispatch(
    new Request("http://x/u", { method: "POST", body: "y".repeat(2 * 1024 * 1024) }),
  );
  expect(res.status).toBe(413);
});
