difficulty: medium
agent: inherit

# 05 · 正确等待跨 realm 的 Standard Schema 结果

来源：plan.md F08。优先级：P1。一个独立 worktree，一个最终 commit。

## T1 · 移除 Promise instanceof 对验证结果的假设

- 要做什么：修复 runStandardValidate，通过语言标准的 await/Promise assimilation 获得实际结果；不因异步结果来自 node:vm 而把 issues 当作缺失并放行。只改结果等待，不重写 vendored 接口或改变 schema 类型推断。
- 预计修改文件：`packages/core/src/contract/implement.ts`；新增 `packages/core/test/contract/async-validation.test.ts`。
- 验收条件：node:vm 的 Promise.resolve({issues:[...]}) 对 params/query/body 产生 422，handler 不运行；跨 realm success 的转换值真正进入 handler；output issues 产生现有 500 output_validation_failed；拒绝得到原有错误响应而非未处理拒绝。同步 schema、当前 realm Promise、Zod 正常值、output stripping 均保持现状。
- 前置依赖：无。

## 校验与交付

运行 `bun test packages/core/test/contract packages/contract/test/parity.test.ts packages/mcp/test/schema-intersection.test.ts`、`bun run typecheck`、`bun run lint`、`git diff --check`。测试应走真实 implement/dispatch，不只测 helper 返回值；如增加 thenable 探针，只作为运行时兼容测试，不收紧或扩大公开类型。
