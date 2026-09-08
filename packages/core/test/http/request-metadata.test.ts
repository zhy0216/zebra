import { expect, test } from "bun:test";
import { type BodyOptions } from "../../src/http/body.ts";
import { buildRequest } from "../../src/http/request.ts";

const limits: BodyOptions = {
  maxSize: 4096,
  json: { limit: 8 },
  form: { limit: 8 },
  multipart: { limit: 8, maxFiles: 2, maxFileSize: 512 },
};

test("request metadata preserves identity, query replacement and lazy state", () => {
  const raw = new Request("http://x/original");
  const url = new URL("http://x/supplied?a=first&a=last&__proto__=safe&constructor=value");
  const params = { id: "42" };
  let calls = 0;
  const req = buildRequest(raw, params, undefined, undefined, undefined, url, () => {
    calls++;
    return undefined;
  });
  expect(req.raw).toBe(raw);
  expect(req.headers).toBe(raw.headers);
  expect(req.params).toBe(params);
  expect(req.url).toBe(url);
  expect(calls).toBe(0);
  expect(req.ip).toBeUndefined();
  expect(req.ip).toBeUndefined();
  expect(calls).toBe(1);
  expect(req.query).toEqual({ a: "last", ["__proto__"]: "safe", constructor: "value" });
  expect(Object.getPrototypeOf(req.query)).toBeNull();
  expect(req.query.__proto__).toBe("safe");
  const query = { replacement: "assigned" };
  req.query = query;
  expect(req.query).toBe(query);
  const ctx = req.ctx;
  const key = Symbol("state");
  ctx.set(key, 42);
  expect(req.ctx).toBe(ctx);
  expect(req.ctx.get(key)).toBe(42);
  const supplied = buildRequest(raw, {}, undefined, "peer", undefined, undefined, () => {
    throw new Error("supplied IP must bypass resolution");
  });
  expect(supplied.ip).toBe("peer");
  expect(supplied.ip).toBe("peer");
});

test("signal keeps the original Request source after raw replacement and early abort", () => {
  for (const provided of [false, true]) {
    for (const abortBeforeBuild of [false, true]) {
      const controller = new AbortController();
      const reason = new Error("original aborted");
      const raw = new Request("http://x/original", { signal: controller.signal });
      if (abortBeforeBuild) controller.abort(reason);
      const req = buildRequest(
        raw,
        {},
        undefined,
        undefined,
        provided ? controller.signal : undefined,
      );
      req.raw = new Request("http://x/replacement");
      if (!abortBeforeBuild) controller.abort(reason);
      expect(req.signal).toBe(provided ? controller.signal : raw.signal);
      expect(req.signal.aborted).toBe(true);
      expect(req.signal.reason).toBe(reason);
      expect(req.raw.signal.aborted).toBe(false);
    }
  }
});

test("default and supplied signals deliver abort and allow assignment before first read", () => {
  for (const provided of [false, true]) {
    const controller = new AbortController();
    const raw = new Request("http://x/", { signal: controller.signal });
    const req = buildRequest(
      raw,
      {},
      undefined,
      undefined,
      provided ? controller.signal : undefined,
    );
    expect(req.signal).toBe(provided ? controller.signal : raw.signal);
    let aborted = 0;
    req.signal.addEventListener("abort", () => aborted++);
    controller.abort("delivered");
    expect(aborted).toBe(1);
    expect(req.signal.reason).toBe("delivered");

    const unread = buildRequest(
      raw,
      {},
      undefined,
      undefined,
      provided ? controller.signal : undefined,
    );
    const replacement = new AbortController();
    unread.signal = replacement.signal;
    expect(unread.signal).toBe(replacement.signal);
    expect(unread.signal.aborted).toBe(false);
    replacement.abort("replacement");
    expect(unread.signal.reason).toBe("replacement");
  }
});

