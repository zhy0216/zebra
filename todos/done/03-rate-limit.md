# 03 · `@zebra/rate-limit`（v0.3）

限流中间件。设计来源：`docs/superpowers/specs/2026-05-16-zebra-v2-design.md` §8.5。

```typescript
app.use(rateLimit({
  windowMs: 60_000,
  max: 100,
  keyBy: (req) => req.headers.get("x-forwarded-for") ?? "anon",
  store: new MemoryStore(),
}));
```

## C1 · 包骨架 + `rateLimit()` 签名 {#c1}

新建 `packages/rate-limit/`，导出 `rateLimit(opts)` 中间件：

- `windowMs`、`max` 必填；`keyBy` 缺省取客户端 IP（`req.remoteAddress` 或 x-forwarded-for，写明取舍）
- `store` 缺省 `MemoryStore({ windowMs })`
- `keyBy` 允许返回 `string | Promise<string>`

涉及文件：`packages/rate-limit/` 新建；`packages/zebra/src/index.ts`（re-export，如现有模式如此）。

## C2 · 固定窗口 + 滑动续期 {#c2}

- 固定窗口算法：每 key 每窗口期计数
- 窗口边界过后的请求自动开新窗口（惰性，不做全局定时器扫描）
- 高并发下计数更新用原子操作，避免竞态

涉及文件：`packages/rate-limit/src/limiter.ts`。

## C3 · 超限响应 + 限流头 {#c3}

- 超限 → 429，复用 `HttpError` / RFC 9457 Problem+Json（`packages/core/src/http/errors.ts`）
- 注入 `X-RateLimit-Limit` / `X-RateLimit-Remaining` / `X-RateLimit-Reset`；429 附 `Retry-After`
- 头注入通过 `after` 钩子，不吞 handler 异常

涉及文件：`packages/rate-limit/src/middleware.ts`。

## C4 · `RateLimitStore` 接口 {#c4}

- 可插拔 store：`increment(key, windowMs)` → `{ count, resetAt }`、`reset(key)`
- 接口独立于内存实现，为后续 Redis adapter 留位（写清语义：返回值是窗口内计数还是窗口剩余数，二选一）

涉及文件：`packages/rate-limit/src/store.ts`。

## C5 · 测试 {#c5}

- 窗口内第 max+1 个请求 429；窗口滑动后恢复；不同 keyBy 隔离；头字段数值正确；`Retry-After` 存在
- 用 fake store 验证接口契约

涉及文件：`packages/rate-limit/test/`。

## Done criteria

- `bun run typecheck && bun run test` 通过
- README 更新：Features + Packages 表格加 `@zebra/rate-limit`，Status 标 v0.3 进度
