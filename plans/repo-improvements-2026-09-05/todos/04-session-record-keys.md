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
