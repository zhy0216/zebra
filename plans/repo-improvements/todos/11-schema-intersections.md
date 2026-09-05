difficulty: hard

# 生成可满足的 Zod intersection JSON Schema

优先级：P1

来源：plan.md F22

执行模型：max

前置依赖：无

## T1 · 让 closed-object 后处理理解 allOf

要做什么：修正allOf中每个对象独立additionalProperties:false导致相互排斥的问题。基于当前Zod转换结果处理交叉对象与嵌套组合；保留普通对象、record、union、optional/default、transform的输入schema行为，避免简单去掉全部约束。实际validator回归放在本任务独占新增的packages/mcp/test/schema-intersection.test.ts，使用MCP已有SDK公开入口@modelcontextprotocol/sdk/validation/ajv及schema-zod开发依赖；禁止修改任何package.json或bun.lock。

预计修改文件（本任务共享范围）：

- `packages/schema-zod/src/index.ts`
- `packages/schema-zod/test/schema.test.ts`
- `packages/mcp/test/schema-intersection.test.ts（新增，由11独占）`

验收条件：z.intersection(z.object({a:z.string()}),z.object({b:z.string()}))的{a,b}同时通过Zod与实际JSON Schema validator；缺字段/错误类型被拒绝；嵌套intersection与ordinary object/record/union不回归。不能仅assert生成JSON形状；不修改10的mcp.test.ts或transport.test.ts，也不修改依赖清单与lock。

前置依赖：无。

## 校验

```sh
bun test packages/schema-zod packages/mcp
bun run typecheck
bun run lint
bun run build
bun run verify:packages
```

按 plan 的公共约束保留 v1 API 与现有正常路径。只改本任务拥有的文件；需要扩大范围时先协调依赖。
