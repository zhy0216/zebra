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

## 完成记录

- 状态：T1、T2 已完成并通过验收；在协调器持有集成锁并授权后归档，待协调器仓库级校验与合并。
- 执行 agent：Codex；model：`gpt-6-astra`；reasoning effort：`max`，沿用用户指定配置。
- 集成基线：`master` / `11bf45306f6a8ae1bb391949ecf946588d791442`。任务分支已 rebase 到该提交，无冲突，无需额外实现修复。
- 实现文件：`packages/client/src/client.ts`、`packages/mcp/src/bridge.ts`；新增 `packages/client/test/path-segments.test.ts`、`packages/mcp/test/bridge-paths.test.ts`。

### 验收证据

- T1：两处插值均按原始路径 segment 处理，只识别完整 `:name` 和终端 `*name`；按 core 现有语法允许 wildcard 后的尾斜线。`/clock:zone`、`/a*b`、`/files/prefix:name` 在无参数或传入同名无关参数时均保持静态路径并命中 handler。
- 普通参数、重复同名 token、空值及非空终端 wildcard、字母/数字/下划线名称、斜线/问号/井号/百分号编码及冒号/星号参数值全部通过。参数值只插入一次；普通参数解码、wildcard 保持编码的 core 行为不变。
- 缺失真实参数在请求发出前保留明确错误。`:user-id`、带后缀的非法 token 和非终端 wildcard 不被部分插值，core 仍拒绝对应非法路由。
- T2：10 组同一契约分别经 `createTestClient` 和 `argumentsToRequest` 调用实际 `dispatch`，逐组断言响应、handler 调用次数、路径与 params；包括静态与参数混合路径。新增 20 个行为测试，修复前 14 fail、修复后全部通过。
- baseUrl 前缀、query/hash、大小写不敏感的 header 合并、signal 透传与取消及原有回归通过。没有新增运行时共享依赖，client 仍为 zero-deps；core 路由语法、公开契约类型、exports、签名及 Bun 最低版本均未改变。

### Rebase 后校验

| 命令 | 结果 |
| --- | --- |
| `bun test packages/client packages/mcp packages/testing` | exit 0；105 pass / 0 fail，412 expect()，9 files；包含 master 已合入的 MCP 日志隔离与工具索引回归 |
| `bun run typecheck` | exit 0 |
| `bun run lint` | exit 0；255 files，No fixes applied |
| `bun run verify:packages` | exit 0；12 个包 tarball、独立安装、imports 与 types 全部通过 |
| `git diff --check` | exit 0 |

依赖已在任务独立 worktree 通过 `bun install --frozen-lockfile` 安装；rebase 前后 `bun.lock` 与根 `package.json` 无变化。本任务无 blocker；仓库级校验与合并由协调器执行，audit / benchmark 未在本任务运行，真实 benchmark baseline 未修改。
