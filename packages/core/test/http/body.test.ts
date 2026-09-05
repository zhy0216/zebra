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

test("multipart over the total size limit rejects with 413 (streaming path)", async () => {
  // Chunked multipart body with no Content-Length, so the limit is enforced
  // while reading the stream rather than by the declared-size check.
  const boundary = "Xtest";
  const body = `--${boundary}\r\ncontent-disposition: form-data; name="f"; filename="a.txt"\r\ncontent-type: text/plain\r\n\r\n${"x".repeat(2048)}\r\n--${boundary}--\r\n`;
  const stream = new ReadableStream<Uint8Array>({
    start(controller) {
      controller.enqueue(new TextEncoder().encode(body));
      controller.close();
    },
  });
  const req = new Request("http://x", {
    method: "POST",
    headers: { "content-type": `multipart/form-data; boundary=${boundary}` },
    body: stream,
  });
  await expect(
    parseBody(req, {
      ...defaultOpts,
      maxSize: 4096,
      multipart: { limit: 1024, maxFiles: 4, maxFileSize: 512 },
    }),
  ).rejects.toMatchObject({ status: 413, code: "payload_too_large" });
});

test("multipart size-limit errors survive a rejected stream cancellation", async () => {
  let cancellations = 0;
  const req = new Request("http://x", {
    method: "POST",
    headers: { "content-type": "multipart/form-data; boundary=X" },
    body: new ReadableStream<Uint8Array>({
      pull(controller) {
        controller.enqueue(new Uint8Array(2048));
      },
      async cancel() {
        cancellations++;
        throw new Error("cancel failed");
      },
    }),
  });
  await expect(parseBody(req, defaultOpts)).rejects.toMatchObject({
    status: 413,
    code: "payload_too_large",
  });
  expect(cancellations).toBe(1);
});

test("multipart stream failures retain invalid_multipart while HttpErrors pass through", async () => {
  for (const failure of [
    new Error("socket reset"),
    new TypeError("stream read failed"),
    new HttpError(413, "payload_too_large", "Payload too large"),
  ]) {
    const req = new Request("http://x", {
      method: "POST",
      headers: { "content-type": "multipart/form-data; boundary=X" },
      body: new ReadableStream<Uint8Array>({
        pull(controller) {
          controller.error(failure);
        },
      }),
    });
    const parsed = parseBody(req, defaultOpts);
    if (failure instanceof HttpError) await expect(parsed).rejects.toBe(failure);
    else await expect(parsed).rejects.toMatchObject({ status: 400, code: "invalid_multipart" });
  }
});

test("multipart parse errors retain 400 for missing boundaries and empty payloads", async () => {
  for (const contentType of ["multipart/form-data", "multipart/form-data; boundary=X"]) {
    for (const body of [undefined, "", "invalid"]) {
      const req = new Request("http://x", {
        method: "POST",
        headers: { "content-type": contentType },
        ...(body === undefined ? {} : { body }),
      });
      await expect(parseBody(req, defaultOpts)).rejects.toMatchObject({
        status: 400,
        code: "invalid_multipart",
      });
    }
  }
});
