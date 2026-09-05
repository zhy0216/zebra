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
