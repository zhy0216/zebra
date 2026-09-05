import { expect, spyOn, test } from "bun:test";
import { type BodyOptions, parseBody, readBody } from "../../src/http/body.ts";
import { HttpError } from "../../src/http/errors.ts";
import { buildRequest } from "../../src/http/request.ts";

const opts: BodyOptions = {
  maxSize: 1024,
  json: { limit: 1024 },
  form: { limit: 1024 },
  multipart: { limit: 1024, maxFiles: 4, maxFileSize: 512 },
};

test.each([
  "1.5",
  "1.",
  ".1",
  "0x10",
  "0b10",
  "0o10",
  "1e1",
  "1E1",
  "+1",
  "",
  "-1",
  "-0",
  " ",
  "\t",
  "1 0",
  "1\t0",
  "1\u00a0",
  "1a",
  "NaN",
  "Infinity",
  "1, 1",
])("rejects non-decimal Content-Length %j with 400", async (value) => {
  const raw = new Request("http://x/", {
    method: "POST",
    headers: { "content-length": value },
    body: "a",
  });
  await expect(parseBody(raw, opts)).rejects.toMatchObject({
    status: 400,
    code: "invalid_content_length",
  });
  expect(raw.bodyUsed).toBe(false);
});

test("validates the entire declaration before reporting a size error", async () => {
  const raw = new Request("http://x/", {
    method: "POST",
    headers: { "content-length": `${"9".repeat(20_000)}x` },
  });
  await expect(readBody(raw, 1)).rejects.toMatchObject({
    status: 400,
    code: "invalid_content_length",
  });
});

test("accepts decimal zero, small values and arbitrarily many leading zeros", async () => {
  for (const [value, body, limit] of [
    ["0", undefined, 0],
    ["00", "", 0],
    ["1", "a", 1],
    ["0003", "abc", 3],
    ["0010", "abcdefghij", 10],
    ["0001", "a", 1.5],
    ["0".repeat(20_000), "", 0],
    [`${"0".repeat(20_000)}3`, "abc", 3],
  ] as const) {
    const raw = new Request("http://x/", {
      method: "POST",
      headers: { "content-length": value },
      ...(body === undefined ? {} : { body }),
    });
    expect(await readBody(raw, limit)).toEqual(new TextEncoder().encode(body ?? ""));
  }
});

test("rejects oversized decimal declarations before acquiring a reader, without rounding", async () => {
  for (const [value, limit] of [
    ["2", 1.5],
    ["0001025", 1024],
    ["9007199254740992", Number.MAX_SAFE_INTEGER],
    ["9007199254740993", 2 ** 53],
    ["100000000000000000001", 1e20],
    [(BigInt(Number.MAX_VALUE) + 1n).toString(), Number.MAX_VALUE],
    ["9".repeat(20_000), Number.MAX_VALUE],
    [`${"0".repeat(20_000)}${"9".repeat(20_000)}`, 1024],
  ] as const) {
    const raw = new Request("http://x/", {
      method: "POST",
      headers: { "content-length": value },
      body: "a",
    });
    const getReader = spyOn(raw.body!, "getReader");
    try {
      await expect(readBody(raw, limit)).rejects.toMatchObject({
        status: 413,
        code: "payload_too_large",
        detail: { limit },
      });
      expect(getReader).not.toHaveBeenCalled();
      expect(raw.bodyUsed).toBe(false);
      expect(raw.body!.locked).toBe(false);
    } finally {
      getReader.mockRestore();
    }
  }
});

test("large in-limit declarations buffer only actual bytes", async () => {
  for (const limit of [Number.MAX_SAFE_INTEGER, 2 ** 53, 1e20, Number.MAX_VALUE]) {
    const raw = new Request("http://x/", {
      method: "POST",
      headers: { "content-length": BigInt(limit).toString() },
      body: "abc",
    });
    expect(await readBody(raw, limit)).toEqual(new Uint8Array([97, 98, 99]));
  }
});

