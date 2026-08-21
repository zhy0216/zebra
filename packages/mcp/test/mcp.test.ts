import { expect, test } from "bun:test";
import {
  CallToolResultSchema,
  ErrorCode,
  McpError,
  ToolSchema,
} from "@modelcontextprotocol/sdk/types.js";
import { zc } from "@zebra/contract";
import { HttpError, Zebra } from "@zebra/core";
import { zodSchemaAdapter } from "@zebra/schema-zod";
import { z } from "zod";
import { type McpServerOptions, createMcpServer } from "../src/index.ts";

const Topic = z.object({ id: z.number(), title: z.string().min(1), content: z.string() });

function buildApp(): Zebra {
  const app = new Zebra();
  const store: Array<{ id: number; title: string; content: string }> = [];

  app.implement(
    {
      topics: {
        get: zc
          .get("/topics/:id")
          .params(z.object({ id: z.coerce.number().int() }))
          .output(Topic)
          .mcp("get_topic", "获取主题", { readOnly: true }),
        list: zc
          .get("/topics")
          .query(z.object({ page: z.coerce.number().min(1).default(1) }))
          .output(z.array(Topic))
          .mcp({ name: "list_topics", description: "列出主题", idempotent: true }),
        create: zc
          .post("/topics")
          .body(z.object({ title: z.string().min(1), content: z.string() }))
          .output(Topic)
          .status(201)
          .mcp("create_topic", "创建主题", { destructive: true }),
        remove: zc
          .delete("/topics/:id")
          .params(z.object({ id: z.coerce.number().int() }))
          .status(204)
          .mcp("remove_topic", "删除主题", { destructive: true }),
        notExposed: zc.get("/topics/:id/secret"),
        nested: {
          raw: zc.get("/topics/:id/raw").mcp("get_topic_raw", "原始主题"),
        },
      },
      plain: zc.get("/plain"),
    },
    {
      topics: {
        get: async (req) => {
          const t = store.find((s) => s.id === req.params.id);
          if (t === undefined) throw new HttpError(404, "topic_not_found", "No such topic");
          return t;
        },
        list: async (req) => store.filter((_, i) => i + 1 >= (req.query.page ?? 1)),
        create: async (req) => {
          const body = await req.body();
          const t = { id: store.length + 1, ...body };
          store.push(t);
          return t;
        },
        remove: async (req) => {
          const idx = store.findIndex((s) => s.id === req.params.id);
          if (idx === -1) throw new HttpError(404, "topic_not_found", "No such topic");
          store.splice(idx, 1);
        },
        notExposed: async () => ({ ok: true }),
        nested: {
          raw: async () =>
            new Response("raw text", { status: 200, headers: { "content-type": "text/plain" } }),
        },
      },
      plain: async () => "plain",
    },
  );

  return app;
}

function makeServer(app: Zebra, extra: Partial<McpServerOptions> = {}) {
  return createMcpServer({
    app,
    contract: {
      topics: {
        get: zc
          .get("/topics/:id")
          .params(z.object({ id: z.coerce.number().int() }))
          .output(Topic)
          .mcp("get_topic", "获取主题", { readOnly: true }),
        list: zc
          .get("/topics")
          .query(z.object({ page: z.coerce.number().min(1).default(1) }))
          .output(z.array(Topic))
          .mcp({ name: "list_topics", description: "列出主题", idempotent: true }),
        create: zc
          .post("/topics")
          .body(z.object({ title: z.string().min(1), content: z.string() }))
          .output(Topic)
          .status(201)
          .mcp("create_topic", "创建主题", { destructive: true }),
        remove: zc
          .delete("/topics/:id")
          .params(z.object({ id: z.coerce.number().int() }))
          .status(204)
          .mcp("remove_topic", "删除主题", { destructive: true }),
        notExposed: zc.get("/topics/:id/secret"),
        nested: {
          raw: zc.get("/topics/:id/raw").mcp("get_topic_raw", "原始主题"),
        },
      },
      plain: zc.get("/plain"),
    },
    schema: zodSchemaAdapter(),
    ...extra,
  });
}

test("tools/list returns only .mcp()-declared procedures, with name and description from .mcp()", async () => {
  const mcp = makeServer(buildApp());
  const { tools } = await mcp.listTools();
  const names = tools.map((t) => t.name).sort();
  expect(names).toEqual([
    "create_topic",
    "get_topic",
    "get_topic_raw",
    "list_topics",
    "remove_topic",
  ]);
  const getTopic = tools.find((t) => t.name === "get_topic")!;
  expect(getTopic.description).toBe("获取主题");
  for (const tool of tools) expect(ToolSchema.safeParse(tool).success).toBe(true);
});

