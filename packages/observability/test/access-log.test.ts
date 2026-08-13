import { describe, expect, mock, test } from "bun:test";
import { type ZebraRequest, buildRequest } from "@zebra/core";
import { createTestApp } from "@zebra/testing";

import { type AccessLogEntry, REQUEST_ID_KEY, accessLog, requestId } from "../src/index.ts";

function makeReq(path = "/"): ZebraRequest {
  return buildRequest(new Request(`http://test.local${path}`), {});
}

const okNext = async (): Promise<Response> => new Response("ok", { status: 200 });

describe("accessLog middleware", () => {
  test("records method, path, status, duration, request id and timestamp via a custom writer", async () => {
    const entries: AccessLogEntry[] = [];
    const mw = accessLog({ writer: (entry) => entries.push(entry) });
    const req = makeReq("/items?q=1");
    req.ctx.set(REQUEST_ID_KEY, "rid-1");
    await mw(req, async () => new Response("created", { status: 201 }));
    expect(entries).toHaveLength(1);
    const entry = entries[0]!;
    expect(entry.method).toBe("GET");
    expect(entry.path).toBe("/items");
    expect(entry.status).toBe(201);
    expect(entry.requestId).toBe("rid-1");
    expect(entry.durationMs).toBeGreaterThanOrEqual(0);
    expect(typeof entry.timestamp).toBe("number");
    expect(entry.error).toBeUndefined();
  });

  test("records an entry carrying the error and rethrows unchanged", async () => {
    const entries: AccessLogEntry[] = [];
    const mw = accessLog({ writer: (entry) => entries.push(entry) });
    const boom = new Error("boom");
    await expect(mw(makeReq("/boom"), async () => Promise.reject(boom))).rejects.toBe(boom);
    expect(entries).toHaveLength(1);
    expect(entries[0]!.status).toBeUndefined();
    expect(entries[0]!.error).toBe(boom);
    expect(entries[0]!.path).toBe("/boom");
  });

  test("default writer emits a formatted single line via console.log", async () => {
    const log = mock((_line: string) => {});
    const original = console.log;
    console.log = log;
    try {
      const mw = accessLog();
      await mw(makeReq(), okNext);
    } finally {
      console.log = original;
    }
    expect(log).toHaveBeenCalledTimes(1);
    const line = String(log.mock.calls[0]![0]);
    expect(line).toContain("GET / 200");
    expect(line).toContain("ms");
  });

  test("a throwing writer never breaks the response", async () => {
    const mw = accessLog({
      writer: () => {
        throw new Error("writer exploded");
      },
    });
    const res = await mw(makeReq(), okNext);
    expect(res.status).toBe(200);
  });

  test("ids containing newlines are neutralized in the default log line", async () => {
    const log = mock((_line: string) => {});
    const original = console.log;
    console.log = log;
    try {
      // The generator bypass is intentional — the requestId middleware does
      // not validate generated ids; formatEntry is the last line of defense.
      const app = createTestApp();
      app.use(requestId({ generator: () => "bad\nid" }));
      app.use(accessLog());
      app.get("/x", () => new Response("ok"));
      await app.request("/x");
    } finally {
      console.log = original;
    }
    const line = String(log.mock.calls[0]![0]);
    expect(line).toContain("bad id");
    expect(line).not.toContain("bad\nid");
  });
});

describe("accessLog middleware · integration through core", () => {
  test("the request id from the requestId middleware lands in the entry", async () => {
    const entries: AccessLogEntry[] = [];
    const app = createTestApp();
    app.use(requestId());
    app.use(accessLog({ writer: (entry) => entries.push(entry) }));
    app.get("/x", () => Response.json({ ok: true }));
    const res = await app.request("/x", { headers: { "x-request-id": "abc" } });
    expect(res.status).toBe(200);
    expect(entries).toHaveLength(1);
    expect(entries[0]!.method).toBe("GET");
    expect(entries[0]!.path).toBe("/x");
    expect(entries[0]!.status).toBe(200);
    expect(entries[0]!.requestId).toBe("abc");
  });

  test("thrown handler errors stay Problem+Json while being logged", async () => {
    const entries: AccessLogEntry[] = [];
    const app = createTestApp();
    app.use(requestId());
    app.use(accessLog({ writer: (entry) => entries.push(entry) }));
    app.get("/boom", () => {
      throw new Error("boom");
    });
    const res = await app.request("/boom");
    expect(res.status).toBe(500);
    expect(res.headers.get("content-type")).toBe("application/problem+json; charset=utf-8");
    expect(entries).toHaveLength(1);
    expect(entries[0]!.path).toBe("/boom");
    expect(entries[0]!.status).toBeUndefined();
    expect(entries[0]!.error).toBeInstanceOf(Error);
  });
});
