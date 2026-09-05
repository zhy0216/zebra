difficulty: hard
agent: inherit

# 03 · 统一请求完成阶段的错误、截止时间和 HEAD 响应

来源：plan.md F04、F05、F06。优先级：P1。一个独立 worktree，一个最终 commit。

依赖 01-event-listeners.md。
依赖 02-session-scope-identity.md。

## T1 · after.request 纳入错误和超时边界

- 要做什么：调整 AppInternals.dispatch，使 after.request 的同步抛错、异步拒绝和挂起均经过既有 Problem+Json / 同一请求 deadline。after.request 自身失败不能重新递归 emit 自己。保留普通失败 request.error → after.request 顺序、原始错误优先级、无 listener 快速路径和 exactly-once scope 清理。
- 预计修改文件：`packages/core/src/app/internals.ts`、`packages/core/test/app/events.test.ts`、`packages/core/test/app/timeout.test.ts`；新增 `packages/core/test/app/response-completion.test.ts`。
- 验收条件：GET 成功但 after.request 抛错时 dispatch 返回 500 Problem+Json，不 reject；timeout=有限值时挂起 after.request 返回 504，signal aborted；hook 晚完成/晚失败不产生重复响应、重复错误事件或未处理拒绝；原始 4xx/5xx、session 的待发 Set-Cookie、资源清理异常有回归。测试记录事件顺序与次数，finally 释放所有闩锁。
- 前置依赖：01-event-listeners.md、02-session-scope-identity.md。

## T2 · 所有 HEAD 出口去正文并释放被丢弃的流

- 要做什么：将 HEAD 去正文从仅 GET fallback 改为所有最终响应；保留显式 HEAD 优先级、响应状态/statusText/headers。对丢弃的 res.body 触发安全 cancel，不能消费整个流或 await 永久挂起的取消。
- 预计修改文件：`packages/core/src/app/internals.ts`、`packages/core/test/app/method.test.ts`、本任务新增的 response-completion.test.ts。
- 验收条件：显式 HEAD、fallback、404、405、middleware 直接响应、handler/hook 错误和 timeout 最终 body 都为 null；Allow、Content-Type、ETag、Content-Length 与 Set-Cookie 保留适用值。底层 cancel 正好触发一次；cancel reject 或永不完成时 HEAD 仍及时返回，无 unhandled rejection。普通 GET 的流继续可读且不会被提前取消。
- 前置依赖：本文件 T1，以及 01、02。

## 校验与交付

运行 `bun test packages/core/test/app packages/session/test/integration.test.ts packages/session/test/session-concurrency.test.ts`、`bun run typecheck`、`bun run lint`、`git diff --check`。完成后在空闲条件运行 `bun run bench:check`，保留原 baseline。不改 app.ts、events.ts、scope-registry.ts 和观测指标计数语义（R04）。需要基础任务改动时先协调，不能重复实现另一份修复。