test("tool annotations map from .mcp() options (hints only, not authorization)", async () => {
  const mcp = makeServer(buildApp());
  const { tools } = await mcp.listTools();
  const byName = new Map(tools.map((t) => [t.name, t]));
  expect(byName.get("get_topic")?.annotations?.readOnlyHint).toBe(true);
  expect(byName.get("list_topics")?.annotations?.idempotentHint).toBe(true);
  expect(byName.get("create_topic")?.annotations?.destructiveHint).toBe(true);
  expect(byName.get("remove_topic")?.annotations?.destructiveHint).toBe(true);
});

test("inputSchema is generated from the contract schema, namespaced by part", async () => {
  const mcp = makeServer(buildApp());
  const { tools } = await mcp.listTools();
  const getTopic = tools.find((t) => t.name === "get_topic")!;
  expect(getTopic.inputSchema).toEqual({
    type: "object",
    properties: {
      params: {
        type: "object",
        properties: { id: { type: "integer" } },
        required: ["id"],
        additionalProperties: false,
      },
    },
    required: ["params"],
  });

  const createTopic = tools.find((t) => t.name === "create_topic")!;
  expect(createTopic.inputSchema.properties).toHaveProperty("body");
  expect(createTopic.inputSchema.required).toEqual(["body"]); // body only; no path params

  const listTopics = tools.find((t) => t.name === "list_topics")!;
  expect(listTopics.inputSchema.required).toBeUndefined(); // all-optional query
});

test("callTool maps arguments → dispatch → JSON result with structured content", async () => {
  const app = buildApp();
  await app.dispatch(
    new Request("http://test.local/topics", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ title: "t", content: "c" }),
    }),
  );
  const mcp = makeServer(app);

  const result = await mcp.callTool({ name: "get_topic", arguments: { params: { id: 1 } } });
  expect(CallToolResultSchema.safeParse(result).success).toBe(true);
  expect(result.content[0]).toEqual({
    type: "text",
    text: JSON.stringify({ id: 1, title: "t", content: "c" }),
  });
  expect(result.structuredContent).toEqual({ id: 1, title: "t", content: "c" });
});

test("z.coerce transform result is passed to the handler", async () => {
  const app = buildApp();
  await app.dispatch(
    new Request("http://test.local/topics", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ title: "t", content: "c" }),
    }),
  );
  const mcp = makeServer(app);
  // id is sent as a string; z.coerce.number().int() parses it to 1
  const result = await mcp.callTool({ name: "get_topic", arguments: { params: { id: "1" } } });
  expect(result.structuredContent).toEqual({ id: 1, title: "t", content: "c" });
});

test("query and body are forwarded through dispatch", async () => {
  const app = buildApp();
  const mcp = makeServer(app);

  const created = await mcp.callTool({
    name: "create_topic",
    arguments: { body: { title: "a", content: "b" } },
  });
  expect(created.structuredContent).toEqual({ id: 1, title: "a", content: "b" });

  const list = await mcp.callTool({ name: "list_topics", arguments: { query: { page: 1 } } });
  // arrays are conveyed as JSON text (structuredContent only holds objects)
  expect(JSON.parse((list.content[0] as { text: string }).text)).toEqual([
    { id: 1, title: "a", content: "b" },
  ]);
});

test("204 maps to an empty result", async () => {
  const app = buildApp();
  await app.dispatch(
    new Request("http://test.local/topics", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ title: "t", content: "c" }),
    }),
  );
  const mcp = makeServer(app);
  const result = await mcp.callTool({ name: "remove_topic", arguments: { params: { id: 1 } } });
  expect(CallToolResultSchema.safeParse(result).success).toBe(true);
  expect(result.content).toEqual([]);
});

test("non-2xx Problem+Json maps to an isError tool result", async () => {
  const app = buildApp();
  const mcp = makeServer(app);
  const result = await mcp.callTool({ name: "get_topic", arguments: { params: { id: 999 } } });
  expect(CallToolResultSchema.safeParse(result).success).toBe(true);
  expect(result.isError).toBe(true);
  const text = result.content[0] as { type: "text"; text: string };
  expect(text.type).toBe("text");
  const problem = JSON.parse(text.text);
  expect(problem.type).toBe("https://errors.zebra.dev/topic_not_found");
  expect(problem.status).toBe(404);
});

