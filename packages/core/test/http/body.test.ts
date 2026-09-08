import { expect, mock, test } from "bun:test";
import { type BodyOptions, parseBody, readBody } from "../../src/http/body.ts";
import { HttpError } from "../../src/http/errors.ts";

const defaultOpts: BodyOptions = {
  maxSize: 1024,
  json: { limit: 1024 },
  form: { limit: 1024 },
  multipart: { limit: 1024, maxFiles: 4, maxFileSize: 512 },
};

function chunkedRequest(chunks: Uint8Array[], headers?: RequestInit["headers"]): Request {
  return new Request("http://x", {
    method: "POST",
    ...(headers === undefined ? {} : { headers }),
    body: new ReadableStream<Uint8Array>({
      start(controller) {
        for (const chunk of chunks) controller.enqueue(chunk);
        controller.close();
      },
    }),
  });
}

test.each([
  ["empty stream", () => []],
  ["empty chunks", () => [new Uint8Array(), new Uint8Array()]],
  ["single chunk", () => [new Uint8Array([0, 1, 127, 255])]],
  ["multiple chunks", () => [new Uint8Array([1, 2]), new Uint8Array([3, 255])]],
  ["interspersed empty chunks", () => [new Uint8Array(), new Uint8Array([4]), new Uint8Array()]],
  ["offset Uint8Array", () => [new Uint8Array([91, 0, 255, 92]).subarray(1, 3)]],
  ["offset Buffer", () => [Buffer.from([91, 0, 255, 92]).subarray(1, 3)]],
  [
    "mixed offset views sharing a backing buffer",
    () => {
      const bytes = new Uint8Array([91, 1, 2, 3, 4, 92]);
      return [bytes.subarray(1, 3), Buffer.from(bytes.buffer, 3, 2), bytes.subarray(2, 2)];
    },
  ],
] as const)(
  "readBody copies %s without exposing or changing backing bytes",
  async (_, makeChunks) => {
    const chunks = makeChunks();
    const expected = new Uint8Array(chunks.flatMap((chunk) => [...chunk]));
    const backings = [...new Set(chunks.map((chunk) => chunk.buffer))];
    const snapshots = backings.map((buffer) => new Uint8Array(buffer).slice());
    const raw = chunkedRequest(chunks);
    const onReadError = mock(() => {});
    const result = await readBody(raw, expected.byteLength, onReadError);

    expect(result).toBeInstanceOf(Uint8Array);
    expect(result).toEqual(expected);
    expect(result.byteOffset).toBe(0);
    expect(result.buffer.byteLength).toBe(expected.byteLength);
    expect(raw.body!.locked).toBe(false);
    expect(onReadError).not.toHaveBeenCalled();
    for (let i = 0; i < backings.length; i++) {
      expect(result.buffer).not.toBe(backings[i]);
      expect(new Uint8Array(backings[i]!)).toEqual(snapshots[i]!);
    }

    for (const chunk of chunks) chunk.fill(42);
    expect(result).toEqual(expected);
    const afterMutation = backings.map((buffer) => new Uint8Array(buffer).slice());
    result.fill(99);
    for (let i = 0; i < backings.length; i++) {
      expect(new Uint8Array(backings[i]!)).toEqual(afterMutation[i]!);
    }
  },
);

test("readBody returns independent empty bytes for bodyless requests", async () => {
  const raw = new Request("http://x");
  const onReadError = mock(() => {});
  const first = await readBody(raw, 0, onReadError);
  const second = await readBody(raw, 0, onReadError);
  expect(first).toEqual(new Uint8Array());
  expect(first.buffer).not.toBe(second.buffer);
  expect(onReadError).not.toHaveBeenCalled();
});

test.each([undefined, "0", "3"])(
  "readBody accepts the exact byte limit and rejects one extra byte with declaration %j",
  async (declared) => {
    const headers = declared === undefined ? {} : { "content-length": declared };
    for (const chunks of [
      [new Uint8Array([1, 2, 3])],
      [new Uint8Array([91, 1, 2, 92]).subarray(1, 3), Buffer.from([93, 3, 94]).subarray(1, 2)],
    ]) {
      expect(await readBody(chunkedRequest(chunks, headers), 3)).toEqual(new Uint8Array([1, 2, 3]));
      const onReadError = mock(() => {});
      const raw = chunkedRequest([...chunks, new Uint8Array([4])], headers);
      await expect(readBody(raw, 3, onReadError)).rejects.toMatchObject({
        status: 413,
        code: "payload_too_large",
        detail: { limit: 3 },
      });
      expect(raw.body!.locked).toBe(false);
      expect(onReadError).toHaveBeenCalledTimes(1);
    }
  },
);