test("public data fields remain writable and included in object spread", () => {
  const req = buildRequest(new Request("http://x/"), { id: "original" });
  const raw = new Request("http://x/replaced");
  const headers = new Headers({ "x-replaced": "yes" });
  const url = new URL("http://x/replaced");
  const params = { id: "replaced" };
  const signal = new AbortController().signal;
  req.raw = raw;
  req.headers = headers;
  req.url = url;
  req.params = params;
  req.signal = signal;
  const spread = { ...req };
  expect(spread.raw).toBe(raw);
  expect(spread.headers).toBe(headers);
  expect(spread.url).toBe(url);
  expect(spread.params).toBe(params);
  expect(spread.signal).toBe(signal);
});

test("captured JSON parser survives mutation and replacement of public headers", async () => {
  for (const mutate of ["raw", "headers", "replace"] as const) {
    const raw = new Request("http://x/", {
      method: "POST",
      headers: { "content-type": "Application/JSON" },
      body: '{"a":1}',
    });
    const req = buildRequest(raw, {});
    expect(req.headers).toBe(raw.headers);
    if (mutate === "replace") req.headers = new Headers({ "content-type": "text/plain" });
    else (mutate === "raw" ? raw.headers : req.headers).set("content-type", "text/plain");
    expect(await req.body()).toEqual({ a: 1 });
    expect(await req.json()).toEqual({ a: 1 });
    expect(await req.text()).toBe('{"a":1}');
    expect([...(await req.form()).entries()]).toEqual([]);
  }
});

test("every body entry point uses captured content type limits after header mutation", async () => {
  for (const contentType of [
    "Application/JSON",
    "Application/X-WWW-Form-Urlencoded",
    "Multipart/Form-Data; boundary=MixedBoundary",
  ]) {
    for (const helper of ["body", "json", "text", "form", "stream"] as const) {
      const raw = new Request("http://x/", {
        method: "POST",
        headers: { "content-type": contentType },
        body: "x".repeat(32),
      });
      const req = buildRequest(raw, {}, limits);
      req.headers.set("content-type", "text/plain");
      const result = helper === "stream" ? new Response(req.stream()).text() : req[helper]();
      await expect(result).rejects.toMatchObject({ status: 413, code: "payload_too_large" });
    }
  }
});

test("adding JSON content type later does not change an untyped body's parser or limit", async () => {
  const bytes = new TextEncoder().encode('{"long":"payload"}');
  const raw = new Request("http://x/", { method: "POST", body: bytes });
  const req = buildRequest(raw, {}, limits);
  raw.headers.set("content-type", "application/json");
  expect(await req.body()).toEqual(bytes);
  expect(await req.json()).toEqual({ long: "payload" });
});

test("multipart boundary snapshot survives header mutation before mixed helper reads", async () => {
  const boundary = "MixedCaseBoundary";
  const payload = `--${boundary}\r\nContent-Disposition: form-data; name="file"; filename="f.txt"\r\nContent-Type: text/plain\r\n\r\ndata\r\n--${boundary}--\r\n`;
  const raw = new Request("http://x/", {
    method: "POST",
    headers: { "content-type": `multipart/form-data; boundary=${boundary}` },
    body: payload,
  });
  const req = buildRequest<{}, FormData>(raw, {});
  req.headers.set("content-type", "multipart/form-data; boundary=wrong");
  expect(await req.text()).toBe(payload);
  for (const parsed of await Promise.all([req.body(), req.form()])) {
    const file = parsed.get("file") as File;
    expect(file.name).toBe("f.txt");
    expect(await file.text()).toBe("data");
  }
});

test("multipart read failure mapping uses the snapshot after content type mutation", async () => {
  const failure = new TypeError("stream read failed");
  const raw = new Request("http://x/", {
    method: "POST",
    headers: { "content-type": "Multipart/Form-Data; boundary=MixedBoundary" },
    body: new ReadableStream<Uint8Array>({
      pull(controller) {
        controller.error(failure);
      },
    }),
  });
  const req = buildRequest(raw, {});
  raw.headers.set("content-type", "text/plain");
  const [body, text, json, form] = await Promise.allSettled([
    req.body(),
    req.text(),
    req.json(),
    req.form(),
  ]);
  expect(body).toMatchObject({
    status: "rejected",
    reason: { status: 400, code: "invalid_multipart" },
  });
  for (const result of [text, json, form]) {
    expect(result).toEqual({ status: "rejected", reason: failure });
  }
});
