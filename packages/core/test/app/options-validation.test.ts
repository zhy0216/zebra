import "reflect-metadata";
import { expect, mock, spyOn, test } from "bun:test";
import { Zebra } from "../../src/app/app.ts";
import type { ZebraOptions } from "../../src/app/types.ts";

const multipartDefaults = { limit: 16 * 1024 * 1024, maxFiles: 10, maxFileSize: 8 * 1024 * 1024 };
const timeOptions: [string, (value: number) => ZebraOptions][] = [
  ["sessionTtl", (value) => ({ sessionTtl: value })],
  ["session.ttl", (value) => ({ session: { ttl: value } })],
  ["gracePeriod", (value) => ({ gracePeriod: value })],
  ["requestTimeout", (value) => ({ requestTimeout: value })],
];
const byteLimits: [string, (value: number) => ZebraOptions, string][] = [
  ["body.maxSize", (value) => ({ body: { maxSize: value } }), "text/plain"],
  ["body.json.limit", (value) => ({ body: { json: { limit: value } } }), "application/json"],
  [
    "body.form.limit",
    (value) => ({ body: { form: { limit: value } } }),
    "application/x-www-form-urlencoded",
  ],
  [
    "body.multipart.limit",
    (value) => ({ body: { multipart: { ...multipartDefaults, limit: value } } }),
    "multipart/form-data; boundary=X",
  ],
];
const bodyOptions: [string, (value: number) => ZebraOptions][] = [
  ...byteLimits.map(([name, options]): [string, (value: number) => ZebraOptions] => [
    name,
    options,
  ]),
  [
    "body.multipart.maxFiles",
    (value) => ({ body: { multipart: { ...multipartDefaults, maxFiles: value } } }),
  ],
  [
    "body.multipart.maxFileSize",
    (value) => ({ body: { multipart: { ...multipartDefaults, maxFileSize: value } } }),
  ],
];
const nonFinite = [Number.NaN, Number.POSITIVE_INFINITY, Number.NEGATIVE_INFINITY];

for (const [name, options] of [...timeOptions, ...bodyOptions]) {
  for (const value of nonFinite) {
    test(`constructor rejects ${name}=${value} with a diagnostic RangeError`, () => {
      let failure: unknown;
      try {
        new Zebra(options(value));
      } catch (error) {
        failure = error;
      }
      expect(failure).toBeInstanceOf(RangeError);
      expect((failure as Error).message).toContain(name);
    });
  }
}

test("invalid options fail before creating servers, timers or invoking application callbacks", () => {
  const unexpectedResource = () => {
    throw new Error("Invalid options started a resource");
  };
  const unexpectedTimeout = Object.assign(unexpectedResource, {
    __promisify__: setTimeout.__promisify__,
  });
  const serve = spyOn(Bun, "serve").mockImplementation(unexpectedResource);
  const timeout = spyOn(globalThis, "setTimeout").mockImplementation(unexpectedTimeout);
  const interval = spyOn(globalThis, "setInterval").mockImplementation(unexpectedResource);
  const resolver = mock(() => "session");
  const handler = mock(() => "ok");
  try {
    for (const [, options] of [...timeOptions, ...bodyOptions]) {
      for (const value of nonFinite) {
        expect(() => {
          const app = new Zebra({ ...options(value), sessionResolver: resolver });
          app.get("/", handler);
        }).toThrow(RangeError);
      }
    }
    expect(serve).not.toHaveBeenCalled();
    expect(timeout).not.toHaveBeenCalled();
    expect(interval).not.toHaveBeenCalled();
    expect(resolver).not.toHaveBeenCalled();
    expect(handler).not.toHaveBeenCalled();
  } finally {
    serve.mockRestore();
    timeout.mockRestore();
    interval.mockRestore();
  }
});

test("sessionTtl takes precedence over session.ttl before validation", () => {
  for (const invalid of [...nonFinite, 0, -1]) {
    expect(() => new Zebra({ sessionTtl: 1, session: { ttl: invalid } })).not.toThrow();
    expect(() => new Zebra({ sessionTtl: invalid, session: { ttl: 1 } })).toThrow(RangeError);
    expect(() => new Zebra({ session: { ttl: invalid } })).toThrow(RangeError);
  }
});

test("time options retain their existing finite ranges, including fractions and zero grace", () => {
  for (const [name, options] of timeOptions) {
    for (const value of [Number.MIN_VALUE, 0.5, 1, Number.MAX_VALUE]) {
      expect(() => new Zebra(options(value))).not.toThrow();
    }
    expect(() => new Zebra(options(-1))).toThrow(RangeError);
    if (name === "gracePeriod") expect(() => new Zebra(options(0))).not.toThrow();
    else expect(() => new Zebra(options(0))).toThrow(RangeError);
  }
});

