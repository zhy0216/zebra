// C5: end-to-end integration tests through `createTestApp`.
//
// The unit suites (origin/preflight/inject.test.ts) exercise the middleware
// with a bare `Zebra` + `dispatch`. These tests go through the full
// `createTestApp` pipeline (`prepare`/`boot` + dispatch) and cover the §8.4
// `@zebra/cors` use case end-to-end:
// - preflight (OPTIONS + Access-Control-Request-Method) → 204 with the full
//   header set: Allow-Origin / Allow-Credentials / Allow-Methods /
//   Allow-Headers / Max-Age
// - actual-request injection on GET and POST (Allow-Origin + Vary: Origin)
// - credentials: true echoes the exact origin, never `*`
// - disallowed origins receive no CORS headers at all
// - preflight leaves the normal GET/POST flow untouched

import { expect, test } from "bun:test";
import type { ZebraRequest } from "@zebra/core";
import { createTestApp, type TestApp } from "@zebra/testing";

import { cors, type CorsOptions } from "../src/index.ts";

const ALLOWED = "https://example.com";
const EVIL = "https://evil.example";

/** An app with business routes behind the CORS middleware. */
function makeApp(opts: CorsOptions): TestApp {
  const app = createTestApp();
  app.use(cors(opts));
  app.get("/api/data", async () => Response.json({ ok: true, value: 1 }));
  app.post("/api/data", async (req: ZebraRequest) => {
    const { value } = (await req.body()) as { value: number };
    return Response.json({ ok: true, value });
  });
  return app;
}

const PREFLIGHT: RequestInit = {
  method: "OPTIONS",
  headers: { origin: ALLOWED, "access-control-request-method": "GET" },
};

const GET: RequestInit = { method: "GET", headers: { origin: ALLOWED } };

const POST: RequestInit = {
  method: "POST",
  headers: { origin: ALLOWED, "content-type": "application/json" },
  body: JSON.stringify({ value: 42 }),
};

test("preflight: 204 with the full header set (Allow-Origin / -Credentials / -Methods / -Headers / Max-Age)", async () => {
  const app = makeApp({
    origin: [ALLOWED],
    credentials: true,
    methods: ["GET", "POST"],
    allowedHeaders: ["Content-Type", "X-Custom"],
    maxAge: 600,
  });
  const res = await app.request("/api/data", PREFLIGHT);
  expect(res.status).toBe(204);
  expect(res.headers.get("access-control-allow-origin")).toBe(ALLOWED);
  expect(res.headers.get("access-control-allow-credentials")).toBe("true");
  expect(res.headers.get("access-control-allow-methods")).toBe("GET, POST");
  expect(res.headers.get("access-control-allow-headers")).toBe("Content-Type, X-Custom");
  expect(res.headers.get("access-control-max-age")).toBe("600");
  expect(res.headers.get("vary")).toBe("Origin");
});

test("actual request: GET with Origin gets Allow-Origin and Vary, business data intact", async () => {
  const app = makeApp({ origin: [ALLOWED] });
  const res = await app.request("/api/data", GET);
  expect(res.status).toBe(200);
  expect(res.headers.get("access-control-allow-origin")).toBe(ALLOWED);
  expect(res.headers.get("vary")).toBe("Origin");
  expect(await res.json()).toEqual({ ok: true, value: 1 });
});

test("actual request: POST with Origin gets the same injection and the body round-trips", async () => {
  const app = makeApp({ origin: [ALLOWED] });
  const res = await app.request("/api/data", POST);
  expect(res.status).toBe(200);
  expect(res.headers.get("access-control-allow-origin")).toBe(ALLOWED);
  expect(res.headers.get("vary")).toBe("Origin");
  expect(await res.json()).toEqual({ ok: true, value: 42 });
});

test("credentials: true echoes the exact origin, never '*'", async () => {
  const app = makeApp({ credentials: true });
  const res = await app.request("/api/data", GET);
  expect(res.headers.get("access-control-allow-origin")).toBe(ALLOWED);
  expect(res.headers.get("access-control-allow-origin")).not.toBe("*");
  expect(res.headers.get("access-control-allow-credentials")).toBe("true");
  expect(res.headers.get("vary")).toBe("Origin");
});

test("disallowed origin: no CORS headers on preflight or actual requests", async () => {
  const app = makeApp({ origin: [ALLOWED] });
  const preflight = await app.request("/api/data", {
    method: "OPTIONS",
    headers: { origin: EVIL, "access-control-request-method": "GET" },
  });
  expect(preflight.status).toBe(204);
  expect(preflight.headers.get("access-control-allow-origin")).toBeNull();
  expect(preflight.headers.get("access-control-allow-methods")).toBeNull();
  // The rejection depends on the Origin — a shared cache must not reuse it
  // for other origins (Vary even on the rejected 204).
  expect(preflight.headers.get("vary")).toBe("Origin");

  const actual = await app.request("/api/data", { method: "GET", headers: { origin: EVIL } });
  expect(actual.status).toBe(200);
  expect(actual.headers.get("access-control-allow-origin")).toBeNull();
  expect(actual.headers.get("vary")).toBeNull();
  expect(await actual.json()).toEqual({ ok: true, value: 1 });
});

test("preflight does not disturb the normal GET/POST flow", async () => {
  const app = makeApp({ origin: [ALLOWED], methods: ["GET", "POST"] });
  const preflight = await app.request("/api/data", PREFLIGHT);
  expect(preflight.status).toBe(204);

  const get = await app.request("/api/data", GET);
  expect(get.status).toBe(200);
  expect(get.headers.get("access-control-allow-origin")).toBe(ALLOWED);
  expect(await get.json()).toEqual({ ok: true, value: 1 });

  const post = await app.request("/api/data", POST);
  expect(post.status).toBe(200);
  expect(post.headers.get("access-control-allow-origin")).toBe(ALLOWED);
  expect(await post.json()).toEqual({ ok: true, value: 42 });
});
