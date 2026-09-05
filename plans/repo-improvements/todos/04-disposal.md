difficulty: hard

# 清理失败时释放全部资源

优先级：P1

来源：plan.md F05

执行模型：max

前置依赖：无

## T1 · 容器清理的异常隔离和幂等

要做什么：Container.dispose 按现有逆序尝试全部 disposable；失败不能跳过其余资源，也不能留下已清理实例导致下次重复调用。协调重复/并发 dispose，确保同一资源最多清理一次；仍向调用方报告错误，不能吞掉失败。

预计修改文件（本任务共享范围）：

- `packages/core/src/di/container.ts`
- `packages/core/src/app/scope-registry.ts`
- `packages/core/src/app/internals.ts`
- `packages/core/test/di/disposal-errors.test.ts（新增）`
- `packages/core/test/app/cleanup-errors.test.ts（新增）`

验收条件：A/B/C 中 B 同步抛错或异步 reject 时其余资源仍被尝试；多失败均可诊断；缓存状态正确；重复和并发 dispose 不重复执行已尝试资源。

前置依赖：无。

## T2 · session 和 stop 的完整收尾

要做什么：SessionScopeRegistry.disposeAll 和 AppInternals.performStop 在某一 session/root cleanup 失败后继续剩余阶段，确保 timer、session、server、root container 和 shutdown 收尾按兼容顺序完成；最后报告错误。保留请求 scope 失败不会掩盖主错误的现有行为。

预计修改文件（本任务共享范围）：

- `packages/core/src/di/container.ts`
- `packages/core/src/app/scope-registry.ts`
- `packages/core/src/app/internals.ts`
- `packages/core/test/di/disposal-errors.test.ts（新增）`
- `packages/core/test/app/cleanup-errors.test.ts（新增）`

验收条件：多个 session 之一失败仍释放其他 session；shutdown 会执行；stop 后没有遗留 server/timer；重复 stop 幂等。测试用可控屏障，所有创建的真实server在finally关闭。

前置依赖：无；与本文件前面条目一起完成、一起提交。

## 校验

```sh
bun test packages/core/test/di packages/core/test/app/cleanup-errors.test.ts packages/core/test/app/lifecycle.test.ts packages/core/test/app/session.test.ts
bun run typecheck
bun run lint
bun test packages/core
```

按 plan 的公共约束保留 v1 API 与现有正常路径。只改本任务拥有的文件；需要扩大范围时先协调依赖。
