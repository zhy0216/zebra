# 01 · `@zebra/session`（v0.3）

Cookie-based 会话中间件。设计来源：`docs/superpowers/specs/2026-05-16-zebra-v2-design.md` §8.3。

core 已有底层设施，本包只做中间件层，**不重造 session scope**：

- `ZebraOptions.session.resolver` 已存在，把 `Request` 映射为 `sessionId`（`packages/core/src/app/app.ts:97, 615`）
- `disposeSession()`、session TTL、匿名会话已存在（`app.ts:163, 622-655`）

## C1 · 包骨架 + `sessionMiddleware()` 签名 {#c1}

新建 `packages/session/`（仿 `packages/cors` 结构；参考 `packages/contract` 的 package.json / tsconfig / 测试布局），导出 `sessionMiddleware`：

```typescript
app.use(sessionMiddleware({
  secret: process.env.SESSION_SECRET,
  cookie: { name: "sid", maxAge: 86400, secure: true, httpOnly: true, sameSite: "lax" },
  store: new MemoryStore({ ttl: 1800 }),
}));
```

- `secret` 必填；`cookie` 选项对齐 `Response` `Set-Cookie` 常用项（name/maxAge/secure/httpOnly/sameSite/path/domain）
- `store` 默认 `MemoryStore`，接受注入的外部 store

涉及文件：`packages/session/` 新建；`packages/zebra/src/index.ts`（re-export，如现有模式如此）。

## C2 · Cookie 解析 + HMAC-SHA256 签名/验签 {#c2}

- 从 `Cookie` 请求头解析 sid（内置 cookie 解析，不引依赖）
- 签名为 `sid.hmac`（HMAC-SHA256，key 为 `secret`），验签失败视为无会话
- 防时序攻击比较（`crypto.timingSafeEqual`）

涉及文件：`packages/session/src/sign.ts`、`packages/session/src/cookie.ts`。

## C3 · `SessionStore` 接口 + `MemoryStore` 默认实现 {#c3}

可插拔 store（为后续 `@zebra/session-redis` 留位，接口设计要独立于内存实现）：

- `SessionStore`：`get(id)` / `set(id, data)` / `touch(id, ttl)` / `destroy(id)`，数据任意可序列化值
- `MemoryStore({ ttl })`：Map 实现 + 惰性过期清理（不要定时器泄漏）
- 测试用 fake store 验证接口契约

涉及文件：`packages/session/src/store.ts`。

## C4 · 接入 core session scope，`req.ctx.session` 读写 {#c4}

- 中间件把会话 id 解析结果提供给 `ZebraOptions.session.resolver`（构造 `Zebra` 时装配，参考 `app.ts:97`）
- 提供 `req.ctx.session` 读写 API：读取当前会话数据、写入后持久化到 store（写入时机：响应结束时 `after` 钩子或显式 flush，选实现成本低且不丢数据的那种）
- 新访客：生成随机 sid 并下发 `Set-Cookie`；TTL 内无活动允许滚动续期

涉及文件：`packages/session/src/middleware.ts`、`packages/session/src/session.ts`、`packages/core/src/app/types.ts`（如需要类型微调）。

## C5 · 会话生命周期边界 {#c5}

- 显式登出：`session.destroy()` → store destroy + `Set-Cookie` 过期
- `app.disposeSession(id)` 与 store 状态保持一致（core 的 TTL 与 store TTL 谁来主管，二选一并写清楚）
- 服务端销毁后客户端旧 cookie 不应复活会话（防 session fixation）

涉及文件：`packages/session/src/middleware.ts`、`packages/session/src/session.ts`。

## C6 · 测试 {#c6}

- 用 `createTestApp` 集成测试：写入→读回、防篡改拒绝（改签名后验签失败）、TTL 过期、session scope 注入的 `injectSession` 服务可解析、匿名会话隔离
- `docs/superpowers/specs/2026-05-16-zebra-v2-design.md` §8.3 的用例逐条覆盖

涉及文件：`packages/session/test/`。

## Done criteria

- `bun run typecheck && bun run test` 通过
- 设计文档 §8.3 API 形状可用；`examples/` 补一个 session 示例（可选，README 提到即可）
- README 更新：Features + Packages 表格加 `@zebra/session`，Status 标 v0.3 进度
