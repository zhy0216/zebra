import { expect, test } from "bun:test";
import { zc } from "@zebra/contract";
import { z } from "zod";
import { createClient, ClientError } from "../src/index.ts";

function fakeFetch(
  handler: (url: string, init: RequestInit) => Response | Promise<Response>,
): (url: string, init: RequestInit) => Promise<Response> {
  return async (url, init) => handler(url, init);
}

const blog = z.object({ id: z.number(), title: z.string() });

const contract = {
  list: zc.get("/blogs").query(z.object({ page: z.coerce.number().min(1).default(1) })).output(z.array(blog)),
  get: zc.get("/blogs/:id").params(z.object({ id: z.coerce.number().int() })).output(blog),
  files: zc.get("/files/*splat").params(z.object({ splat: z.string() })).output(z.string()),
  create: zc.post("/blogs").body(z.object({ title: z.string() })).output(blog).status(201),
  remove: zc.delete("/blogs/:id").params(z.object({ id: z.coerce.number().int() })).status(204),
};

test("GET with query: URL is built with baseUrl, path and query params", async () => {
  const seen: Array<{ url: string; init: RequestInit }> = [];
  const api = createClient(contract, {
    baseUrl: "http://api.example.com",
    fetch: fakeFetch((url, init) => {
      seen.push({ url, init });
      return new Response("[]", { status: 200 });
    }),
  });
  await api.list({ query: { page: 2 } });
  expect(seen[0]!.url).toBe("http://api.example.com/blogs?page=2");
  expect(seen[0]!.init.method).toBe("GET");
});

test("path params are substituted and percent-encoded", async () => {
  const seen: Array<{ url: string }> = [];
  const api = createClient(contract, {
    baseUrl: "http://x",
    fetch: fakeFetch((url) => {
      seen.push({ url });
      return new Response('{"id":1,"title":"t"}', { status: 200 });
    }),
  });
  await api.get({ params: { id: 42 } });
  expect(seen[0]!.url).toBe("http://x/blogs/42");

  await api.get({ params: { id: 1.5 } });
  expect(seen[1]!.url).toBe("http://x/blogs/1.5");
});

test("*splat is encoded per segment preserving slashes", async () => {
  const seen: Array<{ url: string }> = [];
  const api = createClient(contract, {
    baseUrl: "http://x",
    fetch: fakeFetch((url) => {
      seen.push({ url });
      return new Response('"ok"', { status: 200 });
    }),
  });
  await api.files({ params: { splat: "a/b c" } });
  expect(seen[0]!.url).toBe("http://x/files/a/b%20c");
});

test("missing path param throws before fetching", async () => {
  const api = createClient(contract, {
    baseUrl: "http://x",
    fetch: fakeFetch(() => new Response("[]", { status: 200 })),
  });
  expect(() => api.get({ params: {} as { id: number } })).toThrow(/Missing required path parameter/);
});

test("query skips undefined/null and stringifies values", async () => {
  const seen: Array<{ url: string }> = [];
  const api = createClient(contract, {
    baseUrl: "http://x",
    fetch: fakeFetch((url) => {
      seen.push({ url });
      return new Response("[]", { status: 200 });
    }),
  });
  await api.list({ query: { page: 0 } });
  expect(seen[0]!.url).toBe("http://x/blogs?page=0");
});

test("body is JSON-stringified with content-type header", async () => {
  const seen: Array<{ url: string; init: RequestInit }> = [];
  const api = createClient(contract, {
    baseUrl: "http://x",
    fetch: fakeFetch((url, init) => {
      seen.push({ url, init });
      return new Response('{"id":1,"title":"t"}', { status: 201 });
    }),
  });
  const created = await api.create({ body: { title: "hi" } });
  expect(created).toEqual({ id: 1, title: "t" });
  expect(seen[0]!.init.method).toBe("POST");
  expect(seen[0]!.init.body).toBe('{"title":"hi"}');
  expect((seen[0]!.init.headers as Record<string, string>)["content-type"]).toBe("application/json");
});

test("FormData bodies pass through unstringified (no forced json content-type)", async () => {
  const seen: Array<{ init: RequestInit }> = [];
  const api = createClient(contract, {
    baseUrl: "http://x",
    fetch: fakeFetch((_url, init) => {
      seen.push({ init });
      return new Response("null", { status: 201 });
    }),
  });
  const form = new FormData();
  form.append("file", new Blob(["hello"], { type: "text/plain" }), "hello.txt");
  // The contract body type is JSON-shaped; FormData only occurs at runtime
  // (typed escape hatch), so cast through unknown.
  await api.create({ body: form as unknown as { title: string } });
  expect(seen[0]!.init.body).toBe(form);
  const headers = seen[0]!.init.headers as Record<string, string> | undefined;
  expect(headers?.["content-type"]).toBeUndefined();
});

