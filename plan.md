# Zebra Contract-first SDK / MCP 计划

状态：Phase 0–4 已实现（见下文「实现状态」），Phase 5（codegen）为后续规划。

## 0. 实现状态

已按本计划的 Phase 1–4 完成第一版，新增/改动如下：

- `@zebra/contract`：`ContractProcedureDef` 新增 `mcp` 字段；`ContractProcedure` 新增 `.mcp(name, description, options?)` 与 `.mcp(decl)` 两种重载；builder 保持 immutable/frozen 语义并做 name/description 非空运行时校验；`McpOptions` / `McpDeclaration` 类型导出。
- `@zebra/core` / `@zebra/client`：`ContractProcedureDef` 保持结构一致（vendored parity 字段 `mcp`），无行为改动。
- `@zebra/schema-zod`（新包）：Zod → JSON Schema（draft-7）adapter，隔离 zod/zod-to-json-schema 运行时依赖；支持 `coerce`、optional/default、array、union、enum、record、nullable、transform（保留 input 形状，运行时校验仍由 dispatch 执行）；支持手工 JSON Schema override（`SchemaOverride`）。
- `@zebra/mcp`（新包）：`createMcpServer({ app, contract, schema })`，基于官方 `@modelcontextprotocol/sdk` 的 `Server`。`tools/list` 只暴露声明 `.mcp()` 的 procedure；`tools/call` 将 `{ params, query, body }` arguments 映射为 HTTP `Request` 后走 `app.dispatch()`，复用 Zebra middleware / DI / 鉴权 / session / 契约校验；2xx JSON → text content + structuredContent（对象时），文本 → text content，204 → 空结果，非 2xx Problem+Json → `isError` 工具错误，未知 tool → `MethodNotFound`。
- 边界：MCP 协议 SDK 依赖只存在于 `@zebra/mcp`；`@zebra/contract` / `@zebra/core` 未新增任何 zod/MCP 运行时依赖；`@zebra/client` 保持现状。

验证：`typecheck` / `lint`（改动文件）/ `build` / `test`（621 pass）/ `verify:packages`（12 包）全部通过。
（注：`bun run lint` 在 `docs/.vitepress/theme/custom.css` 与 `docs/.vitepress/config.mts` 上存在与本次改动无关的、提交时已存在的格式错误。）

## 1. 目标

让 Zebra 的 contract 成为可复用的能力描述源，并从同一份 contract 派生：

```text
Contract
  ├── HTTP API
  ├── TypeScript SDK（当前已有 @zebra/client）
  ├── MCP Tools
  └── 后续的 OpenAPI / 多语言 SDK
```

第一阶段聚焦 MCP 和现有 TypeScript SDK，不把 AI 模型调用、Agent 编排或 RAG 放进 Zebra core。

## 2. 已确定的设计决策

### 2.1 Contract 是 SDK/MCP 的唯一导出源

只有通过 `zc.*` 声明并通过 `app.implement()` 注册的 contract procedure，才可被 SDK、MCP 或后续 codegen 消费。

普通 `app.get()` / `app.post()` 保留，作为低级 HTTP escape hatch，用于：

- health check、metrics、纯文本响应
- SSE、文件下载、重定向和自定义 `Response`
- 原始 webhook body 和签名校验
- 静态文件和其他非结构化 endpoint

普通路由不自动导出为 MCP tool，也不自动生成伪 contract。

### 2.2 MCP 使用专用 fluent API

不采用嵌套的通用 metadata：

```ts
.meta({
  mcp: {
    expose: true,
    name: "get_topic",
    description: "获取主题",
  },
})
```

采用显式的 `.mcp()`：

```ts
zc
  .get("/topics/:id")
  .params(TopicParams)
  .output(Topic)
  .mcp("get_topic", "获取主题", {
    readOnly: true,
  });
```

`.mcp()` 的调用本身表示暴露为 MCP tool，因此不再需要 `expose: true`。

建议支持对象形式作为可扩展重载：

```ts
.mcp({
  name: "get_topic",
  description: "获取主题",
  readOnly: true,
})
```

首版 options：

```ts
interface McpOptions {
  title?: string;
  readOnly?: boolean;
  destructive?: boolean;
  idempotent?: boolean;
  openWorld?: boolean;
}
```

这些是 MCP 描述/annotations，不是权限控制。真正的鉴权仍然由 Zebra middleware、session 和 DI 完成。

### 2.3 Contract 层保持传输和厂商无关

`@zebra/contract` 继续依赖 `StandardSchemaV1`，不直接依赖 Zod。Zod schema 可以直接传给 `.params()`、`.query()`、`.body()` 和 `.output()`，因为当前 Zod 版本实现了 Standard Schema 接口。

Zod 只作为 adapter 使用：

```text
Zod / Valibot / ArkType
  └── Standard Schema：HTTP runtime validation
  └── JSON Schema adapter：MCP inputSchema / codegen
```

