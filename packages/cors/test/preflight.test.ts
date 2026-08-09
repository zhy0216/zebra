import { expect, test } from "bun:test";
import { Zebra } from "@zebra/core";

import { cors } from "../src/index.ts";

function makeApp(opts: Parameters<typeof cors>[0]) {
  const app = new Zebra();
  app.use(cors(opts));
  app.get("/api", async () => new Response("ok"));
  app.use(async () => new Response("opts"));
  return app;
}

function preflight(app: Zebra, init: RequestInit = {}) {
  const headers = {
    origin: "https://example.com",
    "access-control-request-method": "GET",
    ...(init.headers ?? {}),
  };
  return app.dispatch(
    new Request("http://test.local/api", {
      method: "OPTIONS",
      ...init,
      headers,
    }),
  );
}

test("preflight: 204 with full CORS header set", async () => {
  const app = makeApp({ origin: ["https://example.com"], methods: ["GET"], maxAge: 600 });
  const res = await preflight(app);
  expect(res.status).toBe(204);
  expect(res.headers.get("access-control-allow-origin")).toBe("https://example.com");
  expect(res.headers.get("vary")).toBe("Origin");
  expect(res.headers.get("access-control-allow-methods")).toBe("GET");
  expect(res.headers.get("access-control-max-age")).toBe("600");
  expect(res.headers.get("access-control-allow-credentials")).toBeNull();
});

test("preflight: credentials=true echoes origin and sets Allow-Credentials", async () => {
  const app = makeApp({ origin: ["https://example.com"], credentials: true });
  const res = await preflight(app);
  expect(res.headers.get("access-control-allow-origin")).toBe("https://example.com");
  expect(res.headers.get("access-control-allow-credentials")).toBe("true");
});

test("preflight: allow-all without credentials answers `*`", async () => {
  const app = makeApp({});
  const res = await preflight(app);
  expect(res.headers.get("access-control-allow-origin")).toBe("*");
  expect(res.headers.get("vary")).toBeNull();
});

test("preflight: echoes Access-Control-Request-Headers by default", async () => {
  const app = makeApp({});
  const res = await preflight(app, {
    headers: { "access-control-request-headers": "X-Custom, Content-Type" },
  });
  expect(res.headers.get("access-control-allow-headers")).toBe("X-Custom, Content-Type");
});

test("preflight: disallowed origin → 204 with no CORS headers", async () => {
  const app = makeApp({ origin: ["https://allowed.example"] });
  const res = await preflight(app);
  expect(res.status).toBe(204);
  expect(res.headers.get("access-control-allow-origin")).toBeNull();
  expect(res.headers.get("access-control-allow-methods")).toBeNull();
});

test("non-preflight OPTIONS passes through untouched", async () => {
  const app = makeApp({});
  const res = await app.dispatch(new Request("http://test.local/anything", { method: "OPTIONS" }));
  expect(res.status).toBe(200);
  expect(await res.text()).toBe("opts");
});

test("non-preflight OPTIONS on a known route gets the auto-204 with Allow plus CORS headers", async () => {
  const app = new Zebra();
  app.use(cors({}));
  app.get("/api", async () => new Response("ok"));
  const res = await app.dispatch(
    new Request("http://test.local/api", {
      method: "OPTIONS",
      headers: { origin: "https://example.com" },
    }),
  );
  expect(res.status).toBe(204);
  expect(res.headers.get("allow")).toBe("GET, HEAD");
  expect(res.headers.get("access-control-allow-origin")).toBe("*");
  expect(await res.text()).toBe("");
});

test("regular request without Origin passes through untouched", async () => {
  const app = makeApp({});
  const res = await app.dispatch(new Request("http://test.local/api"));
  expect(res.status).toBe(200);
  expect(res.headers.get("access-control-allow-origin")).toBeNull();
});
