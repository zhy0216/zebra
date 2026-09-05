import { expect, test } from "bun:test";
import { zc } from "@zebra-web/contract";
import { createTestApp, createTestClient } from "@zebra-web/testing";
import { z } from "zod";
import { argumentsToRequest } from "../src/bridge.ts";

const cases: Array<{
  name: string;
  path: string;
  params: Record<string, unknown>;
  pathname: string;
  captured: Record<string, string>;
}> = [
  { name: "static colon", path: "/clock:zone", params: {}, pathname: "/clock:zone", captured: {} },
  { name: "static star", path: "/a*b", params: {}, pathname: "/a*b", captured: {} },
  {
    name: "static parameter suffix",
    path: "/files/prefix:name",
    params: { name: "ignored" },
    pathname: "/files/prefix:name",
    captured: {},
  },
  {
    name: "encoded parameter",
    path: "/users/:id",
    params: { id: "a/b?#%:id*rest" },
    pathname: "/users/a%2Fb%3F%23%25%3Aid*rest",
    captured: { id: "a/b?#%:id*rest" },
  },
  {
    name: "repeated parameter",
    path: "/users/:id/:id",
    params: { id: "*rest/:id" },
    pathname: "/users/*rest%2F%3Aid/*rest%2F%3Aid",
    captured: { id: "*rest/:id" },
  },
  {
    name: "encoded wildcard",
    path: "/files/*rest",
    params: { rest: "dir/:id/*rest/a?b/#hash/a%2Fb" },
    pathname: "/files/dir/%3Aid/*rest/a%3Fb/%23hash/a%252Fb",
    captured: { rest: "dir/%3Aid/*rest/a%3Fb/%23hash/a%252Fb" },
  },
  {
    name: "empty wildcard",
    path: "/files/*rest",
    params: { rest: "" },
    pathname: "/files/",
    captured: { rest: "" },
  },
  {
    name: "wildcard with trailing route slashes",
    path: "/files/*rest///",
    params: { rest: "nested/file" },
    pathname: "/files/nested/file///",
    captured: { rest: "nested/file" },
  },
  {
    name: "mixed static and dynamic segments",
    path: "/clock:zone/a*b/files/prefix:name/:id/:id/*rest",
    params: { zone: "ignored", b: "ignored", name: "ignored", id: ":id*rest", rest: "x/:id/*rest" },
    pathname: "/clock:zone/a*b/files/prefix:name/%3Aid*rest/%3Aid*rest/x/%3Aid/*rest",
    captured: { id: ":id*rest", rest: "x/%3Aid/*rest" },
  },
  {
    name: "letters digits and underscores in parameter names",
    path: "/users/:ID_9/:0/*REST_1",
    params: { ID_9: "alice", "0": 0, REST_1: "a/b" },
    pathname: "/users/alice/0/a/b",
    captured: { ID_9: "alice", "0": "0", REST_1: "a/b" },
  },
];

for (const { name, path, params, pathname, captured } of cases) {
  test(`client and MCP dispatch the same contract: ${name}`, async () => {
    const app = createTestApp();
    const contract = { echo: zc.get(path).params(z.record(z.string(), z.unknown())) };
    const calls: unknown[] = [];
    app.implement(contract, {
      echo: (req) => {
        const result = { handler: "echo", pathname: req.url.pathname, params: req.params };
        calls.push(result);
        return result;
      },
    });
    try {
      const expected = { handler: "echo", pathname, params: captured };
      const client = createTestClient(app, contract);
      expect(await client.echo({ params })).toEqual(expected);
      const request = argumentsToRequest(contract.echo.def, { params }, "http://mcp.local", {});
      const response = await app.dispatch(request);
      expect(response.status).toBe(200);
      expect(await response.json()).toEqual(expected);
      expect(calls).toEqual([expected, expected]);
    } finally {
      await app.stop();
    }
  });
}

test("MCP static paths accept absent arguments", async () => {
  for (const path of ["/clock:zone", "/a*b", "/files/prefix:name"]) {
    const app = createTestApp();
    const procedure = zc.get(path);
    app.implement(procedure, (req) => ({ pathname: req.url.pathname, params: req.params }));
    try {
      const request = argumentsToRequest(procedure.def, undefined, "http://mcp.local", {});
      const response = await app.dispatch(request);
      expect(response.status).toBe(200);
      expect(await response.json()).toEqual({ pathname: path, params: {} });
    } finally {
      await app.stop();
    }
  }
});

test("MCP leaves invalid tokens intact and core still rejects their routes", async () => {
  for (const [path, expected, error] of [
    ["/users/:user-id", "/users/:user-id", "must contain only letters, digits and underscores"],
    ["/users/:id.json", "/users/:id.json", "must contain only letters, digits and underscores"],
    ["/files/*rest.txt", "/files/*rest.txt", "must contain only letters, digits and underscores"],
    ["/files/*rest/:id", "/files/*rest/42", "must be the last segment"],
  ] as const) {
    const app = createTestApp();
    const procedure = zc.get(path);
    try {
      const request = argumentsToRequest(
        procedure.def,
        { params: { user: "alice", "user-id": "bob", id: "42", rest: "a/b" } },
        "http://mcp.local",
        {},
      );
      expect(new URL(request.url).pathname).toBe(expected);
      expect(() => app.implement(procedure, () => null)).toThrow(error);
    } finally {
      await app.stop();
    }
  }
});

test("MCP missing real parameters retain explicit errors", () => {
  for (const { path, params, missing } of [
    { path: "/users/:id", params: {}, missing: ":id" },
    { path: "/files/*rest", params: {}, missing: "*rest" },
    { path: "/clock:zone/:id/a*b/*rest", params: { id: "42" }, missing: "*rest" },
  ]) {
    expect(() => argumentsToRequest(zc.get(path).def, { params }, "http://mcp.local", {})).toThrow(
      `Missing required path parameter "${missing}"`,
    );
  }
});

test("MCP mixed paths preserve base URL prefixes, query/hash, headers and signal", async () => {
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
  try {
    const request = argumentsToRequest(
      zc.get("/clock:zone/:id").def,
      {
        params: { id: "a/b?#:*" },
        query: { q: "a & b" },
        headers: { authorization: "Bearer new" },
      },
      "http://mcp.local/api///?keep=yes#fragment",
      { Authorization: "Bearer old", "X-Default": "yes" },
      { signal: controller.signal },
    );
    expect(request.url).toBe(
      "http://mcp.local/api/clock:zone/a%2Fb%3F%23%3A*?keep=yes&q=a+%26+b#fragment",
    );
    expect(request.signal.aborted).toBe(false);
    controller.abort();
    expect(request.signal.aborted).toBe(true);
    const response = await app.dispatch(request);
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({
      pathname: "/api/clock:zone/a%2Fb%3F%23%3A*",
      params: { id: "a/b?#:*" },
      query: { keep: "yes", q: "a & b" },
      authorization: "Bearer new",
      extra: "yes",
      aborted: true,
    });
  } finally {
    await app.stop();
  }
});
