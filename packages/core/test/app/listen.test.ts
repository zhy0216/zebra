import "reflect-metadata";
import { expect, test } from "bun:test";
import { Zebra } from "../../src/app/app.ts";

test("listen passes idleTimeout, maxRequestBodySize, reusePort, and tls through to Bun.serve", async () => {
  const original = Bun.serve;
  let captured: Record<string, unknown> | undefined;
  const fakeServer = {
    port: 9876,
    stop: async () => undefined,
  };
  (Bun as { serve: unknown }).serve = ((opts: object) => {
    captured = opts as Record<string, unknown>;
    return fakeServer;
  }) as typeof Bun.serve;

  const app = new Zebra();
  try {
    const { port } = await app.listen({
      port: 0,
      hostname: "127.0.0.1",
      idleTimeout: 45,
      maxRequestBodySize: 2048,
      reusePort: true,
      tls: { key: "key", cert: "cert" },
    });
    expect(port).toBe(9876);
  } finally {
    (Bun as { serve: unknown }).serve = original;
    await app.stop();
  }

  expect(captured).toEqual({
    port: 0,
    hostname: "127.0.0.1",
    idleTimeout: 45,
    maxRequestBodySize: 2048,
    reusePort: true,
    tls: { key: "key", cert: "cert" },
    fetch: expect.any(Function),
    websocket: expect.any(Object),
  });
});

test("listen without extra options only passes port, hostname, fetch, and websocket", async () => {
  const original = Bun.serve;
  let captured: Record<string, unknown> | undefined;
  (Bun as { serve: unknown }).serve = ((opts: object) => {
    captured = opts as Record<string, unknown>;
    return { port: 0, stop: async () => undefined };
  }) as typeof Bun.serve;

  const app = new Zebra();
  try {
    await app.listen({ port: 0 });
  } finally {
    (Bun as { serve: unknown }).serve = original;
    await app.stop();
  }

  expect(Object.keys(captured ?? {})).toEqual(["port", "fetch", "websocket"]);
});

test("transport maxRequestBodySize rejects oversized bodies before the handler runs", async () => {
  const app = new Zebra();
  let hit = 0;
  app.post("/up", async (req) => {
    hit++;
    await req.body();
    return new Response("ok");
  });
  const { port } = await app.listen({ port: 0, maxRequestBodySize: 1024 });
  try {
    const res = await fetch(`http://localhost:${port}/up`, {
      method: "POST",
      body: "x".repeat(4096),
    });
    expect(res.status).toBe(413);
    expect(hit).toBe(0);

    const small = await fetch(`http://localhost:${port}/up`, {
      method: "POST",
      body: "ok",
    });
    expect(small.status).toBe(200);
    expect(await small.text()).toBe("ok");
    expect(hit).toBe(1);  } finally {
    await app.stop();
  }
});

test("app-level body limits answer 413 Problem+Json independently of the transport limit", async () => {
  const app = new Zebra({ body: { maxSize: 1024, json: { limit: 1024 } } });
  let parsed = false;
  app.post("/up", async (req) => {
    await req.body();
    parsed = true;
    return "ok";
  });
  // Transport limit is much larger than the app limit: the parser must still enforce its own.
  const { port } = await app.listen({ port: 0, maxRequestBodySize: 1024 * 1024 });
  try {
    const res = await fetch(`http://localhost:${port}/up`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ big: "x".repeat(2048) }),
    });
    expect(res.status).toBe(413);
    expect(res.headers.get("content-type")).toContain("application/problem+json");
    expect(parsed).toBe(false);
  } finally {
    await app.stop();
  }
});

test("a transport limit smaller than the app limit wins first with a bare 413", async () => {
  const app = new Zebra({ body: { maxSize: 1024, json: { limit: 1024 } } });
  let parsed = false;
  app.post("/up", async (req) => {
    await req.body();
    parsed = true;
    return "ok";
  });
  // Transport limit smaller than the app limit: the transport 413 wins first.
  const { port } = await app.listen({ port: 0, maxRequestBodySize: 512 });
  try {
    const res = await fetch(`http://localhost:${port}/up`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ big: "x".repeat(1024) }),
    });
    expect(res.status).toBe(413);
    expect(parsed).toBe(false);
  } finally {
    await app.stop();
  }
});
