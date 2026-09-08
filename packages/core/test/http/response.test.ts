import { expect, test } from "bun:test";
import { stream, html, json, redirect, text } from "../../src/http/response.ts";

test("json(undefined) maps to an empty 204 (no invalid JSON body)", async () => {
  const res = json(undefined);
  expect(res.status).toBe(204);
  expect(res.body).toBeNull();
  expect(res.headers.has("content-type")).toBe(false);
});

test("json sets content-type and status defaults", async () => {
  const res = json({ a: 1 });
  expect(res.status).toBe(200);
  expect(res.headers.get("content-type")).toBe("application/json; charset=utf-8");
  expect(await res.json()).toEqual({ a: 1 });
});

test("json honors custom status and content-type override", async () => {
  const res = json(
    { error: "x" },
    { status: 422, headers: { "content-type": "application/problem+json", "x-custom": "1" } },
  );
  expect(res.status).toBe(422);
  expect(res.headers.get("content-type")).toBe("application/problem+json");
  expect(res.headers.get("x-custom")).toBe("1");
  expect(await res.json()).toEqual({ error: "x" });
});

test("json serializes null and strings", async () => {
  expect(await json(null).text()).toBe("null");
  expect(await json("hi").text()).toBe('"hi"');
});

// The pre-native constructor is the oracle, including Bun's empty-body and
// body-forbidden-status behavior. Checking text alone misses a null body change.
function legacyJson(value: unknown, init: ResponseInit = {}): Response {
  if (value === undefined) return new Response(null, { ...init, status: init.status ?? 204 });
  return new Response(JSON.stringify(value), {
    ...init,
    headers: (() => {
      const headers = new Headers(init.headers as Bun.HeadersInit | undefined);
      if (!headers.has("content-type"))
        headers.set("content-type", "application/json; charset=utf-8");
      return headers;
    })(),
  });
}

const jsonValues: [string, unknown][] = [
  ["string", "hello"],
  ["null", null],
  ["boolean", false],
  ["number", 42.5],
  ["negative zero", -0],
  ["non-finite number", Number.NaN],
  ["nested", { a: [1, null, { b: true }], omitted: undefined }],
  ["array", [undefined, Symbol("item"), () => 1, "last"]],
  ["Unicode", "你好 🦓 café e\u0301 \ud800 \u0000"],
  ["undefined", undefined],
  ["function", () => 1],
  ["Symbol", Symbol("root")],
  ["function with toJSON", Object.assign(() => 1, { toJSON: () => ({ ok: true }) })],
  ["object with toJSON", { toJSON: () => ["custom", 1] }],
  ["toJSON returns undefined", { toJSON: () => undefined }],
  ["toJSON returns Symbol", { toJSON: () => Symbol("empty") }],
  ["toJSON returns function", { toJSON: () => () => 1 }],
];

test.each(jsonValues)("json preserves the old constructor for %s", async (_name, value) => {
  const expected = legacyJson(value);
  const actual = json(value);
  expect(actual.status).toBe(expected.status);
  expect([...actual.headers]).toEqual([...expected.headers]);
  expect(actual.body === null).toBe(expected.body === null);
  expect(await actual.text()).toBe(await expected.text());
});

test.each([204, 205, 304])("json preserves Bun's body boundary for status %d", async (status) => {
  for (const [, value] of jsonValues) {
    const init = { status, statusText: "Custom" };
    const expected = legacyJson(value, init);
    const actual = json(value, init);
    expect(actual.status).toBe(expected.status);
    expect(actual.statusText).toBe(expected.statusText);
    expect(actual.body === null).toBe(expected.body === null);
    expect([...actual.headers]).toEqual([...expected.headers]);
    expect(await actual.text()).toBe(await expected.text());
  }
});

test.each(["record", "tuples", "Headers"])(
  "json preserves %s headers, custom metadata and separate cookies without mutation",
  async (form) => {
    const cookies = ["a=1; Expires=Wed, 09 Jun 2038 10:18:14 GMT", "b=2; Path=/"];
    const entries: [string, string][] = [
      ["Content-Type", "application/vnd.example+json"],
      ["X-Custom", "kept"],
      ["Set-Cookie", cookies[0]!],
      ["Set-Cookie", cookies[1]!],
    ];
    const headers =
      form === "Headers"
        ? new Headers(entries)
        : form === "tuples"
          ? entries
          : { "Content-Type": entries[0]![1], "X-Custom": "kept", "Set-Cookie": cookies[0]! };
    const before = new Headers(headers);
    const init = { status: 202, statusText: "Queued", headers };
    for (const value of [{ ok: true }, undefined]) {
      const expected = legacyJson(value, init);
      const actual = json(value, init);
      expect(actual.status).toBe(202);
      expect(actual.statusText).toBe("Queued");
      expect([...actual.headers]).toEqual([...expected.headers]);
      expect(actual.headers.getSetCookie()).toEqual(
        form === "record" ? cookies.slice(0, 1) : cookies,
      );
      expect(actual.body === null).toBe(expected.body === null);
      expect(await actual.text()).toBe(await expected.text());
      actual.headers.set("x-custom", "response only");
      expect([...new Headers(headers)]).toEqual([...before]);
    }
  },
);

