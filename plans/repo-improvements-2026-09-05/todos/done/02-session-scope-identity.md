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

## 完成记录

- 状态：已完成，全部指定验收通过；在协调器持有集成锁并授权后归档，等待协调器仓库级校验与合并。
- 执行 agent：`codex`；model：`gpt-6-astra`；effort：`max`。本任务由执行 agent 亲自实现与复核。
- 集成基线：已 rebase 到 `master` 提交 `534a48fdcf2f54fe95bf2c1eecd2039de7d4fae4`，无冲突；`git range-diff` 确认实现补丁保持一致。
- 修改范围：`packages/core/src/app/scope-registry.ts` 和新增 `packages/core/test/app/session-generation.test.ts`；集成门禁阶段经协调器临时授权，另补修 `packages/core/test/ws.test.ts` 的测试辅助清理（见下文）。归档和本任务 README 状态一并纳入同一个任务提交。

### 验收证据

- T1：RequestScopes 保存取得时的 SessionScopeRecord，释放和过期回调核对 record 身份。闩锁用例覆盖 1 个旧请求／1 个新请求、3 个旧请求／2 个新请求；新资源在请求运行中跨过 idle TTL 仍存活，最后一个新请求结束后才按 TTL 释放。修复前这两个用例均复现提前销毁，修复后通过。
- T1：显式 disposeSession 在旧请求仍运行时立即销毁旧资源；匿名 scope 保持请求隔离并随请求清理，正常和失败路径均通过。
- T2：覆盖旧请求异步清理抛错期间同名 session 连续替换、当前请求同步／异步清理失败、旧过期回调重新到达；均未误释放新 record，当前 record 在请求失败后仍按 idle TTL 释放。
- T2：并发 disposeSession／stop 覆盖两个已被替换且仍在清理的 record。stop 等待两者完成并报告错误，失败后其余 session 和根资源仍释放；已实例化资源各 dispose 一次，停机取消全部本轮 idle timer，旧请求结束不新增 timer。
- 新增 9 个生命周期用例，以真实资源和受控闩锁验证；未使用装饰器语法，闩锁和 timer spy 均在 finally 清理。

### Rebase 后校验

| 命令 | 结果 |
| --- | --- |
| `bun install --frozen-lockfile` | exit 0；当前 worktree 独立 node_modules，依赖无需变更 |
| `bun test packages/core/test/app/session-generation.test.ts packages/core/test/app/session.test.ts packages/core/test/app/cleanup-errors.test.ts packages/core/test/di/disposal-errors.test.ts` | exit 0；27 pass / 0 fail，167 expect()，4 files |
| `bun run typecheck` | exit 0 |
| `bun run lint` | exit 0；250 files，No fixes applied |
| `git diff --check` | exit 0 |

无本任务 blocker。audit、benchmark 未在本任务阶段运行，等待协调器的仓库级校验与空闲测量安排；不修改真实 benchmark baseline。

### 集成门禁补修：既有 WebSocket 测试 timer 泄漏

- 协调器仓库级 gate 曾得到 989 pass / 1 fail：`packages/core/test/ws.test.ts:26` 的遗留未处理拒绝在 session-generation 用例期间触发。close cleanup 用例丢弃了 connectAndWait 返回的 closed Promise，覆盖其 onclose/onerror 并另建等待 Promise，导致原 Promise 在 3000ms 后拒绝。本地使用协调器提供的临时延迟探针同样复现 4 pass / 1 fail，确认故障来自该测试辅助逻辑。
- 授权范围：协调器继续持有任务 02 集成锁，并将 `packages/core/test/ws.test.ts` 的测试辅助清理所有权临时授予本任务，作为必要门禁修复。集成基线仍为 `534a48fdcf2f54fe95bf2c1eecd2039de7d4fae4`；未改 WebSocket 运行时代码、session 实现或 session-generation 测试，未再改 README 或其他任务状态。
- 最小修复：三个 WebSocket 用例统一等待 helper 原有的 closed Promise，不再覆盖关闭处理器或重复创建等待 Promise。helper 在 Promise.finally 中清除 timer 并关闭 socket，失败时也会执行；四个用例均在 finally 中 await app.stop() 完成服务器清理。`ws.test.ts` 增量为 15 行新增、23 行删除。
- 验证沿用 `/tmp/zebra-0905-run/ws-leak-probe.test.ts`：导入本 worktree 的原测试后额外等待 3200ms。该临时探针未加入仓库，未增加永久 3 秒计时测试。

| 命令 | 修复后结果 |
| --- | --- |
| `bun test /tmp/zebra-0905-run/ws-leak-probe.test.ts` | exit 0；5 pass / 0 fail，11 expect()；额外等待 3200ms 后未出现跨测试未处理拒绝（修复前同命令 exit 1，4 pass / 1 fail） |
| `bun test packages/core/test/app/session-generation.test.ts packages/core/test/app/session.test.ts packages/core/test/app/cleanup-errors.test.ts packages/core/test/di/disposal-errors.test.ts packages/core/test/ws.test.ts` | exit 0；31 pass / 0 fail，178 expect()，5 files |
| `bun run test` | exit 0；990 pass / 0 fail，17,936 expect()，110 files，25.14s；修复后首次完整运行通过 |
| `bun run typecheck` | exit 0 |
| `bun run lint` | exit 0；250 files，No fixes applied |
| `git diff --check` | exit 0 |

本次补修与验收记录 amend 至原唯一任务提交，等待协调器复核及合并。
