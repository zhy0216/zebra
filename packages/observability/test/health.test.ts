import { describe, expect, test } from "bun:test";
import { createTestApp } from "@zebra-web/testing";

import { health } from "../src/index.ts";

describe("health middleware", () => {
  test("default liveness and readiness endpoints report ok", async () => {
    const app = createTestApp();
    app.use(health());
    app.get("/", () => Response.json({ hello: "world" }));
    const live = await app.request("/healthz");
    expect(live.status).toBe(200);
    expect(await live.json()).toEqual({ status: "ok" });
    const ready = await app.request("/readyz");
    expect(ready.status).toBe(200);
    expect(await ready.json()).toEqual({ status: "ok" });
  });

  test("a failing readiness probe yields 503 on /readyz while /healthz stays 200", async () => {
    const app = createTestApp();
    app.use(health({ readiness: () => false }));
    const ready = await app.request("/readyz");
    expect(ready.status).toBe(503);
    expect(await ready.json()).toEqual({ status: "unavailable" });
    expect((await app.request("/healthz")).status).toBe(200);
  });

  test("a failing liveness probe yields 503 on /healthz", async () => {
    const app = createTestApp();
    app.use(health({ liveness: () => false }));
    const live = await app.request("/healthz");
    expect(live.status).toBe(503);
    expect(await live.json()).toEqual({ status: "unavailable" });
  });

  test("supports async probes", async () => {
    const app = createTestApp();
    app.use(health({ readiness: async () => (await Promise.resolve(true)) === true }));
    expect((await app.request("/readyz")).status).toBe(200);
  });

  test("a throwing probe is treated as unavailable", async () => {
    const app = createTestApp();
    app.use(
      health({
        readiness: () => {
          throw new Error("db down");
        },
      }),
    );
    expect((await app.request("/readyz")).status).toBe(503);
  });

  test("honors custom path options", async () => {
    const app = createTestApp();
    app.use(health({ path: "/live", readinessPath: "/ready" }));
    expect((await app.request("/live")).status).toBe(200);
    expect((await app.request("/ready")).status).toBe(200);
    expect((await app.request("/healthz")).status).toBe(404);
  });

  test("passes all other paths through untouched", async () => {
    const app = createTestApp();
    app.use(health());
    app.get("/data", () => Response.json({ ok: true }));
    const res = await app.request("/data");
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ ok: true });
  });

  test.each(["/healthz", "/readyz"])(
    "HEAD %s runs the probe and returns GET status and headers without a body",
    async (path) => {
      for (const healthy of [true, false]) {
        const app = createTestApp();
        const calls: string[] = [];
        app.use(
          health({
            liveness: () => {
              calls.push("/healthz");
              return healthy;
            },
            readiness: async () => {
              calls.push("/readyz");
              return healthy;
            },
          }),
        );
        const get = await app.request(path);
        const head = await app.request(path, { method: "HEAD" });
        expect(get.status).toBe(healthy ? 200 : 503);
        expect(head.status).toBe(get.status);
        expect(head.headers.get("content-type")).toBe(get.headers.get("content-type"));
        expect(head.body).toBeNull();
        expect(await head.text()).toBe("");
        expect(calls).toEqual([path, path]);
      }
    },
  );

  test("HEAD honors custom liveness and readiness paths", async () => {
    const app = createTestApp();
    app.use(health({ path: "/live", readinessPath: "/ready", readiness: () => false }));
    const live = await app.request("/live", { method: "HEAD" });
    const ready = await app.request("/ready", { method: "HEAD" });
    expect(live.status).toBe(200);
    expect(ready.status).toBe(503);
    expect(live.body).toBeNull();
    expect(ready.body).toBeNull();
  });

  test.each([
    ["POST", "/healthz"],
    ["PUT", "/readyz"],
    ["PATCH", "/healthz"],
    ["DELETE", "/readyz"],
    ["OPTIONS", "/healthz"],
  ])(
    "%s %s reaches downstream middleware and the business handler without running probes",
    async (method, path) => {
      const app = createTestApp();
      let probes = 0;
      app.use(
        health({
          liveness: () => {
            probes++;
            return true;
          },
          readiness: () => {
            probes++;
            return true;
          },
        }),
      );
      const visited: string[] = [];
      app.use(async (_req, next) => {
        visited.push("middleware");
        return next();
      });
      app.route(method, path, () => {
        visited.push("handler");
        return Response.json({ method, business: true }, { status: 201 });
      });
      const response = await app.request(path, { method });
      expect(response.status).toBe(201);
      expect(await response.json()).toEqual({ method, business: true });
      expect(visited).toEqual(["middleware", "handler"]);
      expect(probes).toBe(0);
    },
  );
});
