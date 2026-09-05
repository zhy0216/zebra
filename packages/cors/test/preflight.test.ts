import { expect, test } from "bun:test";
import { Zebra } from "@zebra-web/core";

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
  expect(res.headers.get("vary")).toBe("Origin, Access-Control-Request-Headers");
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
  expect(res.headers.get("vary")).toBe("Access-Control-Request-Headers");
});

test("preflight: echoes Access-Control-Request-Headers by default", async () => {
  const app = makeApp({});
  const res = await preflight(app, {
    headers: { "access-control-request-headers": "X-Custom, Content-Type" },
  });
  expect(res.headers.get("access-control-allow-headers")).toBe("X-Custom, Content-Type");
  expect(res.headers.get("vary")).toBe("Access-Control-Request-Headers");
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

test.each([
  ["*", "Access-Control-Request-Headers"],
  ["https://example.com", "Origin, Access-Control-Request-Headers"],
])(
  "preflight varies reflected request headers for %s even when they are absent",
  async (origin, vary) => {
    const app = makeApp({ origin });
    for (const requested of [null, "X-First", "X-Second, Content-Type"]) {
      const response = await preflight(app, {
        headers: requested === null ? {} : { "access-control-request-headers": requested },
      });
      expect(response.status).toBe(204);
      expect(response.headers.get("vary")).toBe(vary);
      expect(response.headers.get("access-control-allow-headers")).toBe(requested);
    }
  },
);

test.each(["*", "https://example.com"])(
  "preflight with fixed allowed headers does not vary by request headers for %s",
  async (origin) => {
    for (const allowedHeaders of [[], ["Content-Type"]]) {
      const app = makeApp({ origin, allowedHeaders });
      for (const requested of [null, "X-First", "X-Second"]) {
        const response = await preflight(app, {
          headers: requested === null ? {} : { "access-control-request-headers": requested },
        });
        expect(response.headers.get("vary")).toBe(origin === "*" ? null : "Origin");
        expect(response.headers.get("access-control-allow-headers")).toBe(
          allowedHeaders.join(", "),
        );
      }
    }
  },
);

test("denied and absent preflight origins vary by Origin without reflecting requested headers", async () => {
  const app = makeApp({ origin: "https://example.com" });
  for (const origin of ["https://denied.example", null]) {
    const headers = new Headers({
      "access-control-request-method": "GET",
      "access-control-request-headers": "X-Custom",
    });
    if (origin !== null) headers.set("origin", origin);
    const response = await app.dispatch(
      new Request("http://test.local/api", { method: "OPTIONS", headers }),
    );
    expect(response.status).toBe(204);
    expect(response.headers.get("vary")).toBe("Origin");
    expect(response.headers.get("access-control-allow-origin")).toBeNull();
    expect(response.headers.get("access-control-allow-headers")).toBeNull();
  }
});
