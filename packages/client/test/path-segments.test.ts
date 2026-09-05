import { expect, test } from "bun:test";
import { zc } from "@zebra-web/contract";
import { z } from "zod";
import { createTestApp, createTestClient } from "../../testing/src/index.ts";
import { createClient } from "../src/index.ts";

for (const path of ["/clock:zone", "/a*b", "/files/prefix:name"]) {
  test(`static path ${path} reaches its handler without parameters`, async () => {
    const app = createTestApp();
    const contract = { echo: zc.get(path) };
    app.implement(contract, {
      echo: (req) => ({ handler: "echo", pathname: req.url.pathname, params: req.params }),
    });
    try {
      const client = createTestClient(app, contract);
      expect(await client.echo()).toEqual({ handler: "echo", pathname: path, params: {} });
    } finally {
      await app.stop();
    }
  });
}

test("only complete valid parameter segments and terminal wildcards are interpolated", async () => {
  for (const [path, expected] of [
    ["/users/:user-id", "/users/:user-id"],
    ["/users/:id.json", "/users/:id.json"],
    ["/files/*rest.txt", "/files/*rest.txt"],
    ["/files/*rest/:id", "/files/*rest/42"],
  ] as const) {
    const urls: string[] = [];
    const client = createClient(
      { echo: zc.get(path).params(z.record(z.string(), z.string())) },
      {
        baseUrl: "http://test.local",
        fetch: async (url) => {
          urls.push(url);
          return Response.json(null);
        },
      },
    );
    await client.echo({ params: { user: "alice", "user-id": "bob", id: "42", rest: "a/b" } });
    expect(urls).toEqual([`http://test.local${expected}`]);
  }
});

test("missing real parameters fail clearly before fetching", async () => {
  let fetches = 0;
  for (const { path, params, missing } of [
    { path: "/users/:id", params: {}, missing: ":id" },
    { path: "/files/*rest", params: {}, missing: "*rest" },
    { path: "/clock:zone/:id/a*b/*rest", params: { id: "42" }, missing: "*rest" },
  ]) {
    const client = createClient(
      { echo: zc.get(path).params(z.record(z.string(), z.unknown())) },
      {
        baseUrl: "http://test.local",
        fetch: async () => {
          fetches++;
          return Response.json(null);
        },
      },
    );
    await expect(client.echo({ params })).rejects.toThrow(
      `Missing required path parameter "${missing}"`,
    );
  }
  expect(fetches).toBe(0);
});

test("mixed paths preserve base URL prefixes, query/hash, headers and signal", async () => {
  const app = createTestApp();
  app.get("/api/clock:zone/:id", (req) => ({
    pathname: req.url.pathname,
    params: req.params,
    query: req.query,
    authorization: req.headers.get("authorization"),
    extra: req.headers.get("x-default"),
    aborted: req.signal.aborted,
  }));
  const controller = new AbortController();
  let seenUrl: string | undefined;
  let seenSignal: AbortSignal | null | undefined;
  const client = createClient(
    {
      echo: zc
        .get("/clock:zone/:id")
        .params(z.object({ id: z.string() }))
        .query(z.object({ q: z.string() })),
    },
    {
      baseUrl: "http://test.local/api///?keep=yes#fragment",
      headers: () => ({ Authorization: "Bearer old", "X-Default": "yes" }),
      fetch: async (url, init) => {
        seenUrl = url;
        seenSignal = init.signal;
        return app.request(url, init);
      },
    },
  );
  try {
    expect(
      await client.echo({
        params: { id: "a/b?#:*" },
        query: { q: "a & b" },
        headers: { authorization: "Bearer new" },
        signal: controller.signal,
      }),
    ).toEqual({
      pathname: "/api/clock:zone/a%2Fb%3F%23%3A*",
      params: { id: "a/b?#:*" },
      query: { keep: "yes", q: "a & b" },
      authorization: "Bearer new",
      extra: "yes",
      aborted: false,
    });
    expect(seenUrl).toBe(
      "http://test.local/api/clock:zone/a%2Fb%3F%23%3A*?keep=yes&q=a+%26+b#fragment",
    );
    expect(seenSignal).toBe(controller.signal);
  } finally {
    await app.stop();
  }
});