test.each([null, "0", "1", "0001"])(
  "counts actual streamed bytes with missing or understated Content-Length %j",
  async (value) => {
    for (const limit of [4, 6]) {
      const raw = new Request("http://x/", {
        method: "POST",
        headers: value === null ? {} : { "content-length": value },
        body: new ReadableStream<Uint8Array>({
          start(controller) {
            controller.enqueue(new TextEncoder().encode("你"));
            controller.enqueue(new TextEncoder().encode("好"));
            controller.close();
          },
        }),
      });
      expect(raw.headers.get("content-length")).toBe(value);
      if (limit === 4) {
        await expect(readBody(raw, limit)).rejects.toMatchObject({
          status: 413,
          code: "payload_too_large",
          detail: { limit },
        });
      } else {
        expect(await readBody(raw, limit)).toEqual(new TextEncoder().encode("你好"));
      }
    }
  },
);

test.each([
  "application/json",
  "application/x-www-form-urlencoded",
  "multipart/form-data; boundary=X",
  "application/octet-stream",
])("buffering helpers share declaration errors for %s", async (contentType) => {
  for (const [value, status, code] of [
    ["1.5", 400, "invalid_content_length"],
    ["", 400, "invalid_content_length"],
    ["1025", 413, "payload_too_large"],
  ] as const) {
    const raw = new Request("http://x/", {
      method: "POST",
      headers: { "content-type": contentType, "content-length": value },
      body: "invalid payload",
    });
    const getReader = spyOn(raw.body!, "getReader");
    const z = buildRequest(raw, {}, opts);
    try {
      const results = await Promise.allSettled([z.json(), z.text(), z.body(), z.form()]);
      const first = results[0]!;
      expect(first.status).toBe("rejected");
      if (first.status !== "rejected") continue;
      expect(first.reason).toBeInstanceOf(HttpError);
      expect(first.reason).toMatchObject({ status, code });
      for (const result of results) {
        expect(result).toEqual({ status: "rejected", reason: first.reason });
        if (result.status === "rejected") expect(result.reason).toBe(first.reason);
      }
      for (const helper of ["json", "text", "body", "form"] as const) {
        await expect(z[helper]()).rejects.toBe(first.reason);
      }
      expect(getReader).not.toHaveBeenCalled();
      expect(raw.bodyUsed).toBe(false);
    } finally {
      getReader.mockRestore();
    }
  }
});

test("legal declared lengths preserve JSON, urlencoded and multipart helper composition", async () => {
  const multipart =
    '--X\r\nContent-Disposition: form-data; name="a"\r\n\r\n1\r\n--X\r\nContent-Disposition: form-data; name="file"; filename="a.txt"\r\nContent-Type: text/plain\r\n\r\ndata\r\n--X--\r\n';
  for (const [contentType, payload] of [
    ["application/json", '{"a":"你好"}'],
    ["application/x-www-form-urlencoded", "a=1&a=2"],
    ["multipart/form-data; boundary=X", multipart],
  ] as const) {
    const raw = new Request("http://x/", {
      method: "POST",
      headers: {
        "content-type": contentType,
        "content-length": `000${new TextEncoder().encode(payload).byteLength}`,
      },
      body: payload,
    });
    const getReader = spyOn(raw.body!, "getReader");
    const z = buildRequest(raw, {}, opts);
    try {
      const [body, form, text] = await Promise.all([z.body(), z.form(), z.text()]);
      expect(text).toBe(payload);
      if (contentType === "application/json") {
        expect(body).toEqual({ a: "你好" });
        expect(await z.json()).toEqual(body);
        expect([...form.entries()]).toEqual([]);
      } else if (contentType === "application/x-www-form-urlencoded") {
        expect(body).toEqual({ a: "2" });
        expect(form.getAll("a")).toEqual(["1", "2"]);
      } else {
        expect(body).toBeInstanceOf(FormData);
        for (const parsed of [body as FormData, form]) {
          expect(parsed.get("a")).toBe("1");
          const file = parsed.get("file") as File;
          expect(file.name).toBe("a.txt");
          expect(await file.text()).toBe("data");
        }
      }
      expect(getReader).toHaveBeenCalledTimes(1);
    } finally {
      getReader.mockRestore();
    }
  }
});
