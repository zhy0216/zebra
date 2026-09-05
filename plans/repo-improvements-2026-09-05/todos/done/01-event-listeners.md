difficulty: hard
agent: inherit

# 01 · 修复事件监听器的回收和快照语义

来源：plan.md F01、F02。优先级：P1。一个独立 worktree，一个最终 commit。

## T1 · 消费 once 时移除实际注册

- 要做什么：修复 EventBus.emit/add/off，使 once 在回调执行前从注册表删除，listenerCount/hasAnyOf 随之更新；允许同一函数之后再次 on/once。用 entry 身份避免删除回调中产生的新注册，处理 throwing、递归和并发 emit。
- 预计修改文件：`packages/core/src/events.ts`、`packages/core/test/events.test.ts`。
- 验收条件：once 执行后 count=0、hasAnyOf=false；原回调重新 once 后累计调用两次；同步抛错/异步拒绝仍只消费一次；两个交错 emit 和递归 emit 对同一 once entry 最多调用一次；没有已消费 entry 常驻 bucket。
- 前置依赖：无。

## T2 · 保留正在执行的普通 listener 快照

- 要做什么：区分取消未来注册与 once 已消费；当前 first 回调 off(second) 时 second 仍在本次快照中执行，下次才消失。removeAllListeners 和新增 listener 的本次/下次语义一致，直接 emit 仍顺序 await，遇错停止后续回调。
- 预计修改文件：同 T1；已有 `docs/06-lifecycle.md` 已陈述目标语义，无需修改其承诺。
- 验收条件：覆盖 off(other)、removeAllListeners(event/all)、新增 listener、异步暂停中移除、同函数重新注册；既有 dedup、EventEmitter alias、异常传播测试不变。
- 前置依赖：本文件 T1；外部依赖无。

## 校验与交付

运行 `bun test packages/core/test/events.test.ts packages/core/test/app/events.test.ts`、`bun run typecheck`、`bun run lint`、`git diff --check`。不得修改 internals.ts（03 所有）。报告关键交错场景和 commit；队列归档在协调器集成阶段统一处理。

## 完成记录

- 状态：已完成 T1、T2 全部验收；2026-09-05 在协调器持有集成锁期间归档，待协调器仓库级校验与合并。
- 执行 agent：codex；model：gpt-6-astra；effort：max。
- 集成基线：`03567fde4bececa3837ed2b746d7808c38951371`。任务分支已 rebase 到该提交，无冲突，事件实现和测试与协调器复核版本一致。
- 实现：用独立的 consumed 标记记录 once 消费；off 只取消未来注册。once 在调用回调前按 entry 身份从当前注册表移除，并删除空 bucket。
- 回归测试：新增 17 个用例；旧实现上复现 13 个失败，修复后全部通过。
- T1 回收与重注册：回调执行前及执行后 listenerCount=0、hasAnyOf=false；同函数再次 once 后累计调用两次，之后可正常 on；回调内重新 on/once 的注册保留给后续 emit。
- T1 异常：同步抛错、异步拒绝都只消费一次，保留原错误并停止本次后续回调；下一次 emit 正常执行其余 listener。
- T1 交错与递归：第一个 emit 暂停时，第二个 emit 消费共享 once entry 并暂停于回调；恢复第一个 emit 后跳过已消费 entry，两个 emit 合计调用一次。普通回调和 once 回调中的递归 emit 同样只消费一次，并保持其余 listener 顺序。
- T2 快照：覆盖 off(other)、removeAllListeners(event/all)、异步暂停期间移除和新增 listener；旧快照保留本次调用资格，新增注册从下一次 emit 生效。
- T2 注册身份：覆盖 on/once 四种替换组合，旧快照不会误删同函数的新注册；既有顺序 await、dedup、EventEmitter alias 和异常传播测试保持通过。
- 范围：保持 v1 exports、签名及 Bun 最低版本；未修改 internals.ts、app/events.test.ts、依赖、plan.md 或其他任务状态。

rebase 后重新运行的校验：

| 命令 | 结果 |
| --- | --- |
| `bun test packages/core/test/events.test.ts packages/core/test/app/events.test.ts` | exit 0；49 pass / 0 fail，151 expect()，2 files |
| `bun run typecheck` | exit 0 |
| `bun run lint` | exit 0；249 files，No fixes applied |
| `git diff --check` | exit 0 |

无剩余 blocker。audit、仓库级校验和无竞争窗口的 benchmark 留待协调器安排；本任务未修改真实 benchmark baseline。
