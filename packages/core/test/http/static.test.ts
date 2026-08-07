import { expect, test } from "bun:test";
import { resolve } from "node:path";
import { serveStatic } from "../../src/http/static.ts";

const root = resolve(import.meta.dir, "fixtures/static");
const opts = { index: "index.html", maxAge: 60 };

test("serves a file inside root", async () => {
  const res = await serveStatic(root, "hello.txt", opts);
  expect(res.status).toBe(200);
  expect(await res.text()).toBe("hello world\n");
});

test("serves index when path is empty", async () => {
  const res = await serveStatic(root, "", opts);
  expect(res.status).toBe(200);
  expect(await res.text()).toContain("<h1>Index</h1>");
});

test("blocks path traversal via ..", async () => {
  const res = await serveStatic(root, "../package.json", opts);
  expect(res.status).toBe(403);
});

test("blocks absolute paths", async () => {
  const res = await serveStatic(root, "/etc/passwd", opts);
  expect(res.status).toBe(403);
});

test("missing file returns 404", async () => {
  const res = await serveStatic(root, "nope.txt", opts);
  expect(res.status).toBe(404);
});

test("emits a weak ETag and honors If-None-Match", async () => {
  const first = await serveStatic(root, "hello.txt", opts);
  const etag = first.headers.get("etag");
  expect(etag).toMatch(/^W\//);

  const cached = await serveStatic(
    root,
    "hello.txt",
    opts,
    new Headers({ "if-none-match": etag ?? "" }),
  );
  expect(cached.status).toBe(304);

  const amongMany = await serveStatic(
    root,
    "hello.txt",
    opts,
    new Headers({ "if-none-match": `"other", ${etag}` }),
  );
  expect(amongMany.status).toBe(304);
});

test("serves a single byte range", async () => {
  const res = await serveStatic(
    root,
    "hello.txt",
    opts,
    new Headers({ range: "bytes=0-4" }),
  );
  expect(res.status).toBe(206);
  expect(res.headers.get("content-range")).toMatch(/^bytes 0-4\//);
  expect(await res.text()).toBe("hello");
});

test("returns 416 for an unsatisfiable range", async () => {
  const res = await serveStatic(
    root,
    "hello.txt",
    opts,
    new Headers({ range: "bytes=999-1000" }),
  );
  expect(res.status).toBe(416);
  expect(res.headers.get("content-range")).toMatch(/^bytes \*\//);
});
