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
});