test("json serializes once before reading caller headers", async () => {
  const run = async (construct: typeof json) => {
    const calls: string[] = [];
    const headers = new Headers({ "x-stage": "before" });
    const value = {
      get toJSON() {
        calls.push("get toJSON");
        return (key: string) => {
          calls.push(`toJSON:${key}`);
          headers.set("x-stage", "serialized");
          return {
            get value() {
              calls.push("get value");
              return "🦓";
            },
          };
        };
      },
    };
    const res = construct(value, { headers });
    return { calls, header: res.headers.get("x-stage"), body: await res.text() };
  };
  const expected = await run(legacyJson);
  expect(expected.calls).toEqual(["get toJSON", "toJSON:", "get value"]);
  expect(expected.header).toBe("serialized");
  expect(await run(json)).toEqual(expected);
});

test("json propagates serialization failures without retries", () => {
  const circular: Record<string, unknown> = {};
  circular.self = circular;
  for (const value of [1n, circular]) expect(() => json(value)).toThrow(TypeError);
  for (const property of ["toJSON", "value"]) {
    const failure = new Error(property);
    let calls = 0;
    const value = Object.defineProperty({}, property, {
      enumerable: true,
      get() {
        calls++;
        throw failure;
      },
    });
    expect(() => json(value)).toThrow(failure);
    expect(calls).toBe(1);
  }
});

test("text sets text/plain with utf-8", async () => {
  const res = text("hello");
  expect(res.headers.get("content-type")).toBe("text/plain; charset=utf-8");
  expect(await res.text()).toBe("hello");
});

test("text honors init status and extra headers", async () => {
  const res = text("hello", { status: 201, headers: { "x-a": "b" } });
  expect(res.status).toBe(201);
  expect(res.headers.get("x-a")).toBe("b");
  expect(await res.text()).toBe("hello");
});

test("html sets text/html with utf-8", async () => {
  const res = html("<p>hi</p>");
  expect(res.headers.get("content-type")).toBe("text/html; charset=utf-8");
  expect(await res.text()).toBe("<p>hi</p>");
});

test("redirect defaults to 302 with Location from string", () => {
  const res = redirect("/login");
  expect(res.status).toBe(302);
  expect(res.headers.get("location")).toBe("/login");
  expect(res.body).toBeNull();
});

test("redirect accepts URL and custom status", () => {
  const res = redirect(new URL("https://example.com/x"), { status: 301 });
  expect(res.status).toBe(301);
  expect(res.headers.get("location")).toBe("https://example.com/x");
});

test("redirect Location always comes from url, init headers merged", () => {
  const res = redirect("/a", { headers: { "x-cache": "no" } });
  expect(res.headers.get("location")).toBe("/a");
  expect(res.headers.get("x-cache")).toBe("no");
});

test("stream wraps a ReadableStream with octet-stream default", async () => {
  const encoder = new TextEncoder();
  const res = stream(
    new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(encoder.encode("abc"));
        controller.close();
      },
    }),
  );
  expect(res.status).toBe(200);
  expect(res.headers.get("content-type")).toBe("application/octet-stream");
  expect(await res.text()).toBe("abc");
});

test("stream accepts Blob, Uint8Array and ArrayBuffer", async () => {
  expect(await stream(new Blob(["blob"])).text()).toBe("blob");
  expect(await stream(new TextEncoder().encode("bytes")).text()).toBe("bytes");
  const buf = new ArrayBuffer(3);
  new Uint8Array(buf).set([1, 2, 3]);
  expect([...new Uint8Array(await stream(buf).arrayBuffer())]).toEqual([1, 2, 3]);
});

test("stream honors init content-type and status", async () => {
  const res = stream(new Blob(["csv"]), { status: 201, headers: { "content-type": "text/csv" } });
  expect(res.headers.get("content-type")).toBe("text/csv");
  expect(res.status).toBe(201);
  expect(await res.text()).toBe("csv");
});
