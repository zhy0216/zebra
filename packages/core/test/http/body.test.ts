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

test("unknown content-type returns ArrayBuffer", async () => {
  const req = new Request("http://x", {
    method: "POST",
    headers: { "content-type": "application/octet-stream" },
    body: new Uint8Array([1, 2, 3]),
  });
  const r = await parseBody(req, defaultOpts);
  expect(r).toBeInstanceOf(ArrayBuffer);
});
