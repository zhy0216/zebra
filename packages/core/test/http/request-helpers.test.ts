import { expect, spyOn, test } from "bun:test";
import { type BodyOptions } from "../../src/http/body.ts";
import { buildRequest } from "../../src/http/request.ts";

const opts: BodyOptions = {
  maxSize: 4096,
  json: { limit: 4096 },
  form: { limit: 4096 },
  multipart: { limit: 4096, maxFiles: 4, maxFileSize: 512 },
};

test("req.json parses the body as JSON regardless of content-type", async () => {
  const raw = new Request("http://x/", {
    method: "POST",
    headers: { "content-type": "text/plain" },
    body: '{"a":1}',
  });
  expect(await buildRequest(raw, {}).json()).toEqual({ a: 1 });
});

test("req.json is memoized: two calls share one parse", () => {
  const raw = new Request("http://x/", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: '{"a":1}',
  });
  const z = buildRequest(raw, {});
  expect(z.json()).toBe(z.json());
});

test("req.json on invalid JSON throws 400 invalid_json", async () => {
  const raw = new Request("http://x/", { method: "POST", body: "{not json" });
  await expect(buildRequest(raw, {}).json()).rejects.toMatchObject({
    status: 400,
    code: "invalid_json",
  });
});

test("req.json on empty body returns null", async () => {
  const z = buildRequest(new Request("http://x/", { method: "POST" }), {});
  expect(await z.json()).toBeNull();
});

test("req.text returns the raw body text", async () => {
  const raw = new Request("http://x/", { method: "POST", body: "hello" });
  expect(await buildRequest(raw, {}).text()).toBe("hello");
});

test("req.text is memoized; empty body is an empty string", async () => {
  const raw = new Request("http://x/", { method: "POST", body: "abc" });
  const z = buildRequest(raw, {});
  expect(z.text()).toBe(z.text());
  expect(await buildRequest(new Request("http://x/"), {}).text()).toBe("");
});

test("helpers are lazy: nothing reads the body until invoked", () => {
  const raw = new Request("http://x/", { method: "POST", body: "abc" });
  const z = buildRequest(raw, {});
  expect(raw.body?.locked).toBe(false);
  void z.text();
  expect(raw.body?.locked).toBe(true);
});

test("json() and text() share one buffered read", async () => {
  const raw = new Request("http://x/", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: '{"a":1}',
  });
  const z = buildRequest(raw, {});
  expect(await z.json()).toEqual({ a: 1 });
  expect(await z.text()).toBe('{"a":1}');
});

test("text then body and body then json preserve the JSON payload", async () => {
  for (const first of ["text", "body"] as const) {
    const raw = new Request("http://x/", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: '{"a":1}',
    });
    const z = buildRequest(raw, {});
    await z[first]();
    expect(await z.body()).toEqual({ a: 1 });
    expect(await z.json()).toEqual({ a: 1 });
    expect(await z.text()).toBe('{"a":1}');
  }
});

test("concurrent body/json/text/form calls acquire the raw reader once", async () => {
  const raw = new Request("http://x/", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: '{"a":1}',
  });
  const getReader = spyOn(raw.body!, "getReader");
  const z = buildRequest(raw, {});
  try {
    const [body, json, text, form] = await Promise.all([z.body(), z.json(), z.text(), z.form()]);
    expect(body).toEqual({ a: 1 });
    expect(json).toEqual({ a: 1 });
    expect(text).toBe('{"a":1}');
    expect([...form.entries()]).toEqual([]);
    expect(getReader).toHaveBeenCalledTimes(1);
    expect(z.body()).toBe(z.body());
  } finally {
    getReader.mockRestore();
  }
});

test("body/text/form compose for urlencoded bodies without losing repeated fields", async () => {
  for (const first of ["body", "form", "text"] as const) {
    const raw = new Request("http://x/", {
      method: "POST",
      headers: { "content-type": "application/x-www-form-urlencoded" },
      body: "a=1&a=2&b=hi+there",
    });
    const getReader = spyOn(raw.body!, "getReader");
    const z = buildRequest(raw, {});
    try {
      await z[first]();
      expect(await z.body()).toEqual({ a: "2", b: "hi there" });
      expect((await z.form()).getAll("a")).toEqual(["1", "2"]);
      expect(await z.text()).toBe("a=1&a=2&b=hi+there");
      expect(getReader).toHaveBeenCalledTimes(1);
    } finally {
      getReader.mockRestore();
    }
  }
});

