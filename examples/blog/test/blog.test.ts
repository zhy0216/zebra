import { describe, expect, test } from "bun:test";

import { buildBlogApp } from "../src/app.ts";

// Integration tests drive the real composition root (buildBlogApp) through
// app.dispatch() — same DI and error handling as the running server, just
// without sockets.
function buildTestApp() {
  const app = buildBlogApp();
  const request = (path: string, init: RequestInit = {}) =>
    app.dispatch(new Request(`http://test.local${path}`, init));
  return { app, request };
}

function jsonBody(value: unknown): { body: string; headers: Record<string, string> } {
  return { body: JSON.stringify(value), headers: { "content-type": "application/json" } };
}

describe("blog", () => {
  test("create → list → get round-trip", async () => {
    const { request } = buildTestApp();
    const created = await request("/blogs", {
      method: "POST",
      ...jsonBody({ title: "hi", content: "body" }),
    });
    expect(created.status).toBe(200);
    expect(await created.json()).toEqual({ id: 1, title: "hi", content: "body" });

    expect(await (await request("/blogs")).json()).toEqual([
      { id: 1, title: "hi", content: "body" },
    ]);
    expect(await (await request("/blogs/1")).json()).toEqual({
      id: 1,
      title: "hi",
      content: "body",
    });
  });

  test("missing blog is a structured 404; delete removes it", async () => {
    const { request } = buildTestApp();
    const missing = await request("/blogs/99");
    expect(missing.status).toBe(404);
    expect((await missing.json()) as { type: string }).toEqual(
      expect.objectContaining({ type: expect.stringContaining("blog_not_found") }),
    );

    await request("/blogs", { method: "POST", ...jsonBody({ title: "t", content: "c" }) });
    const removed = await request("/blogs/1", { method: "DELETE" });
    expect(await removed.json()).toEqual({ deleted: true });
    expect((await request("/blogs/1")).status).toBe(404);
  });
});