运行时校验继续复用现有 `app.implement()`：params → query → body → handler → output。MCP 不复制第二套业务执行链。

### 2.4 MCP 调用最终走 `app.dispatch()`

MCP `tools/call` 的 arguments 映射为 HTTP Request，再调用 Zebra 的 dispatch pipeline：

```text
MCP tools/call
  ↓
{ params, query, body }
  ↓
HTTP Request
  ↓
app.dispatch()
  ↓
router / middleware / auth / session / rate-limit / DI / contract validation
  ↓
Response
  ↓
MCP result
```

这样 HTTP 和 MCP 共享同一套业务逻辑、输入输出校验和错误处理。

## 3. 目标 API

### 3.1 Contract

```ts
const api = {
  topics: {
    get: zc
      .get("/topics/:id")
      .params(z.object({
        id: z.coerce.number().int(),
      }))
      .output(Topic)
      .mcp("get_topic", "获取主题", {
        readOnly: true,
      }),
  },
};
```

`.mcp()` 需要保持 contract builder 的现有特性：不可变、返回新的 procedure、保留完整的泛型推导。

### 3.2 MCP server adapter

建议新增独立包：

```text
@zebra/mcp
```

目标调用形式：

```ts
const mcp = createMcpServer({
  app,
  contract: api,
  schema: zodSchemaAdapter(),
});
```

MCP adapter 只处理：

- 遍历 contract router
- 筛选声明了 `.mcp()` 的 procedure
- 生成 `tools/list`
- 接收 `tools/call`
- 将 arguments 转为 Request
- 将 Response 转为 MCP result

### 3.3 MCP 参数形状

为避免 path/query/body 字段重名，MCP arguments 不拍平：

```json
{
  "params": { "id": 123 },
  "query": { "includePosts": true },
  "body": {}
}
```

不存在的部分不强制要求。adapter 根据 contract 的 schema 生成对应的 `inputSchema`。

## 4. 包和模块边界

### 4.1 `@zebra/contract`

负责：

- `McpOptions` / MCP metadata 类型
- `ContractProcedure.mcp()` 类型和 builder 实现
- contract router 遍历/manifest 的基础能力

不负责：

- MCP 协议 transport
- Zod import
- JSON Schema 转换

### 4.2 `@zebra/client`

保留当前 TypeScript client。MCP 相关改动只在需要时复用 contract 类型，不改变现有 client 调用方式。

### 4.3 `@zebra/mcp`

负责 MCP 协议适配和 HTTP dispatch bridge。协议 SDK/transport 依赖隔离在这里，不进入 `@zebra/core`。

### 4.4 Schema adapter

首版需要一个 Zod → JSON Schema adapter。实现方式可以是：

- `@zebra/mcp-zod`：MCP 专用的 Zod adapter；或
- `@zebra/schema-zod`：可被 OpenAPI、MCP、codegen 共用的 adapter。

已实现：采用 **`@zebra/schema-zod`**（可被 OpenAPI、MCP、codegen 共用），依赖方向为 `@zebra/schema-zod → @zebra/contract`（仅类型）。核心要求满足：`@zebra/contract` 和 `@zebra/core` 不新增 Zod runtime 依赖（zod 与 zod-to-json-schema 只出现在 `@zebra/schema-zod`）。

## 5. 分阶段实现

### Phase 0：契约设计和边界确认

- [x] 确定 `.mcp(name, description, options?)` 的类型签名
- [x] 确定 MCP options 到协议 annotations 的映射（readOnly→readOnlyHint、destructive→destructiveHint、idempotent→idempotentHint、openWorld→openWorldHint，title→Tool.title）
- [x] 确定 `tools/call` 的参数命名空间（`{ params, query, body, headers }`）
- [x] 确定 Response → MCP result 的 JSON、文本、错误映射
- [x] 确定 `@zebra/mcp` 与官方 MCP TypeScript SDK 的依赖边界（SDK 仅作为 `@zebra/mcp` 依赖，使用其 `Server`/类型/schema）
- [x] 明确当前不加入 `operationId`

### Phase 1：Contract 增加 MCP 声明

- [x] 在 `ContractProcedureDef` 中增加类型化的 MCP 描述字段（`mcp: McpDeclaration | undefined`）
- [x] 在 `ContractProcedure` 接口增加 `.mcp()` 重载（位置参数 + 对象形式）
- [x] 在 builder 中保持 immutable copy/freeze 语义
- [x] 增加 name 非空、description 非空等运行时校验
- [x] 增加类型测试和 builder 测试
- [x] 确保 `prefix()`、`routeTable` 和 contract parity 正常保留 MCP metadata（`prefix()` 通过 def spread 自动保留；core/client 的 vendored `ContractProcedureDef` 同步新增 `mcp` 字段）

### Phase 2：Manifest 和 Schema adapter