test("body options keep finite values without imposing a new range or integer restriction", () => {
  for (const [, options] of bodyOptions) {
    for (const value of [-1, -0, 0, Number.MIN_VALUE, 0.5, 1, Number.MAX_VALUE]) {
      expect(() => new Zebra(options(value))).not.toThrow();
    }
  }
});

test("default options retain the shared body cap and leave request timeouts disabled", async () => {
  for (const options of [{}, { body: {}, session: {} }]) {
    const app = new Zebra(options);
    app.post("/", (req) => {
      expect(req.signal).toBe(req.raw.signal);
      return req.body();
    });
    const small = await app.dispatch(jsonRequest("1"));
    expect(small.status).toBe(200);
    expect(await small.json()).toBe(1);
    const large = await app.dispatch(jsonRequest(`"${"x".repeat(1024 * 1024)}"`));
    expect(large.status).toBe(413);
    expect(await large.json()).toMatchObject({ detail: { limit: 1024 * 1024 } });
    await app.stop();
  }
});

test("a non-finite shared cap cannot bypass a finite JSON limit", () => {
  expect(() => new Zebra({ body: { maxSize: Number.NaN, json: { limit: 1 } } })).toThrow(
    RangeError,
  );
});

test("a one-byte JSON limit accepts a small value and rejects an oversized body", async () => {
  const app = new Zebra({ body: { json: { limit: 1 } } });
  app.post("/", (req) => req.body());
  const small = await app.dispatch(jsonRequest("1"));
  expect(small.status).toBe(200);
  expect(await small.json()).toBe(1);
  const large = await app.dispatch(jsonRequest("{}"));
  expect(large.status).toBe(413);
  expect(await large.json()).toMatchObject({
    type: "https://errors.zebra.dev/payload_too_large",
    detail: { limit: 1 },
  });
});

for (const [name, options, contentType] of byteLimits) {
  test(`${name}=0 accepts an empty body and rejects any bytes`, async () => {
    const app = new Zebra(options(0));
    app.post("/", (req) => req.text());
    const request = (body: string) =>
      new Request("http://x/", {
        method: "POST",
        headers: { "content-type": contentType },
        body,
      });
    const empty = await app.dispatch(request(""));
    expect(empty.status).toBe(200);
    expect(await empty.json()).toBe("");
    const nonempty = await app.dispatch(request("x"));
    expect(nonempty.status).toBe(413);
    expect(await nonempty.json()).toMatchObject({ detail: { limit: 0 } });
  });

  test(`${name} retains fractional byte limits`, async () => {
    const app = new Zebra(options(1.5));
    app.post("/", (req) => req.text());
    for (const [body, status] of [
      ["x", 200],
      ["xx", 413],
    ] as const) {
      const response = await app.dispatch(
        new Request("http://x/", {
          method: "POST",
          headers: { "content-type": contentType },
          body,
        }),
      );
      expect(response.status).toBe(status);
      if (status === 413) expect(await response.json()).toMatchObject({ detail: { limit: 1.5 } });
    }
  });
}

test("zero maxFiles preserves nested defaults and accepts fields while rejecting files", async () => {
  // JavaScript callers can supply only one nested override; keep the frozen public type unchanged.
  const options = { body: { multipart: { maxFiles: 0 } } } as ZebraOptions;
  const app = new Zebra(options);
  app.post("/", async (req) => [...(await req.form()).keys()]);
  const fields = new FormData();
  fields.append("name", "value");
  const accepted = await app.dispatch(new Request("http://x/", { method: "POST", body: fields }));
  expect(accepted.status).toBe(200);
  expect(await accepted.json()).toEqual(["name"]);
  fields.append("file", new File([], "empty.txt"));
  const rejected = await app.dispatch(new Request("http://x/", { method: "POST", body: fields }));
  expect(rejected.status).toBe(413);
  expect(await rejected.json()).toMatchObject({
    type: "https://errors.zebra.dev/too_many_files",
    detail: { limit: 0 },
  });
});

test("zero maxFileSize accepts empty files and rejects nonempty files", async () => {
  const app = new Zebra({ body: { multipart: { ...multipartDefaults, maxFileSize: 0 } } });
  app.post("/", async (req) => [...(await req.form()).keys()]);
  for (const [contents, status] of [
    ["", 200],
    ["x", 413],
  ] as const) {
    const form = new FormData();
    form.append("file", new File([contents], "file.txt"));
    const response = await app.dispatch(new Request("http://x/", { method: "POST", body: form }));
    expect(response.status).toBe(status);
    if (status === 413) {
      expect(await response.json()).toMatchObject({
        type: "https://errors.zebra.dev/file_too_large",
        detail: { limit: 0 },
      });
    }
  }
});

function jsonRequest(body: string): Request {
  return new Request("http://x/", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body,
  });
}