test("readBody does not report declaration failures or reader conflicts as read errors", async () => {
  for (const state of ["invalid declaration", "oversized declaration", "used", "locked"] as const) {
    const headers =
      state === "invalid declaration"
        ? { "content-length": "invalid" }
        : state === "oversized declaration"
          ? { "content-length": "4" }
          : {};
    const raw = chunkedRequest([new Uint8Array([1, 2, 3])], headers);
    const onReadError = mock(() => {});
    if (state === "used") await raw.arrayBuffer();
    const reader = state === "locked" ? raw.body!.getReader() : undefined;
    try {
      const result = readBody(raw, 3, onReadError);
      if (state === "used" || state === "locked") {
        await expect(result).rejects.toBeInstanceOf(TypeError);
      } else {
        await expect(result).rejects.toMatchObject({
          status: state === "invalid declaration" ? 400 : 413,
        });
        expect(raw.bodyUsed).toBe(false);
      }
      expect(onReadError).not.toHaveBeenCalled();
      expect(raw.body!.locked).toBe(state === "locked");
    } finally {
      reader?.releaseLock();
      await raw.body!.cancel();
    }
  }
});

test("readBody releases failed readers and calls onReadError once with the original error", async () => {
  const failure = new TypeError("read failed after a chunk");
  const mapped = new Error("mapped read failure");
  for (const mapError of [false, true]) {
    let pulls = 0;
    const raw = new Request("http://x", {
      method: "POST",
      body: new ReadableStream<Uint8Array>({
        pull(controller) {
          if (pulls++ === 0) controller.enqueue(new Uint8Array([1]));
          else controller.error(failure);
        },
      }),
    });
    const onReadError = mock((error: unknown) => {
      expect(raw.body!.locked).toBe(true);
      expect(error).toBe(failure);
      if (mapError) throw mapped;
    });
    await expect(readBody(raw, 3, onReadError)).rejects.toBe(mapError ? mapped : failure);
    expect(onReadError).toHaveBeenCalledTimes(1);
    expect(raw.body!.locked).toBe(false);
  }
});

test.each(["throws", "rejects", "pending"] as const)(
  "readBody promptly rejects with 413 when the source cancel %s",
  async (mode) => {
    const cancellation = Promise.withResolvers<void>();
    const cancelFailure = new Error("cancel failed");
    const cancel = mock(() => {
      if (mode === "throws") throw cancelFailure;
      if (mode === "rejects") return Promise.reject(cancelFailure);
      return cancellation.promise;
    });
    const raw = new Request("http://x", {
      method: "POST",
      body: new ReadableStream<Uint8Array>({
        pull(controller) {
          controller.enqueue(new Uint8Array(4));
        },
        cancel,
      }),
    });
    const onReadError = mock(() => {});
    const result = readBody(raw, 3, onReadError).then(
      (value) => ({ value }),
      (error: unknown) => ({ error }),
    );
    let timer: ReturnType<typeof setTimeout> | undefined;
    const deadline = new Promise<"pending">((resolve) => {
      timer = setTimeout(() => resolve("pending"), 250);
    });
    try {
      const settled = await Promise.race([result, deadline]);
      expect(settled).toMatchObject({
        error: { status: 413, code: "payload_too_large", detail: { limit: 3 } },
      });
      expect(cancel).toHaveBeenCalledTimes(1);
      expect(onReadError).toHaveBeenCalledTimes(1);
      if (settled !== "pending" && "error" in settled) {
        expect(onReadError).toHaveBeenCalledWith(settled.error);
      }
      expect(raw.body!.locked).toBe(false);
    } finally {
      clearTimeout(timer);
      cancellation.resolve();
      await result;
    }
  },
);

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
