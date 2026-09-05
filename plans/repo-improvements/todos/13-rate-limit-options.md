difficulty: medium

# 拒绝非有限限流配置

优先级：P2

来源：plan.md F24

执行模型：flash

前置依赖：[08-memory-stores.md](08-memory-stores.md)

## T1 · 保持入口和直接API的配置校验一致

要做什么：对windowMs/max做有限有效数值校验，覆盖rateLimit factory、checkLimit与MemoryStore.increment，避免NaN/Infinity写入状态或响应头。复用包内校验逻辑即可，不因修复任意收紧仍有定义的有限输入；新增规则遵守v1已有契约。

预计修改文件（本任务共享范围）：

- `packages/rate-limit/src/limiter.ts`
- `packages/rate-limit/src/middleware.ts`
- `packages/rate-limit/src/store.ts`
- `packages/rate-limit/test/limiter.test.ts`
- `packages/rate-limit/test/middleware.test.ts`
- `packages/rate-limit/test/store.test.ts`

验收条件：NaN、±Infinity、0、负数在相关入口被拒绝且未调用/修改store；正常窗口、max边界与429头不回归；checkLimit不返回NaN resetAt。

前置依赖：[08-memory-stores.md](08-memory-stores.md)。

## 校验

```sh
bun test packages/rate-limit
bun run typecheck
bun run lint
bun test packages/redis/test/rate-limit-store.test.ts packages/redis/test/integration.test.ts
```

按 plan 的公共约束保留 v1 API 与现有正常路径。只改本任务拥有的文件；需要扩大范围时先协调依赖。
