difficulty: hard

# 防止并发启动遗失服务器

优先级：P1

来源：plan.md F06

执行模型：max

前置依赖：[04-disposal.md](04-disposal.md)

## T1 · 协调 listen 与 stop 的生命周期状态

要做什么：修复 app.listen 在 await prepare 前检查 server、恢复后直接 Bun.serve 的竞态。使用启动状态/共享 promise 或明确拒绝策略，保持已文档化重复listen语义；stop 与启动中 boot/ready 的交错必须最终回收所有服务器。基于04的清理机制，不另造冲突状态机。

预计修改文件（本任务共享范围）：

- `packages/core/src/app/app.ts`
- `packages/core/src/app/internals.ts`
- `packages/core/test/app/listen-concurrency.test.ts（新增）`

验收条件：Promise.allSettled 两次 listen({port:0}) 不产生两个独立可服务端口；异步boot只跑一次；stop 与 listen 交错、ready失败均无泄漏；stop之后不存在可返回200的遗留端口；顺序正常listen/stop不回归。测试不用固定端口，始终finally清理。

前置依赖：[04-disposal.md](04-disposal.md)。

## 校验

```sh
bun test packages/core/test/app/listen-concurrency.test.ts packages/core/test/app/listen.test.ts packages/core/test/app/lifecycle.test.ts
bun run typecheck
bun run lint
bun test packages/core
```

按 plan 的公共约束保留 v1 API 与现有正常路径。只改本任务拥有的文件；需要扩大范围时先协调依赖。