test("body/text/form compose for multipart while preserving boundary case and files", async () => {
  for (const first of ["body", "form", "text"] as const) {
    const boundary = "MixedCaseBoundary";
    const payload = `--${boundary}\r\nContent-Disposition: form-data; name="a"\r\n\r\n1\r\n--${boundary}\r\nContent-Disposition: form-data; name="file"; filename="f.txt"\r\nContent-Type: text/plain\r\n\r\ndata\r\n--${boundary}--\r\n`;
    const raw = new Request("http://x/", {
      method: "POST",
      headers: { "content-type": `multipart/form-data; boundary=${boundary}` },
      body: payload,
    });
    const getReader = spyOn(raw.body!, "getReader");
    const z = buildRequest<{}, FormData>(raw, {}, opts);
    try {
      await z[first]();
      const [body, form, text] = await Promise.all([z.body(), z.form(), z.text()]);
      for (const parsed of [body, form]) {
        expect(parsed.get("a")).toBe("1");
        const file = parsed.get("file") as File;
        expect(file.name).toBe("f.txt");
        expect(await file.text()).toBe("data");
      }
      expect(text).toBe(payload);
      expect(getReader).toHaveBeenCalledTimes(1);
    } finally {
      getReader.mockRestore();
    }
  }
});

test("a JSON parse failure preserves buffered text and is memoized", async () => {
  const raw = new Request("http://x/", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: "{invalid",
  });
  const z = buildRequest(raw, {});
  for (const result of await Promise.allSettled([z.body(), z.json()])) {
    expect(result).toMatchObject({
      status: "rejected",
      reason: { status: 400, code: "invalid_json" },
    });
  }
  expect(await z.text()).toBe("{invalid");
  expect(z.body()).toBe(z.body());
});

test("a shared size-limit failure rejects every buffering helper and cancels once", async () => {
  let cancelled = 0;
  const raw = new Request("http://x/", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: new ReadableStream<Uint8Array>({
      pull(controller) {
        controller.enqueue(new Uint8Array(32));
      },
      cancel() {
        cancelled++;
      },
    }),
  });
  const z = buildRequest(raw, {}, { ...opts, json: { limit: 16 } });
  const results = await Promise.allSettled([z.body(), z.json(), z.text(), z.form()]);
  for (const result of results) {
    expect(result).toMatchObject({
      status: "rejected",
      reason: { status: 413, code: "payload_too_large" },
    });
  }
  await expect(z.body()).rejects.toMatchObject({ status: 413 });
  expect(cancelled).toBe(1);
});

test("req.form parses multipart with File entries", async () => {
  const form = new FormData();
  form.append("a", "1");
  form.append("file", new File(["data"], "f.txt"));
  const raw = new Request("http://x/", { method: "POST", body: form });
  const parsed = await buildRequest(raw, {}).form();
  expect(parsed).toBeInstanceOf(FormData);
  expect(parsed.get("a")).toBe("1");
  const file = parsed.get("file");
  expect(file).toBeInstanceOf(File);
  expect((file as File).name).toBe("f.txt");
});

test("req.form parses urlencoded into string entries", async () => {
  const raw = new Request("http://x/", {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body: "a=1&b=hi",
  });
  const parsed = await buildRequest(raw, {}).form();
  expect(parsed.get("a")).toBe("1");
  expect(parsed.get("b")).toBe("hi");
});

test("req.form on non-form body returns an empty FormData", async () => {
  const raw = new Request("http://x/", { method: "POST", body: "plain" });
  const parsed = await buildRequest(raw, {}).form();
  expect([...parsed.entries()]).toEqual([]);
});

test("req.form is memoized", () => {
  const raw = new Request("http://x/", {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body: "a=1",
  });
  const z = buildRequest(raw, {});
  expect(z.form()).toBe(z.form());
});

test("req.form enforces multipart maxFiles", async () => {
  const form = new FormData();
  form.append("a", new File(["1"], "a.txt"));
  form.append("b", new File(["2"], "b.txt"));
  form.append("c", new File(["3"], "c.txt"));
  const raw = new Request("http://x/", { method: "POST", body: form });
  const z = buildRequest(
    raw,
    {},
    { ...opts, multipart: { limit: 4096, maxFiles: 2, maxFileSize: 512 } },
  );
  await expect(z.form()).rejects.toMatchObject({ status: 413, code: "too_many_files" });
});

