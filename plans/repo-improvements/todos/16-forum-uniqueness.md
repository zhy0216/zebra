difficulty: hard

# 保证并发注册的用户名唯一性

优先级：P2

来源：plan.md F29

执行模型：max

前置依赖：无

## T1 · 在同步写入点执行最终唯一性约束

要做什么：保留AuthService注册流程，在ForumStore.createUser同步插入时再次保证用户名唯一，解决密码hash await造成的检查/写入间隙。重复返回现有409 username_taken；不引入新数据库、锁服务或修改示例API。

预计修改文件（本任务共享范围）：

- `examples/forum/src/services.ts`
- `examples/forum/test/forum.test.ts`
- `examples/forum/test/registration-concurrency.test.ts（新增）`

验收条件：同名多个并发register恰有一次成功，其余409；最终只有一个账户且可用获胜密码登录；不同用户名可并行成功；已有register/login/logout链路通过。测试避免依赖恰好相同的hash完成时序。

前置依赖：无。

## 校验

```sh
bun test examples/forum
bun x tsgo --noEmit -p examples/forum/tsconfig.json
bun run typecheck
bun run lint
```

按 plan 的公共约束保留 v1 API 与现有正常路径。只改本任务拥有的文件；需要扩大范围时先协调依赖。
