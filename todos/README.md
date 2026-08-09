# Todos

Zebra v0.3 → v1.0 路线图（**不含 OpenAPI**，用户明确排除）。

顺序来源：`docs/superpowers/specs/2026-05-16-zebra-v2-design.md` 第 8、9 节（Per-Package API Highlights / Phased Delivery），以及 `README.md` Status 小节。按版本阶段推进，一次一个文件。

## 优先级

| Priority | 阶段 | 文件 |
| -------- | ---- | ---- |
| P0 | v0.3 | ✅ [01-session.md](done/01-session.md) |
| P0 | v0.3 | [02-cors.md](02-cors.md) |
| P0 | v0.3 | [03-rate-limit.md](03-rate-limit.md) |
| P1 | v0.4 | [04-websocket.md](04-websocket.md) |
| P2 | v1.0 | [05-v1-release.md](05-v1-release.md) |
| P3 | 推迟 | [06-deferred.md](06-deferred.md) |

## 文件

- [✅ 01-session.md](done/01-session.md) — `@zebra/session`：cookie 会话中间件 + 可插拔 store，接入 core 现有 session scope
- [02-cors.md](02-cors.md) — `@zebra/cors`：预检 + 响应头注入
- [03-rate-limit.md](03-rate-limit.md) — `@zebra/rate-limit`：滑动窗口限流 + 可插拔 store
- [04-websocket.md](04-websocket.md) — `@zebra/websocket`：`app.ws()`，Bun.serve upgrade 路径 + DI
- [05-v1-release.md](05-v1-release.md) — v1.0：API 冻结、文档站点、benchmark、发布流程
- [06-deferred.md](06-deferred.md) — 推迟项：CLI、Plugin 接口、session-redis、Bun macro 校验

## 校验命令

- 类型检查: `bun run typecheck`
- 测试: `bun run test`
- Lint: `bun run lint`