test("req.form enforces multipart maxFileSize", async () => {
  const form = new FormData();
  form.append("f", new File(["x".repeat(1024)], "big.txt"));
  const raw = new Request("http://x/", { method: "POST", body: form });
  const z = buildRequest(raw, {}, opts);
  await expect(z.form()).rejects.toMatchObject({ status: 413, code: "file_too_large" });
});

test("reading multipart text first cannot bypass file count or file size limits", async () => {
  for (const [limits, code] of [
    [{ maxFiles: 1, maxFileSize: 512 }, "too_many_files"],
    [{ maxFiles: 4, maxFileSize: 1 }, "file_too_large"],
  ] as const) {
    const form = new FormData();
    form.append("a", new File(["aa"], "a.txt"));
    form.append("b", new File(["bb"], "b.txt"));
    const raw = new Request("http://x/", { method: "POST", body: form });
    const z = buildRequest(raw, {}, { ...opts, multipart: { limit: 4096, ...limits } });
    expect(await z.text()).toContain('filename="a.txt"');
    for (const result of await Promise.allSettled([z.body(), z.form()])) {
      expect(result).toMatchObject({ status: "rejected", reason: { status: 413, code } });
    }
  }
});

test("helpers enforce body limits", async () => {
  const raw = new Request("http://x/", {
    method: "POST",
    headers: { "content-type": "text/plain" },
    body: "x".repeat(8192),
  });
  const z = buildRequest(raw, {}, { ...opts, maxSize: 1024 });
  await expect(z.text()).rejects.toMatchObject({ status: 413, code: "payload_too_large" });
});

test("req.json respects the json.limit for json content-type", async () => {
  const raw = new Request("http://x/", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ s: "x".repeat(8192) }),
  });
  const z = buildRequest(raw, {}, { ...opts, json: { limit: 1024 } });
  await expect(z.json()).rejects.toMatchObject({ status: 413, code: "payload_too_large" });
});

test("req.stream pipes the raw body without buffering", async () => {
  const raw = new Request("http://x/", { method: "POST", body: new Uint8Array([1, 2, 3]) });
  const z = buildRequest(raw, {});
  const chunks: number[] = [];
  for await (const chunk of z.stream()) chunks.push(...chunk);
  expect(chunks).toEqual([1, 2, 3]);
});

test("req.stream enforces the limit while piping", async () => {
  const raw = new Request("http://x/", { method: "POST", body: new Uint8Array(8192) });
  const z = buildRequest(raw, {}, { ...opts, maxSize: 1024 });
  const reader = z.stream().getReader();
  await expect(reader.read()).rejects.toMatchObject({ status: 413, code: "payload_too_large" });
});

test("req.stream on a bodyless request yields an empty stream", async () => {
  const z = buildRequest(new Request("http://x/"), {});
  let total = 0;
  for await (const chunk of z.stream()) total += chunk.byteLength;
  expect(total).toBe(0);
});

test("stream rejects buffering and repeated streaming both before and after consumption", async () => {
  const z = buildRequest(new Request("http://x/", { method: "POST", body: "abc" }), {});
  const stream = z.stream();
  await expect(z.body()).rejects.toBeInstanceOf(TypeError);
  expect(() => z.stream()).toThrow(TypeError);
  expect(await new Response(stream).text()).toBe("abc");
  for (const result of await Promise.allSettled([z.body(), z.json(), z.text(), z.form()])) {
    expect(result.status).toBe("rejected");
    if (result.status === "rejected") expect(result.reason).toBeInstanceOf(TypeError);
  }
  expect(() => z.stream()).toThrow(TypeError);
});

test("stream rejects after buffering starts or completes", async () => {
  const z = buildRequest(new Request("http://x/", { method: "POST", body: "abc" }), {});
  const buffered = z.text();
  expect(() => z.stream()).toThrow(TypeError);
  expect(await buffered).toBe("abc");
  expect(() => z.stream()).toThrow(TypeError);
});

test("buffering an externally consumed raw request rejects instead of returning an empty body", async () => {
  const raw = new Request("http://x/", { method: "POST", body: "abc" });
  const z = buildRequest(raw, {});
  expect(await raw.text()).toBe("abc");
  await expect(z.body()).rejects.toBeInstanceOf(TypeError);
  await expect(z.text()).rejects.toBeInstanceOf(TypeError);
  expect(() => z.stream()).toThrow(TypeError);
});
