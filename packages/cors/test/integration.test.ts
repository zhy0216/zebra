// C5: end-to-end integration tests through `createTestApp`.
//
// The unit suites (origin/preflight/inject.test.ts) exercise the middleware
// with a bare `Zebra` + `dispatch`. These tests go through the full
// `createTestApp` pipeline (`prepare`/`boot` + dispatch) and cover the §8.4
// `@zebra-web/cors` use case end-to-end:
// - preflight (OPTIONS + Access-Control-Request-Method) → 204 with the full
//   header set: Allow-Origin / Allow-Credentials / Allow-Methods /
//   Allow-Headers / Max-Age
// - actual-request injection on GET and POST (Allow-Origin + Vary: Origin)
// - credentials: true echoes the exact origin, never `*`
// - disallowed origins receive no CORS headers at all
// - preflight leaves the normal GET/POST flow untouched

import { expect, test } from "bun:test";
import type { ZebraRequest } from "@zebra-web/core";
import { type TestApp, createTestApp } from "@zebra-web/testing";

import { type CorsOptions, cors } from "../src/index.ts";

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
  expect(actual.headers.get("vary")).toBe("Origin");
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

/** A GET cache for one URL, selecting stored responses using their Vary fields. */
function cachedGet(app: TestApp, path: string) {
  type CachedResponse = ReturnType<Response["clone"]>;
  const entries: { requestHeaders: Headers; response: CachedResponse }[] = [];
  return async (origin: string | null): Promise<CachedResponse> => {
    const headers = new Headers();
    if (origin !== null) headers.set("origin", origin);
    const match = entries.find(({ requestHeaders, response }) =>
      (response.headers.get("vary") ?? "")
        .split(",")
        .map((field) => field.trim())
        .every(
          (field) =>
            field === "" || (field !== "*" && requestHeaders.get(field) === headers.get(field)),
        ),
    );
    if (match !== undefined) return match.response.clone();
    const response = await app.request(path, { headers });
    entries.push({ requestHeaders: headers, response: response.clone() });
    return response;
  };
}

const originPolicies: [string, NonNullable<CorsOptions["origin"]>][] = [
  ["exact", ALLOWED],
  ["allowlist", [ALLOWED]],
  ["regexp", /^https:\/\/example\.com$/],
  ["predicate", (origin) => origin === ALLOWED],
];

test.each(originPolicies)(
  "actual response cache separates allowed, denied and absent Origin for %s policies",
  async (_name, origin) => {
    const app = createTestApp();
    app.use(cors({ origin }));
    let requests = 0;
    app.get("/cached", () => {
      requests++;
      return Response.json({ ok: true }, { headers: { "cache-control": "public, max-age=60" } });
    });
    const get = cachedGet(app, "/cached");
    // Cache rejection and same-origin responses before a legitimate cross-origin
    // request, then revisit every variant to verify that it can be reused safely.
    for (const incoming of [EVIL, null, ALLOWED, EVIL, null, ALLOWED]) {
      const response = await get(incoming);
      expect(response.headers.get("access-control-allow-origin")).toBe(
        incoming === ALLOWED ? ALLOWED : null,
      );
      expect(await response.json()).toEqual({ ok: true });
    }
    expect(requests).toBe(3);
    for (const incoming of [EVIL, null, ALLOWED]) {
      expect((await get(incoming)).headers.get("vary")).toBe("Origin");
    }
  },
);

test("credentialed wildcard responses vary for absent and distinct allowed origins", async () => {
  const app = createTestApp();
  app.use(cors({ credentials: true }));
  let requests = 0;
  app.get("/cached", () => {
    requests++;
    return new Response("ok", { headers: { "cache-control": "public, max-age=60" } });
  });
  const get = cachedGet(app, "/cached");
  for (const origin of [null, ALLOWED, EVIL, null, ALLOWED, EVIL]) {
    const response = await get(origin);
    expect(response.headers.get("access-control-allow-origin")).toBe(origin);
    expect(response.headers.get("access-control-allow-credentials")).toBe(
      origin === null ? null : "true",
    );
    expect(response.headers.get("vary")).toBe("Origin");
    expect(await response.text()).toBe("ok");
  }
  expect(requests).toBe(3);
});

test.each([
  ["Accept-Encoding", "Accept-Encoding, Origin"],
  ["Accept-Encoding, origin", "Accept-Encoding, origin"],
  ["accept-encoding, ACCEPT-ENCODING, oRiGiN, Origin", "accept-encoding, oRiGiN"],
  ["*", "*"],
  ["Accept-Encoding, *, Origin", "*"],
])(
  "actual responses merge existing Vary %s without duplicate fields",
  async (existing, expected) => {
    const app = createTestApp();
    app.use(cors({ origin: ALLOWED, credentials: true, exposedHeaders: ["X-Result"] }));
    app.get(
      "/varied",
      () =>
        new Response("business response", {
          status: 201,
          statusText: "Created",
          headers: { vary: existing, "x-result": "1" },
        }),
    );
    for (const origin of [ALLOWED, EVIL, null]) {
      const headers = new Headers();
      if (origin !== null) headers.set("origin", origin);
      const response = await app.request("/varied", { headers });
      expect(response.headers.get("vary")).toBe(expected);
      expect(response.headers.get("access-control-allow-origin")).toBe(
        origin === ALLOWED ? ALLOWED : null,
      );
      expect(response.headers.get("access-control-allow-credentials")).toBe(
        origin === ALLOWED ? "true" : null,
      );
      expect(response.headers.get("access-control-expose-headers")).toBe(
        origin === ALLOWED ? "X-Result" : null,
      );
      expect(response.status).toBe(201);
      expect(response.statusText).toBe("Created");
      expect(response.headers.get("x-result")).toBe("1");
      expect(await response.text()).toBe("business response");
    }
  },
);

test("uncredentialed wildcard actual responses keep their existing Vary unchanged", async () => {
  const app = createTestApp();
  app.use(cors());
  app.get("/varied", () => new Response("ok", { headers: { vary: "Accept-Encoding" } }));
  for (const origin of [ALLOWED, EVIL, null]) {
    const headers = new Headers();
    if (origin !== null) headers.set("origin", origin);
    const response = await app.request("/varied", { headers });
    expect(response.headers.get("vary")).toBe("Accept-Encoding");
    expect(response.headers.get("access-control-allow-origin")).toBe(origin === null ? null : "*");
  }
});
