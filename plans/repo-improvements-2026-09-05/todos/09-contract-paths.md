difficulty: hard
agent: inherit

# 09 · 让 client 与 MCP 的路径插值符合路由语法

来源：plan.md F16。优先级：P1。一个独立 worktree，一个最终 commit。

## T1 · 只替换完整参数 segment

- 要做什么：修复 client 和 MCP bridge 的 substitutePath，按 segment 识别 :name 与终端 *name，不在静态片段内搜索占位符。保留单次插值，参数值中的冒号或星号不会成为新占位符。
- 预计修改文件：`packages/client/src/client.ts`、`packages/mcp/src/bridge.ts`；新增 `packages/client/test/path-segments.test.ts`、`packages/mcp/test/bridge-paths.test.ts`。
- 验收条件：/clock:zone、/a*b、/files/prefix:name 均原样到达 core 注册路由；正常 /users/:id、重复同名 token、终端 wildcard、编码的斜线/问号/井号及冒号星号值仍正确；缺失真实参数仍给明确错误。参数名字仍限制为现有 [A-Za-z0-9_]+，不把非法 :user-id 纳入本轮支持。baseUrl 前缀、query/hash、header 合并和 signal 透传旧回归全部通过。
- 前置依赖：无。

## T2 · 验证跨入口实际调用一致

- 要做什么：用同一契约分别经 createTestClient/dispatch 与 MCP argumentsToRequest/dispatch 调用静态及参数混合路径，确认命中 handler 和 params 一致；不新增运行时共享包依赖。
- 预计修改文件：本任务新增的两个测试文件；可以只读 core/src/router/path.ts 对照语法。不编辑 mcp.test.ts / transport.test.ts（10 所有）。
- 验收条件：真实 handler 收到预期路径和参数，静态占位符误匹配的旧探针不再抛错；client 的 zero-deps 发布约定不变。不能仅对两个 substitutePath helper 互相比较而缺失服务器判定。
- 前置依赖：本文件 T1；外部依赖无。

## 校验与交付

运行 `bun test packages/client packages/mcp packages/testing`、`bun run typecheck`、`bun run lint`、`bun run verify:packages`、`git diff --check`。不修改 core 路由语法或公开契约类型。
