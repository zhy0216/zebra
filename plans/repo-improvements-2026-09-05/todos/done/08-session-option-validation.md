difficulty: medium
agent: inherit

# 08 · 防止无效 session TTL 和 cookie 时间值

来源：plan.md F14、F15。优先级：P2。一个独立 worktree，一个最终 commit。

## T1 · session store 提前拒绝非有限 TTL

- 要做什么：在 MemoryStore / RedisSessionStore 构造及 touch 的 ttl override 入口拒绝 NaN、Infinity、-Infinity；错误 touch 不读取或写入后端，也不改变现有记录。保留现有有限输入的行为，特别是 touch(id,0) 与负数代表立即过期的效果。
- 预计修改文件：`packages/session/src/store.ts`、`packages/redis/src/session-store.ts`、`packages/session/test/store.test.ts`、`packages/redis/test/session-store.test.ts`。
- 验收条件：每个非法 ctor/override 都以 TypeError 失败且带字段说明；假 Redis 的命令记录保持不变；原记录未被非法 touch 续期/删除。合法默认 TTL、有限 override、零/负值立即过期与 tombstone 现有行为保持；get/set 数据合同不变。
- 前置依赖：无。

## T2 · 输出合法且可解析的 Max-Age / Expires

- 要做什么：serializeCookie 拒绝非有限 maxAge；有限正小数向下取整成秒，有限负数按现有行为归零。先规范化再计算 Expires，不能输出 Invalid Date；对于超出 Date 可表示范围的正值，明确抛 TypeError，不能返回无效日期。
- 预计修改文件：`packages/session/src/cookie.ts`、`packages/session/test/cookie.test.ts`；更新 `docs/07-sessions.md`、`docs/zh/07-sessions.md` 中时间值约束。
- 验收条件：NaN/Infinity/-Infinity 失败；maxAge=1.5 输出 Max-Age=1 且合法 Expires；0、负数和 0<maxAge<1 输出归零删除语义；现有整数、secure/httpOnly/sameSite/path/domain 不变，异常不会拼出错误 Set-Cookie。提供规范化后的边界回归。
- 前置依赖：无。

## 校验与交付

运行 `bun test packages/session/test/store.test.ts packages/session/test/cookie.test.ts packages/session/test/integration.test.ts packages/redis/test/session-store.test.ts packages/redis/test/integration.test.ts`、`bun run typecheck`、`bun run lint`、`DOCS_BASE=/zebra/ bun run docs:build`、`git diff --check`。不改 session.ts（04 所有）、Redis key 布局、原子能力或 RedisLike 签名；R02 未完成应如实保留。

## 完成记录（2026-09-05）

- 状态：本任务验收通过，已在协调器持有集成锁期间归档；等待协调器仓库级校验与合并。
- 执行 agent：codex；model：gpt-6-astra；reasoning effort：xhigh。由任务 agent 亲自实现、验证及归档。
- 串行集成基线：`master` / `f26aa5867de34752e3c531e095bbe05626d359f4`。执行 rebase 返回 up to date，无冲突，无需修改实现。
- T1：两种 store 的构造 TTL 与 touch override 均拒绝 NaN、Infinity、-Infinity，错误类型为带 `ttl` 字段说明的 TypeError。测试覆盖存活、过期、销毁及缺失记录；非法 touch 不读取记录、不触发清扫、不新增 Redis 命令，数据与到期时间不变。默认 TTL、有限小数 override、零/负值立即过期、tombstone 及 get/set 合同回归通过。
- T2：非有限 maxAge 和日期越界值以带 `maxAge` 说明的 TypeError 失败；1.5 归整为 1 后计算合法 Expires，零、负数及不足一秒归零删除。回归覆盖 Date 上界归整及越界、异常时不追加错误 Set-Cookie，以及既有整数和其他 cookie 属性。双语时间值约束已更新。

rebase 后重新运行的验收：

| 命令 | 结果 |
| --- | --- |
| `bun test packages/session/test/store.test.ts packages/session/test/cookie.test.ts packages/session/test/integration.test.ts packages/redis/test/session-store.test.ts packages/redis/test/integration.test.ts` | exit 0；109 pass / 0 fail，377 expect() |
| `bun run typecheck` | exit 0 |
| `bun run lint` | exit 0；252 files，No fixes applied |
| `DOCS_BASE=/zebra/ bun run docs:build` | exit 0；VitePress 1.6.4 |
| `git diff --check` | exit 0 |

R02 仍未完成：Redis 验证使用 FakeRedis，未验证真实 Redis 并发原子性；本任务未改变 Redis key 布局、原子能力或 RedisLike 签名。R01–R04 未执行，audit 与 benchmark 留待协调器集成校验。实现、双语文档及本归档合并为同一个 Conventional Commit。
