import { describe, expect, test } from "bun:test";
import { createTestApp } from "@zebra/testing";

import {
  accessLog,
  errorReporter,
  health,
  metrics,
  requestId,
  type AccessLogEntry,
} from "../src/index.ts";

describe("observability middleware set · pass-through", () => {
  test("all middlewares together leave normal requests untouched", async () => {
    const entries: AccessLogEntry[] = [];
    const reported: unknown[] = [];
    const m = metrics();
    const app = createTestApp();
    app.use(requestId());
    app.use(accessLog({ writer: (entry) => entries.push(entry) }));
    app.use(
      errorReporter((error) => {
        reported.push(error);
      }),
    );
    app.use(m);
    app.use(health());
    app.post("/items", async () => Response.json({ created: true }, { status: 201 }));

    const res = await app.request("/items", { method: "POST" });
    expect(res.status).toBe(201);
    expect(await res.json()).toEqual({ created: true });
    expect(res.headers.get("x-request-id")).toMatch(/^[0-9a-f-]{36}$/);
    expect(entries).toHaveLength(1);
    expect(entries[0]!.method).toBe("POST");
    expect(entries[0]!.path).toBe("/items");
    expect(entries[0]!.status).toBe(201);
    expect(entries[0]!.requestId).toBe(res.headers.get("x-request-id")!);
    expect(reported).toHaveLength(0);
    const s = m.snapshot();
    expect(s.totalRequests).toBe(1);
    expect(s.errors).toBe(0);
  });

  test("health probes are logged and counted like any other request", async () => {
    const entries: AccessLogEntry[] = [];
    const app = createTestApp();
    app.use(accessLog({ writer: (entry) => entries.push(entry) }));
    app.use(health());
    expect((await app.request("/healthz")).status).toBe(200);
    expect(entries).toHaveLength(1);
    expect(entries[0]!.path).toBe("/healthz");
  });

  test("a plain app without observability middleware keeps working", async () => {
    const app = createTestApp();
    app.get("/plain", () => Response.json({ ok: true }));
    const res = await app.request("/plain");
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ ok: true });
  });
});