test("invalid input triggers the same 422 ValidationError as HTTP", async () => {
  const app = buildApp();
  const mcp = makeServer(app);
  const result = await mcp.callTool({ name: "create_topic", arguments: { body: { title: "" } } });
  expect(result.isError).toBe(true);
  const problem = JSON.parse((result.content[0] as { text: string }).text);
  expect(problem.status).toBe(422);
});

test("a handler returning a plain Response surfaces as text content", async () => {
  const app = buildApp();
  const mcp = makeServer(app);
  const result = await mcp.callTool({ name: "get_topic_raw", arguments: { params: { id: 1 } } });
  expect(result.content).toEqual([{ type: "text", text: "raw text" }]);
  expect(result.structuredContent).toBeUndefined();
});

test("unknown tools raise MethodNotFound", async () => {
  const mcp = makeServer(buildApp());
  expect(mcp.callTool({ name: "nope" })).rejects.toThrowError(
    new McpError(ErrorCode.MethodNotFound, "Unknown tool: nope"),
  );
});

test("headers option maps MCP context into HTTP headers (auth middleware sees it)", async () => {
  const app = new Zebra();
  app.use(async (req, next) => {
    if (req.headers.get("authorization") !== "Bearer mcp-token") {
      throw new HttpError(401, "unauthorized", "missing token");
    }
    return next();
  });
  app.implement(
    {
      ping: zc.get("/ping").mcp("ping", "ping"),
    },
    {
      ping: async () => ({ pong: true }),
    },
  );

  const mcp = createMcpServer({
    app,
    contract: { ping: zc.get("/ping").mcp("ping", "ping") },
    schema: zodSchemaAdapter(),
    headers: () => ({ authorization: "Bearer mcp-token" }),
  });
  const ok = await mcp.callTool({ name: "ping" });
  expect(ok.structuredContent).toEqual({ pong: true });

  const mcpNoHeader = createMcpServer({
    app,
    contract: { ping: zc.get("/ping").mcp("ping", "ping") },
    schema: zodSchemaAdapter(),
  });
  const denied = await mcpNoHeader.callTool({ name: "ping" });
  expect(denied.isError).toBe(true);
  const problem = JSON.parse((denied.content[0] as { text: string }).text);
  expect(problem.status).toBe(401);
});

test("output schema still validates after the handler returns", async () => {
  const app = new Zebra();
  // The handler intentionally returns a wrong shape to prove runtime output
  // validation still runs behind MCP (bypasses the compile-time check).
  app.implement(
    {
      bad: zc
        .get("/bad")
        .output(z.object({ id: z.number() }))
        .mcp("bad", "bad"),
    },
    { bad: (async () => ({ id: "not-a-number" })) as never },
  );
  const mcp = createMcpServer({
    app,
    contract: {
      bad: zc
        .get("/bad")
        .output(z.object({ id: z.number() }))
        .mcp("bad", "bad"),
    },
    schema: zodSchemaAdapter(),
  });
  const result = await mcp.callTool({ name: "bad" });
  expect(result.isError).toBe(true);
  const problem = JSON.parse((result.content[0] as { text: string }).text);
  expect(problem.type).toBe("https://errors.zebra.dev/output_validation_failed");
  expect(problem.status).toBe(500);
});

test("logger receives request id, tool name and status for each call", async () => {
  const entries: Array<{ tool: string; status: number; requestId: string; durationMs: number }> =
    [];
  const mcp = makeServer(buildApp(), {
    logger: (entry) => entries.push(entry),
  });
  await mcp.callTool({ name: "list_topics" });
  expect(entries).toHaveLength(1);
  expect(entries[0]?.tool).toBe("list_topics");
  expect(entries[0]?.status).toBe(200);
  expect(entries[0]?.requestId.length).toBeGreaterThan(0);
  expect(entries[0]?.durationMs).toBeGreaterThanOrEqual(0);
});

test("an aborted signal is observable on req.signal inside the pipeline", async () => {
  const app = new Zebra();
  app.use(async (req, next) => {
    if (req.signal.aborted) {
      return new Response(JSON.stringify({ sawAbort: true }), {
        headers: { "content-type": "application/json" },
      });
    }
    return next();
  });
  app.implement(
    { ping: zc.get("/ping").mcp("ping", "ping") },
    { ping: async () => ({ pong: true }) },
  );
  const mcp = createMcpServer({
    app,
    contract: { ping: zc.get("/ping").mcp("ping", "ping") },
    schema: zodSchemaAdapter(),
  });
  const controller = new AbortController();
  controller.abort();
  const result = await mcp.callTool({ name: "ping", signal: controller.signal });
  expect(result.structuredContent).toEqual({ sawAbort: true });
});
