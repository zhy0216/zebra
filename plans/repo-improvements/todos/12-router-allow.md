difficulty: medium

# 补全重叠路由的 Allow 方法

优先级：P2

来源：plan.md F23

执行模型：flash

前置依赖：无

## T1 · 汇总所有匹配路径分支

要做什么：collectMethods/allowedMethods遍历static/param/wildcard所有可匹配分支并去重，不能遇到首个static分支就返回。正常find的优先级和params捕获保持原样。

预计修改文件（本任务共享范围）：

- `packages/core/src/router/radix.ts`
- `packages/core/test/router/radix.test.ts`
- `packages/core/test/app/method.test.ts`

验收条件：GET /users/me + POST /users/:id下/users/me的OPTIONS/405 Allow包含GET与POST和既有HEAD/OPTIONS补全；包含wildcard和空wildcard边界；重复方法不重复；正常路由匹配回归通过。

前置依赖：无。

## 校验

```sh
bun test packages/core/test/router packages/core/test/app/method.test.ts packages/core/test/fuzz/router.test.ts
bun run typecheck
bun run lint
bun test packages/core
```

按 plan 的公共约束保留 v1 API 与现有正常路径。只改本任务拥有的文件；需要扩大范围时先协调依赖。