- [x] 提供 contract router 的稳定遍历函数（`collectTools`，仅收集 `.mcp()` 声明的 procedure）
- [x] 定义 MCP tool manifest 类型（`McpToolManifest`）
- [x] 将 params/query/body 组合为 MCP `inputSchema`（命名空间化；`params` 声明即 required，query/body 跟随其 schema 的 required）
- [x] 接入 Zod → JSON Schema adapter（`@zebra/schema-zod` 的 `zodSchemaAdapter()`）
- [x] 对无法完整表达为 JSON Schema 的 transform/refine 保留 runtime validation（adapter 输出 input 形状，校验仍由 dispatch 执行）
- [x] 允许必要时提供手工 JSON Schema 覆盖（`zodSchemaAdapter(overrides)` 的 `SchemaOverride`）
- [x] 测试 `z.coerce`、optional、array、union、nested object 等常用 schema

### Phase 3：`@zebra/mcp` 最小可用版本

- [x] 实现 `tools/list`
- [x] 实现 `tools/call`
- [x] 根据 params 替换 path 参数并进行 URL 编码
- [x] 根据 query 生成 query string
- [x] 根据 body 生成 JSON Request body
- [x] 通过 `app.dispatch()` 执行
- [x] 将 2xx JSON Response 映射为 structured content（text content + structuredContent，对象时）
- [x] 将文本 Response 映射为 text content
- [x] 将 Problem+Json / 非 2xx 映射为 MCP tool error（`isError: true`）
- [x] 将 204 映射为空结果
- [x] 增加端到端测试：MCP call → Zebra route → contract validation → result

### Phase 4：安全、可观测性和生产边界

- [x] 支持 MCP context 到 HTTP headers 的显式映射（`headers` 选项，静态或按 call context 的函数）
- [x] 确认现有 auth/session/rate-limit middleware 在 MCP bridge 中生效（auth middleware 测试覆盖）
- [x] 不把 readOnly/destructive 等 annotation 当作授权判断（仅作为 hints 输出，无授权逻辑）
- [x] 为 MCP call 增加 request id / tool name 日志字段（`logger` 选项：requestId / tool / status / durationMs）
- [x] 复用现有 request timeout 和 `req.signal`（callTool 支持 `signal`，透传进 Request）
- [ ] 对并发、超时、客户端断开和 provider transport 错误增加测试（已覆盖 abort signal；并发与 transport 层错误测试留待接入具体 transport 后补充）

### Phase 5：后续 codegen

- [ ] 从同一个 manifest 导出 OpenAPI
- [ ] 生成 Python/Go 等 SDK
- [ ] 评估是否需要独立的 `operationId`
- [ ] 评估 schema adapter 的通用缓存和版本策略

## 6. 明确不做的事情

当前计划不包含：

- 删除 `app.get()` / `app.post()` 等普通 HTTP API
- 自动把普通 route 暴露成 MCP tool
- 在 `@zebra/core` 中加入 MCP 协议依赖
- 在 contract 层绑定 Zod
- 自动生成 Agent、workflow 或 RAG
- 自动推断权限
- 当前加入 `operationId`
- 第一版支持文件下载、WebSocket、SSE 作为普通 MCP tool 结果

## 7. 验收标准

完成第一版后，以下代码应能工作：

```ts
const api = {
  topics: {
    get: zc
      .get("/topics/:id")
      .params(z.object({ id: z.coerce.number().int() }))
      .output(Topic)
      .mcp("get_topic", "获取主题", { readOnly: true }),
  },
};

app.implement(api, handlers);

const mcp = createMcpServer({
  app,
  contract: api,
  schema: zodSchemaAdapter(),
});
```

并满足：

- `tools/list` 只返回声明了 `.mcp()` 的 procedure
- MCP tool 名称和描述来自 `.mcp()`
- MCP 输入参数由 contract schema 生成
- MCP 调用经过 Zebra 原有 middleware、DI、鉴权和 runtime validation
- params/query/body 的 Zod transform 结果传给 handler
- output schema 仍然在 handler 返回后校验
- HTTP SDK 与 MCP 使用同一份 contract
- 普通 `app.get()` / `app.post()` 的现有行为和 API 不变
- 全部通过 typecheck、unit test 和 integration test

## 8. 当前推荐落点

已实现（首版）：

```text
@zebra/contract:  .mcp() 声明（Phase 1）
@zebra/client:    保持现状
@zebra/schema-zod: Zod → JSON Schema adapter（Phase 2，命名确定为 @zebra/schema-zod）
@zebra/mcp:        contract → MCP tools（Phase 3/4）
```

后续评估（当前未实现）：decorator controller、`operationId`、OpenAPI 和多语言 codegen。等 `.mcp()` 和 dispatch bridge 稳定后，再评估是否需要 decorator 作为 contract 的另一种声明语法。
