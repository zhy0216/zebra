difficulty: hard
agent: inherit

# 02 · 防止同名 session scope 重建后的释放串扰

来源：plan.md F03。优先级：P1。一个独立 worktree，一个最终 commit。

## T1 · 用 scope record 身份配对取得和释放

- 要做什么：让 RequestScopes 持有或关联 createRequestScopes 时取得的具体 SessionScopeRecord；disposeScopes/releaseSession 只能释放此 record。disposeSession(id) 删除旧 record 后同 id 的新 record 不能被旧请求结束动作减计数或安排过期。
- 预计修改文件：`packages/core/src/app/scope-registry.ts`；新增 `packages/core/test/app/session-generation.test.ts`。
- 验收条件：通过受控闩锁复现 A 取得旧 session → 显式销毁 → B 取得同名新 session → A 结束。在 B 仍运行并跨过 idle TTL 时，B 的 session 资源未 dispose；B 真正结束后才按 TTL 释放。多个旧请求、两个新请求也不相互影响；显式销毁保持无条件，匿名 scope 正常清理。
- 前置依赖：无。

## T2 · 验证异常和关闭路径

- 要做什么：覆盖旧请求 dispose 抛错、新 record 已被再次替换、并发 disposeSession/stop 的身份处理，防止改为记录引用后重复安排 timer 或遗漏 pendingDisposals。
- 预计修改文件：同 T1；必要时补 `packages/core/test/di/disposal-errors.test.ts`，不修改其他任务的测试文件。
- 验收条件：每个已实例化资源只 dispose 一次；失败仍释放其余资源；停止后没有本轮 timer 泄漏。测试以实际资源生命周期为主，不只断言私有 activeRequests。
- 前置依赖：本文件 T1；外部依赖无。

## 校验与交付

运行 `bun test packages/core/test/app/session-generation.test.ts packages/core/test/app/session.test.ts packages/core/test/app/cleanup-errors.test.ts packages/core/test/di/disposal-errors.test.ts`、`bun run typecheck`、`bun run lint`、`git diff --check`。保持修改在 scope registry 内，03 会在合并后使用新身份逻辑。新增测试尽量不用装饰器语法，避免扩大 Biome ignore。
