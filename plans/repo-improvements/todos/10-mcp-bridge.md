difficulty: hard

# 保持 MCP 工具声明与真实调用一致

优先级：P1

来源：plan.md F17、F18、F19、F20、F21

执行模型：max

前置依赖：无

## T1 · bridge headers 和路径插值

要做什么：在MCP包内使用Headers进行大小写无关合并与content-type判断；路径只解析原始模板一次。不要新增client运行时依赖。

预计修改文件（本任务共享范围）：

- `packages/mcp/src/bridge.ts`
- `packages/mcp/src/manifest.ts`
- `packages/mcp/src/adapter.ts`
- `packages/mcp/test/mcp.test.ts`
- `packages/mcp/test/transport.test.ts（新增）`

验收条件：header旧/新大小写覆盖准确且认证middleware看到单一值；id=*foo、wildcard、query与body正确经过dispatch。

前置依赖：无。

## T2 · 校验工具名和 namespace 必填声明

要做什么：收集manifest时拒绝全局重复工具名，包含冲突路径。修正只检查schema.required来推断body/query namespace可省略的逻辑；仅用内部JSON Schema形态分析覆盖本次scalar/array/anyOf/allOf/object，不修改SchemaAdapter、Contract、McpServerOptions等公共签名，不调用schema.validate推断必填性（可能异步或有副作用）。保留合法全可选query，不承诺穷尽任意自定义schema的全部省略语义。

预计修改文件（本任务共享范围）：

- `packages/mcp/src/bridge.ts`
- `packages/mcp/src/manifest.ts`
- `packages/mcp/src/adapter.ts`
- `packages/mcp/test/mcp.test.ts`
- `packages/mcp/test/transport.test.ts（新增）`

验收条件：同层/嵌套/prefix后重名均创建失败且可诊断；不同名字正常；string/array等必填body明确required；tools/list和callTool对允许省略输入的判断一致；422与Problem+Json转换不回归。

前置依赖：无；与本文件前面条目一起完成、一起提交。

## T3 · 转发真实 SDK cancellation

要做什么：setRequestHandler的extra.signal传给内部callTool和请求。用SDK InMemoryTransport创建客户端/服务端，发送tools/call后再取消，不能仅测试直接callTool的signal。

预计修改文件（本任务共享范围）：

- `packages/mcp/src/bridge.ts`
- `packages/mcp/src/manifest.ts`
- `packages/mcp/src/adapter.ts`
- `packages/mcp/test/mcp.test.ts`
- `packages/mcp/test/transport.test.ts（新增）`

验收条件：handler已开始后收到notifications/cancelled可观察req.signal.aborted；直接callTool信号测试继续通过；测试transport在finally关闭。

前置依赖：无；与本文件前面条目一起完成、一起提交。

## 校验

```sh
bun test packages/mcp
bun run typecheck
bun run lint
bun run build
bun run verify:packages
```

按 plan 的公共约束保留 v1 API 与现有正常路径。只改本任务拥有的文件；需要扩大范围时先协调依赖。
