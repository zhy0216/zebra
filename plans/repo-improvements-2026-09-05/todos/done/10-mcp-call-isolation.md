difficulty: medium
agent: inherit

# 10 · 隔离 MCP 日志故障并索引工具名称

来源：plan.md F17、F21。优先级：P2。一个独立 worktree，一个最终 commit。

## T1 · logger 故障不覆盖已经执行的工具结果

- 要做什么：将 opts.logger 的调用隔离在诊断路径，抛错不得令已完成的 callTool 失败或重新执行工具。保持 logger entry 的字段、时机与正常调用次数，保留业务和协议错误的既有传播方式。
- 预计修改文件：`packages/mcp/src/adapter.ts`、`packages/mcp/test/mcp.test.ts`；需要时在 `packages/mcp/test/transport.test.ts` 增加 SDK 调用回归。
- 验收条件：有副作用 tool 在 logger 抛错时仍返回原来的成功结果且 mutation=1；原 isError tool 仍保留错误结果；logger 不运行、正常运行和抛错的结果一致。防止异常诊断再次覆盖业务结果。若回调在运行时返回 rejecting Promise，也需消费拒绝而不延迟或重试业务调用，不更改公开 logger 返回类型。
- 前置依赖：无。

## T2 · 创建时构建名称索引

- 要做什么：以已经通过 collectTools 唯一性校验的 manifests 建立名称 Map，callTool 使用 Map.get；tools/list 的数组顺序和公开 tools 属性不受影响。
- 预计修改文件：同 T1。
- 验收条件：嵌套 contract 的第一个/中间/最后工具均执行正确；未知名字仍产生原 MethodNotFound；重复命名仍在创建时失败；list 顺序与声明顺序一致。代码审查确认每次调用不再线性扫描所有 manifests，无需添加脆弱的耗时单元测试。
- 前置依赖：无。

## 校验与交付

运行 `bun test packages/mcp/test/mcp.test.ts packages/mcp/test/transport.test.ts`、`bun run typecheck`、`bun run lint`、`git diff --check`。不改 bridge.ts 或 bridge-paths.test.ts（09 所有），不改变工具认证、取消或结果序列化。

## 完成记录

- 状态：已完成，任务验收通过；待协调器执行仓库级校验与合并。
- 完成日期：2026-09-05。
- 执行 agent / model / effort：`codex` / `gpt-6-astra` / `xhigh`，由任务 agent 亲自实现和复核。
- 集成基线：在任务 worktree rebase 到 `master` 的 `4e13741522501726bb8eb6ad2e23c5b262f7651c`，无冲突；`git range-diff` 确认业务补丁与 rebase 前一致。
- 业务修改文件：`packages/mcp/src/adapter.ts`、`packages/mcp/test/mcp.test.ts`、`packages/mcp/test/transport.test.ts`。

### 验收证据

- T1：无 logger、正常 logger、同步抛错和运行时 Promise 拒绝均返回相同成功结果与原 `isError` 结果，副作用 `mutations=1`。SDK transport 调用同样验证单次副作用及成功结果。
- T1：日志仍在响应读取完成后调用，entry 字段及调用次数保持；公开 logger 返回类型仍为 `void`。挂起的日志 Promise 不延迟工具结果，稍后的拒绝被消费；异常路径不进行二次诊断或重试业务调用。
- T1：header mapper、dispatch 和响应读取失败保持原错误对象，失败时不调用 logger；未知工具仍抛出原 `McpError` / `MethodNotFound`。
- T2：`collectTools` 唯一性校验通过后建立名称 Map，`callTool` 使用 `Map.get`，不再线性扫描 manifests。嵌套及带 prefix 的 contract 首个、中间、末尾工具均按名称正确执行；重复名称仍在创建时失败。
- T2：`tools/list` 与公开 `tools` 保持声明顺序；修改返回列表数组不影响后续列表或公开数组。验证依赖行为断言和代码审查，没有添加耗时阈值测试。
- 既有认证、取消、输入验证及结果序列化回归通过；未改 `bridge.ts`、`bridge-paths.test.ts`、依赖、API 签名或 benchmark baseline。

### Rebase 后校验

| 命令 | 结果 |
| --- | --- |
| `bun install --frozen-lockfile` | exit 0；当前 worktree 独立 node_modules，无依赖变更 |
| `bun test packages/mcp/test/mcp.test.ts packages/mcp/test/transport.test.ts` | exit 0；34 pass / 0 fail，163 expect() |
| `bun run typecheck` | exit 0 |
| `bun run lint` | exit 0；253 files，No fixes applied |
| `git diff --check` | exit 0 |
| `git diff --check master..HEAD` | exit 0 |

无任务 blocker。benchmark / audit 未在本任务运行，留待协调器完成最终集成验证；已通知协调器预约无竞争 benchmark 测量，不将未运行的验证记为通过。
