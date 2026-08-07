import { expect, test } from "bun:test";
import { type BodyOptions, parseBody } from "../../src/http/body.ts";
import { HttpError } from "../../src/http/errors.ts";

const defaultOpts: BodyOptions = {
  maxSize: 1024,
  json: { limit: 1024 },
  form: { limit: 1024 },
  multipart: { limit: 1024, maxFiles: 4, maxFileSize: 512 },
};

test("parses JSON body", async () => {
  const req = new Request("http://x", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ a: 1, b: "hi" }),
  });
  expect(await parseBody(req, defaultOpts)).toEqual({ a: 1, b: "hi" });
});

test("parses urlencoded form body", async () => {
  const req = new Request("http://x", {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body: "a=1&b=hi",
  });
  expect(await parseBody(req, defaultOpts)).toEqual({ a: "1", b: "hi" });
});

test("over-size throws 413 HttpError", async () => {
  const big = "x".repeat(2048);
  const req = new Request("http://x", {
    method: "POST",
    headers: { "content-type": "application/json", "content-length": String(big.length) },
    body: big,
  });
  await expect(parseBody(req, defaultOpts)).rejects.toMatchObject({ status: 413 });
});

test("invalid JSON throws 400 HttpError", async () => {
  const req = new Request("http://x", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: "{not json",
  });
  await expect(parseBody(req, defaultOpts)).rejects.toMatchObject({ status: 400 });
});

test("unknown content-type returns Uint8Array", async () => {
  const req = new Request("http://x", {
    method: "POST",
    headers: { "content-type": "application/octet-stream" },
    body: new Uint8Array([1, 2, 3]),
  });
  const r = await parseBody(req, defaultOpts);
  expect(r).toBeInstanceOf(Uint8Array);
  expect([...((r as Uint8Array) ?? [])]).toEqual([1, 2, 3]);
});

test("enforces limits while streaming when Content-Length is absent", async () => {
  const req = new Request("http://x", {
    method: "POST",
    headers: { "content-type": "application/octet-stream" },
    body: new Uint8Array(2048),
  });
  await expect(parseBody(req, defaultOpts)).rejects.toMatchObject({ status: 413 });
});

test("body limits count bytes rather than JavaScript characters", async () => {
  const opts = { ...defaultOpts, maxSize: 4, json: { limit: 4 } };
  const req = new Request("http://x", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: '"你好"',
  });
  await expect(parseBody(req, opts)).rejects.toMatchObject({ status: 413 });
});

test("multipart enforces maxFiles and maxFileSize", async () => {
  const form = new FormData();
  form.append("a", new File(["123"], "a.txt"));
  form.append("b", new File(["456"], "b.txt"));
  const req = new Request("http://x", { method: "POST", body: form });
  await expect(
    parseBody(req, {
      ...defaultOpts,
      maxSize: 4096,
      multipart: { limit: 4096, maxFiles: 1, maxFileSize: 512 },
    }),
  ).rejects.toMatchObject({ status: 413, code: "too_many_files" });
});
