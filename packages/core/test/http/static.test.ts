import { expect, test } from "bun:test";
import { resolve } from "node:path";
import { serveStatic } from "../../src/http/static.ts";

const root = resolve(import.meta.dir, "fixtures/static");

test("serves a file inside root", async () => {
  const res = await serveStatic(root, "hello.txt", { index: "index.html", maxAge: 60 });
  expect(res.status).toBe(200);
  expect(await res.text()).toBe("hello world\n");
});

test("serves index when path is empty", async () => {
  const res = await serveStatic(root, "", { index: "index.html", maxAge: 60 });
  expect(res.status).toBe(200);
  expect(await res.text()).toContain("<h1>Index</h1>");
});

test("blocks path traversal via ..", async () => {
  const res = await serveStatic(root, "../package.json", { index: "index.html", maxAge: 60 });
  expect(res.status).toBe(403);
});

test("blocks absolute paths", async () => {
  const res = await serveStatic(root, "/etc/passwd", { index: "index.html", maxAge: 60 });
  expect(res.status).toBe(403);
});

test("missing file returns 404", async () => {
  const res = await serveStatic(root, "nope.txt", { index: "index.html", maxAge: 60 });
  expect(res.status).toBe(404);
});
