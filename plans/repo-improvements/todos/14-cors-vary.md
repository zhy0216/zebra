difficulty: medium

# 为 CORS 缓存变体提供完整 Vary

优先级：P2

来源：plan.md F25

执行模型：flash

前置依赖：无

## T1 · 覆盖拒绝/缺失Origin与动态预检请求头

要做什么：只要策略会因Origin改变响应，allowed/denied/absent变体都应Vary: Origin；反射Access-Control-Request-Headers时补对应Vary。合并字段大小写不敏感、去重并保留既有Vary:*语义。更新现有denied Vary=null的缺陷断言；仍不为denied响应添加Access-Control-Allow-Origin。

预计修改文件（本任务共享范围）：

- `packages/cors/src/cors.ts`
- `packages/cors/test/integration.test.ts`
- `packages/cors/test/preflight.test.ts`

验收条件：精确/动态origin策略下allowed、denied和absent请求的缓存选择正确；动态预检请求头变体不会共用错误响应；已有Vary保留且无重复；通配符无凭据策略不产生无意义变化；全部CORS集成测试通过。

前置依赖：无。

## 校验

```sh
bun test packages/cors
bun run typecheck
bun run lint
bun test examples/forum
```

按 plan 的公共约束保留 v1 API 与现有正常路径。只改本任务拥有的文件；需要扩大范围时先协调依赖。
