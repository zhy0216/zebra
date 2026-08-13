import { describe, expect, test } from "bun:test";
import { type ZebraRequest, buildRequest } from "@zebra/core";
import { createTestApp } from "@zebra/testing";

import { REQUEST_ID_KEY, getRequestId, requestId } from "../src/index.ts";

function makeReq(init: RequestInit = {}): ZebraRequest {
  return buildRequest(new Request("http://test.local/", init), {});
}

const okNext = async (): Promise<Response> => new Response("ok", { status: 200 });

describe("requestId middleware · id resolution", () => {
  test("keeps a client-provided x-request-id unchanged", async () => {
    const mw = requestId();
    const req = makeReq({ headers: { "x-request-id": "client-42" } });
    const res = await mw(req, okNext);
    expect(getRequestId(req)).toBe("client-42");
    expect(req.ctx.get(REQUEST_ID_KEY)).toBe("client-42");
    expect(res.headers.get("x-request-id")).toBe("client-42");
  });

  test("generates a UUID when the header is missing and echoes it on the response", async () => {
    const mw = requestId();
    const req = makeReq();
    const res = await mw(req, okNext);
    const id = getRequestId(req);
    expect(id).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/);
    expect(res.headers.get("x-request-id")).toBe(id!);
  });

  test("treats an empty header value as missing and generates an id", async () => {
    const mw = requestId();
    const req = makeReq({ headers: { "x-request-id": "" } });
    await mw(req, okNext);
    expect(getRequestId(req)).toMatch(/^[0-9a-f-]{36}$/);
  });

  test("rejects client ids with control characters (log injection, defense in depth)", async () => {
    // Bun's Headers refuse control characters outright, so fabricate a
    // lenient transport: the validation regex is the last line of defense
    // before client-provided values reach log lines.
    const mw = requestId();
    const req = {
      headers: { get: (name: string) => (name === "x-request-id" ? "ok\ninjected" : null) },
      ctx: new Map(),
      url: new URL("http://x/"),
    };
    await mw(req, okNext);
    expect(getRequestId(req)).toMatch(/^[0-9a-f-]{36}$/);
  });

  test("rejects overlong client ids", async () => {
    const mw = requestId();
    const req = makeReq({ headers: { "x-request-id": "x".repeat(129) } });
    await mw(req, okNext);
    expect(getRequestId(req)).toMatch(/^[0-9a-f-]{36}$/);
  });

  test("generated id is non-empty and stored on ctx", async () => {
    const mw = requestId();
    const req = makeReq();
    await mw(req, okNext);
    const id = getRequestId(req);
    expect(id).toBeDefined();
    expect(id!.length).toBeGreaterThan(0);
  });

  test("honors a custom header name", async () => {
    const mw = requestId({ headerName: "x-trace-id" });
    const req = makeReq({ headers: { "x-trace-id": "trace-7" } });
    const res = await mw(req, okNext);
    expect(getRequestId(req)).toBe("trace-7");
    expect(res.headers.get("x-trace-id")).toBe("trace-7");
  });

  test("uses the custom generator", async () => {
    const mw = requestId({ generator: () => "gen-id" });
    const req = makeReq();
    const res = await mw(req, okNext);
    expect(getRequestId(req)).toBe("gen-id");
    expect(res.headers.get("x-request-id")).toBe("gen-id");
  });

  test("does not echo the header when propagate is false", async () => {
    const mw = requestId({ propagate: false });
    const res = await mw(makeReq(), okNext);
    expect(res.headers.get("x-request-id")).toBeNull();
  });

  test("does not clobber a request-id header the handler already set", async () => {
    const mw = requestId();
    const res = await mw(
      makeReq(),
      async () => new Response("ok", { headers: { "x-request-id": "handler-set" } }),
    );
    expect(res.headers.get("x-request-id")).toBe("handler-set");
  });

  test("does not swallow handler exceptions", async () => {
    const mw = requestId();
    const boom = new Error("boom");
    await expect(mw(makeReq(), async () => Promise.reject(boom))).rejects.toBe(boom);
  });
});

describe("requestId middleware · integration through core", () => {
  test("the generated id is echoed on the response end to end", async () => {
    const app = createTestApp();
    app.use(requestId());
    app.get("/", () => Response.json({ ok: true }));
    const res = await app.request("/");
    expect(res.headers.get("x-request-id")).toMatch(/^[0-9a-f-]{36}$/);
  });

  test("route handlers can read the id via getRequestId", async () => {
    const app = createTestApp();
    app.use(requestId());
    app.get("/", (req) => Response.json({ id: getRequestId(req) }));
    const res = await app.request("/", { headers: { "x-request-id": "abc" } });
    expect(((await res.json()) as { id: string }).id).toBe("abc");
  });
});
