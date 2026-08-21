# 从契约导出 MCP 工具

Zebra 的契约优先模式（`@zebra/contract` → `app.implement` → `@zebra/client`）可以扩展到 MCP：用 `.mcp()` 把某个 procedure 声明为 MCP tool，`@zebra/mcp` 通过**同一份契约**将其暴露为 MCP 工具 —— 相同的 schema、相同的 middleware、相同的 DI、相同的运行时校验。

```text
@zebra/contract:   zc.get(...).mcp("get_topic", "获取主题", { readOnly: true })
@zebra/schema-zod: zod → JSON Schema（inputSchema / codegen）
@zebra/mcp:        tools/list + tools/call → HTTP Request → app.dispatch()
```

## 包

- `@zebra/contract` — 新增 `.mcp()` builder（MCP 元数据落在契约 def 上）
- `@zebra/schema-zod` — Zod → JSON Schema adapter（zod 依赖隔离在此）
- `@zebra/mcp` — MCP 协议适配 + HTTP dispatch 桥接（唯一依赖 MCP SDK 的包）

`@zebra/core` 运行时既不依赖 zod，也不依赖任何 MCP SDK。

## 声明一个工具

```ts
import { zc } from "@zebra/contract";
import { z } from "zod";

const Topic = z.object({ id: z.number(), title: z.string(), content: z.string() });

const api = {
  topics: {
    get: zc
      .get("/topics/:id")
      .params(z.object({ id: z.coerce.number().int() }))
      .output(Topic)
      .mcp("get_topic", "获取主题", { readOnly: true }),
    create: zc
      .post("/topics")
      .body(z.object({ title: z.string().min(1), content: z.string() }))
      .output(Topic)
      .status(201)
      .mcp({ name: "create_topic", description: "创建主题", destructive: true }),
  },
  // 没有 .mcp() → 不作为 MCP 工具暴露
  internal: zc.get("/internal/stats"),
};
```

`.mcp()` 支持位置参数 `(name, description, options?)` 与对象形式两种重载。选项只是**描述 / annotation，绝不是授权判断**：

| option | MCP annotation | 含义 |
| --- | --- | --- |
| `title` | `Tool.title` | 工具显示标题 |
| `readOnly` | `readOnlyHint` | 可安全重复调用、无副作用 |
| `destructive` | `destructiveHint` | 不可逆副作用 |
| `idempotent` | `idempotentHint` | 重复调用安全 |
| `openWorld` | `openWorldHint` | 可能影响外部世界 |

真正的鉴权仍然由 Zebra 的 middleware / session / DI 完成。

## 创建 MCP server

```ts
import { Zebra } from "@zebra/core";
import { createMcpServer } from "@zebra/mcp";
import { zodSchemaAdapter } from "@zebra/schema-zod";

const app = new Zebra();
app.implement(api, { /* handlers */ });

const mcp = createMcpServer({
  app,
  contract: api,
  schema: zodSchemaAdapter(),
});

// 连接任意 MCP transport（stdio / SSE / streamable HTTP）：
await mcp.connect(new StdioServerTransport());
```

`@zebra/mcp` 只处理 `tools/list`、`tools/call` 以及 Request ↔ Response 映射；其余全部走 `app.dispatch()`：

```text
MCP tools/call
  ↓ { params, query, body }
HTTP Request
  ↓ app.dispatch()
router / middleware / auth / session / rate-limit / DI / contract validation
  ↓ Response
MCP result
```

## 参数形状

MCP arguments 是**命名空间化**的（`{ params, query, body }`），避免 path/query/body 字段重名：

```json
{ "params": { "id": 123 }, "query": { "includePosts": true }, "body": {} }
```

`inputSchema` 由契约 schema 生成：声明了 `params` 即 required，`query`/`body` 跟随其自身 schema 的 required（全 optional 的部分可以省略）。

## 结果映射

| HTTP 响应 | MCP result |
| --- | --- |
| 2xx JSON 对象 | `content: [text JSON]` + `structuredContent` |
| 2xx JSON 数组 / 标量 | `content: [text JSON]` |
| 2xx 文本（普通 `Response`） | `content: [text]` |
| 204 | `content: []` |
| 非 2xx Problem+Json | `isError: true` 工具错误，正文为 Problem+Json |
| 未知工具名 | 协议层 `MethodNotFound` 错误 |

Zod `transform` / `coerce` 的结果仍然原样传给 handler —— JSON Schema 只描述输入形状，运行时校验不变。

## 转发上下文

把 MCP 调用上下文映射为 HTTP headers，让既有鉴权 middleware 继续生效：

```ts
const mcp = createMcpServer({
  app,
  contract: api,
  schema: zodSchemaAdapter(),
  headers: (ctx) => ({ authorization: `Bearer ${tokenFor(ctx.name)}` }),
});
```

还可以通过 `logger` 观察每次调用（request id + tool name + status + duration），并通过 `callTool({ name, arguments, signal })` 透传 `AbortSignal`。

## 直接使用（不走 transport）

测试与工具场景下，`mcp` 也暴露 `listTools()` 与 `callTool()`，无需 transport 即可进程内驱动：

```ts
const { tools } = await mcp.listTools();
const result = await mcp.callTool({ name: "get_topic", arguments: { params: { id: 1 } } });
```

## 测试

`@zebra/mcp` 的测试进程内跑完整链路（MCP call → `app.dispatch()` → 契约校验 → result）。由于桥接复用了 dispatch，`app.implement` 实现的同一份契约既可以被 `createTestClient`（[测试](12-testing.md)）覆盖，也可以被 MCP 覆盖，业务逻辑零重复。

## 下一步

- [契约优先 API](11-contract-first.md) — 契约 builder、`app.implement`、`createClient`
- [测试](12-testing.md) — 基于同一契约的进程内测试客户端
