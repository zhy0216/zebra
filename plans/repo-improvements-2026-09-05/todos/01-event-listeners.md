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