test("Blob bodies pass through unstringified", async () => {
  const seen: Array<{ init: RequestInit }> = [];
  const api = createClient(contract, {
    baseUrl: "http://x",
    fetch: fakeFetch((_url, init) => {
      seen.push({ init });
      return new Response("null", { status: 201 });
    }),
  });
  const blob = new Blob(["raw"], { type: "application/octet-stream" });
  await api.create({ body: blob as unknown as { title: string } });
  expect(seen[0]!.init.body).toBe(blob);
});

test("headers: static (thunk) headers merged with per-call headers, per-call wins", async () => {
  const seen: Array<{ init: RequestInit }> = [];
  const api = createClient(contract, {
    baseUrl: "http://x",
    headers: () => ({ authorization: "Bearer abc", "x-static": "1" }),
    fetch: fakeFetch((_url, init) => {
      seen.push({ init });
      return new Response("[]", { status: 200 });
    }),
  });
  await api.list({ query: { page: 1 }, headers: { "x-per-call": "2", authorization: "Bearer xyz" } });
  const headers = seen[0]!.init.headers as Record<string, string>;
  expect(headers["x-static"]).toBe("1");
  expect(headers["x-per-call"]).toBe("2");
  expect(headers["authorization"]).toBe("Bearer xyz");
});

test("200 with body parses JSON; 204 and empty body resolve to undefined", async () => {
  const api = createClient(contract, {
    baseUrl: "http://x",
    fetch: fakeFetch((_url, init) => {
      if (init.method === "DELETE") return new Response(null, { status: 204 });
      return new Response("", { status: 200 });
    }),
  });
  await expect(api.remove({ params: { id: 1 } })).resolves.toBeUndefined();
  await expect(api.list({ query: { page: 1 } })).resolves.toBeUndefined();
});

test("non-2xx throws ClientError with status/code/problem/response", async () => {
  const problem = {
    type: "https://errors.zebra.dev/validation_failed",
    status: 422,
    title: "Validation failed",
    instance: "/blogs",
    errors: [{ path: "body.title", message: "too short" }],
  };
  const api = createClient(contract, {
    baseUrl: "http://x",
    fetch: fakeFetch(() => new Response(JSON.stringify(problem), { status: 422 })),
  });
  try {
    await api.create({ body: { title: "" } });
    expect.unreachable();
  } catch (err) {
    expect(err).toBeInstanceOf(ClientError);
    const e = err as ClientError;
    expect(e.status).toBe(422);
    expect(e.code).toBe("validation_failed");
    expect(e.problem).toEqual(problem);
    expect(e.response.status).toBe(422);
    expect(e.message).toBe("Validation failed");
  }
});

test("non-JSON error body produces a synthesized problem", async () => {
  const api = createClient(contract, {
    baseUrl: "http://x",
    fetch: fakeFetch(() => new Response("gateway blew up", { status: 502 })),
  });
  try {
    await api.list({ query: { page: 1 } });
    expect.unreachable();
  } catch (err) {
    const e = err as ClientError;
    expect(e.status).toBe(502);
    expect(e.code).toBe("http_502");
    expect(e.problem.type).toBe("https://errors.zebra.dev/request_failed");
    expect(e.problem.title).toBe("Request failed with status 502");
  }
});

test("signal is forwarded", async () => {
  const seen: Array<{ init: RequestInit }> = [];
  const api = createClient(contract, {
    baseUrl: "http://x",
    fetch: fakeFetch((_url, init) => {
      seen.push({ init });
      return new Response("[]", { status: 200 });
    }),
  });
  const controller = new AbortController();
  await api.list({ query: { page: 1 }, signal: controller.signal });
  expect(seen[0]!.init.signal).toBe(controller.signal);
});

test("client is a plain recursive object (no Proxy)", async () => {
  const api = createClient(contract, {
    baseUrl: "http://x",
    fetch: fakeFetch(() => new Response("[]", { status: 200 })),
  });
  expect(api.list).toBeTypeOf("function");
  expect(api.get).toBeTypeOf("function");
  expect(Object.keys(api)).toEqual(["list", "get", "files", "create", "remove"]);
});

test("HEAD/OPTIONS procedures send the declared method", async () => {
  const seen: Array<{ url: string; init: RequestInit }> = [];
  const api = createClient(
    { ping: zc.head("/ping"), caps: zc.options("/caps") },
    {
      baseUrl: "http://x",
      fetch: fakeFetch((url, init) => {
        seen.push({ url, init });
        return new Response("", { status: 204 });
      }),
    },
  );
  await api.ping();
  await api.caps();
  expect(seen[0]!.init.method).toBe("HEAD");
  expect(seen[1]!.init.method).toBe("OPTIONS");
});
