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

## 完成记录

- 状态：已完成本任务全部验收；2026-09-05 在协调器持有集成锁期间归档，待协调器仓库级校验与合并。
- 执行 agent：codex；model：gpt-6-astra；effort：xhigh。
- 集成基线：`13eddf766ba68a30f1c87449a1d52911773cbb9c`。执行 rebase 后提示当前分支已是最新，无冲突。
- 实现：`runStandardValidate` 直接 await 验证结果；保留 vendored 接口、公开类型和 schema 类型推断。
- 回归测试：新增 `packages/core/test/contract/async-validation.test.ts`，29 个用例全部走真实 implement/dispatch。
- 输入失败：node:vm Promise 的 params/query/body issues 均返回 422，handler 调用次数为 0；params/query 聚合及路径前缀保持现状。修复前这三个输入用例均复现实际返回 200。
- 成功转换：params/query/body 的转换值进入 handler，body 重复读取保持一致且只验证一次；output 使用验证后的裁剪值。
- 输出失败：返回现有 500 `output_validation_failed`，仅在 exposeStack 开启时携带 issues 详情。
- 拒绝：当前 realm 与跨 realm Promise 在 params/query/body/output 四个阶段拒绝时均返回现有 500 internal Problem+Json，测试无未处理拒绝报告。
- 兼容性：同步 schema、当前 realm Promise、既有 Zod 正常值、output stripping 和类型推断测试通过。

rebase 后重新运行的校验：

| 命令 | 结果 |
| --- | --- |
| `bun test packages/core/test/contract packages/contract/test/parity.test.ts packages/mcp/test/schema-intersection.test.ts` | exit 0；84 pass / 0 fail，326 expect()，8 files |
| `bun run typecheck` | exit 0 |
| `bun run lint` | exit 0；248 files，No fixes applied |
| `git diff --check` | exit 0 |

无剩余 blocker。audit 和 benchmark 留待协调器安排仓库级校验；本任务未修改真实 benchmark baseline。
