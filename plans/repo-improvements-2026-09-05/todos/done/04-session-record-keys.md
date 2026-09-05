difficulty: medium
agent: inherit

# 04 · 将 session 键作为安全的自有数据属性

来源：plan.md F07。优先级：P1。一个独立 worktree，一个最终 commit。

## T1 · 修复继承属性和 __proto__ 写入

- 要做什么：调整 createSession 的内部 record、cloneRecord 以及 get/has/set/delete。没有写入的 constructor/toString 等继承属性应不存在；显式写入这些名字以及 __proto__ 时应存为可枚举的普通键。data() 和写入 store 的浅拷贝保持既有公共返回语义。
- 预计修改文件：`packages/session/src/session.ts`；新增 `packages/session/test/session-record-keys.test.ts`。
- 验收条件：空 session.has(toString)=false，get(constructor)=undefined；写入 __proto__={admin:true} 后 get(admin)=undefined，但 own __proto__ 数据能 get/data/flush/重新打开 round-trip；对 initial、store.get、delete、constructor、toString、hasOwnProperty 都有行为回归；未改变全局或普通对象原型。输出可 JSON 序列化，支持自有 undefined 值的 has/delete。
- 前置依赖：无。

## T2 · 保持已有持久化和浅拷贝合同

- 要做什么：让安全 record 策略融入共享 lazy load、revision 和 flush/destroy 队列，不改 store 接口，也不深拷贝嵌套业务值。
- 预计修改文件：同 T1；只运行而不修改 08 所有的 store/cookie 测试。
- 验收条件：并发首次 load 仍共享一次 get；写入期间新 revision 不丢失；destroy 后不再持久化；data() 顶层修改不改变 handle。全部原有 session 并发回归通过。
- 前置依赖：本文件 T1；外部依赖无。

## 校验与交付

运行 `bun test packages/session`、`bun run typecheck`、`bun run lint`、`git diff --check`。不修改 session/store.ts、cookie.ts、middleware.ts 或 Redis 数据布局。

## 完成记录

- 状态：已完成 T1、T2 全部验收；2026-09-05 在协调器持有集成锁期间归档，待协调器仓库级校验与合并。
- 执行 agent：codex；model：gpt-6-astra；effort：xhigh。
- 集成基线：`6221284a7ee221c3be6b38b2f7e54a67ab831d99`。当前任务分支已 rebase 到该提交，无冲突，无需修改实现。
- 实现：内部 record 使用无原型字典，`has` 仅检查自有属性；`data()` 和写入 store 的快照保持普通对象浅拷贝。
- 回归测试：新增 `packages/session/test/session-record-keys.test.ts`，14 个用例；修复前复现 11 个失败，修复后全部通过。
- T1：空记录不暴露继承属性；`__proto__`、`constructor`、`toString`、`hasOwnProperty` 均可作为可枚举普通键写入、读取、删除和持久化。`__proto__={admin:true}` 不令 `admin` 成为 session 键，经 data、flush、JSON 序列化和重新打开仍保留自有数据；全局与普通对象原型不变。
- T1 数据入口：覆盖缺失记录、initial、store.get、自有 undefined 值的 has/delete；仅复制自有可枚举属性。
- T2：data 和 store 快照的顶层修改不影响 handle，嵌套业务值保留引用；原有 24 个 session 并发回归全部通过，覆盖首次 load 共享一次 get、写入期间新 revision 保留、flush 排队以及 destroy 后禁止持久化。
- 范围：保持 v1 exports、签名、store 接口、Bun 最低版本和 Redis 数据布局；store/cookie/middleware 源码及已有测试均未修改。

rebase 后重新运行的校验：

| 命令 | 结果 |
| --- | --- |
| `bun install --frozen-lockfile` | exit 0；独立 worktree 依赖，无变更 |
| `bun test packages/session` | exit 0；116 pass / 0 fail，4091 expect()，10 files |
| `bun run typecheck` | exit 0 |
| `bun run lint` | exit 0；249 files，No fixes applied |
| `git diff --check` | exit 0 |
| `git diff master..HEAD --check` | exit 0 |

无剩余 blocker。嵌套值按既有浅拷贝合同共享引用；audit 和 benchmark 留待协调器安排仓库级校验，本任务未修改真实 benchmark baseline。
