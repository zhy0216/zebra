difficulty: hard

# 消除 session lazy load 与 flush 的丢更新

优先级：P1

来源：plan.md F10、F11

执行模型：max

前置依赖：无

## T1 · 共享首次加载

要做什么：为同一个 RequestSession handle 缓存进行中的 store.get，使并发 get/set/delete 使用同一个data实例。明确加载失败是否可重试，不能把rejection误当空session；保持HTTP与WS共用handle行为。

预计修改文件（本任务共享范围）：

- `packages/session/src/session.ts`
- `packages/session/test/session-concurrency.test.ts（新增）`

验收条件：可控延迟store.get下两个并发set仅加载一次且a/b均保留；混合get/set/delete结果符合调用顺序；错误向调用方传播，现有匿名/过期session语义不变。

前置依赖：无。

## T2 · 按版本提交 dirty 状态

要做什么：用revision/等价机制和必要的flush串行化确保持久化等待中的新变更不会被清dirty，避免两个flush乱序覆盖。覆盖destroy与持久化交错时本地handle行为，不能声称修复R02中的Redis原子持久化问题。

预计修改文件（本任务共享范围）：

- `packages/session/src/session.ts`
- `packages/session/test/session-concurrency.test.ts（新增）`

验收条件：store立即快照a后等待，此时set(b)，第一flush完成后仍需保存b，第二flush落盘含a/b；并发flush不把新快照覆盖成旧值；失败后仍可重试；destroy后handle不再写回旧状态。

前置依赖：无；与本文件前面条目一起完成、一起提交。

## 校验

```sh
bun test packages/session
bun run typecheck
bun run lint
bun test packages/redis packages/core/test/app/session.test.ts packages/core/test/app/ws-session.test.ts
```

按 plan 的公共约束保留 v1 API 与现有正常路径。只改本任务拥有的文件；需要扩大范围时先协调依赖。
