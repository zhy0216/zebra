import { expect, test } from "bun:test";
import { Zebra } from "@zebra/core";

import { cors } from "../src/index.ts";

function makeApp(
  opts: Parameters<typeof cors>[0],
  handler: () => Response = () => new Response("ok"),
) {
  const app = new Zebra();
  app.use(cors(opts));
  app.get("/api", handler);
  return app;
}

function get(app: Zebra, origin: string | null, init: RequestInit = {}) {
  const headers = new Headers(init.headers ?? {});
  if (origin !== null) headers.set("origin", origin);
  return app.dispatch(new Request("http://test.local/api", { ...init, headers }));
}

test("inject: default `*` config answers `*` without Vary", async () => {
  const app = makeApp({});
  const res = await get(app, "https://example.com");
  expect(res.status).toBe(200);
  expect(res.headers.get("access-control-allow-origin")).toBe("*");
  expect(res.headers.get("vary")).toBeNull();
  expect(await res.text()).toBe("ok");
});

test("inject: specific origin is echoed with Vary: Origin", async () => {
  const app = makeApp({ origin: ["https://example.com"] });
  const res = await get(app, "https://example.com");
  expect(res.headers.get("access-control-allow-origin")).toBe("https://example.com");
  expect(res.headers.get("vary")).toBe("Origin");
});

test("inject: credentials=true echoes origin and sets Allow-Credentials", async () => {
  const app = makeApp({ credentials: true });
  const res = await get(app, "https://example.com");
  expect(res.headers.get("access-control-allow-origin")).toBe("https://example.com");
  expect(res.headers.get("access-control-allow-credentials")).toBe("true");
});

test("inject: exposedHeaders are advertised", async () => {
  const app = makeApp({ exposedHeaders: ["X-Total-Count", "X-Rate-Limit"] });
  const res = await get(app, "https://example.com");
  expect(res.headers.get("access-control-expose-headers")).toBe("X-Total-Count, X-Rate-Limit");
});

test("inject: handler's Vary header is merged, not overwritten", async () => {
  const app = makeApp(
    { origin: "https://example.com" },
    () => new Response("ok", { headers: { vary: "Accept-Encoding" } }),
  );
  const res = await get(app, "https://example.com");
  expect(res.headers.get("vary")).toBe("Accept-Encoding, Origin");
});

test("inject: disallowed origin → no CORS headers, body untouched", async () => {
  const app = makeApp({ origin: ["https://allowed.example"] });
  const res = await get(app, "https://evil.example");
  expect(res.headers.get("access-control-allow-origin")).toBeNull();
  expect(res.headers.get("vary")).toBeNull();
  expect(res.headers.get("access-control-allow-credentials")).toBeNull();
  expect(await res.text()).toBe("ok");
});

test("inject: no Origin header → no CORS headers", async () => {
  const app = makeApp({});
  const res = await get(app, null);
  expect(res.headers.get("access-control-allow-origin")).toBeNull();
  expect(await res.text()).toBe("ok");
});

test("inject: preserves status, statusText and streaming body semantics", async () => {
  const stream = new ReadableStream({
    start(controller) {
      controller.enqueue(new TextEncoder().encode("streamed-"));
      controller.close();
    },
  });
  const app = makeApp(
    { origin: "https://example.com" },
    () =>
      new Response(stream, { status: 201, statusText: "Created", headers: { "x-handler": "1" } }),
  );
  const res = await get(app, "https://example.com");
  expect(res.status).toBe(201);
  expect(res.statusText).toBe("Created");
  expect(res.headers.get("x-handler")).toBe("1");
  expect(res.headers.get("access-control-allow-origin")).toBe("https://example.com");
  expect(await res.text()).toBe("streamed-");
});
