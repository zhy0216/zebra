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
