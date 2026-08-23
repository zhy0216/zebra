# Zebra 文档

> English docs: [English](../README.md)

Zebra 是一个 Bun-first 的 TypeScript Web 框架，把依赖注入（DI）当作一等公民。

- **Bun-first** —— 直接构建在 `Bun.serve` / `Bun.file` 与 Web Standard `Request` / `Response` 之上，没有 Node 兼容层。
- **DI 是强制的，不是外挂** —— 每个应用都围绕一个 `Container` 构建；路由与中间件声明自己的依赖，容器在启动时校验整张依赖图。
- **命名对象路由 DI** —— `app.get(path, { svc: Service }, (req, { svc }) => ...)`，显式、类型安全、零字符串解析。
- **结构化错误** —— 默认错误响应遵循 RFC 9457（Problem+Json）。
- **契约优先（oRPC 风格）** —— 契约定义一次（`zc.get(path).params(s).query(s).body(s).output(s).status(n).errors(e).meta(m)`），服务端用完整类型推断 + 运行时校验实现（`app.implement`），并从同一契约派生类型安全客户端（`createClient` / `createTestClient`）。

## 篇章索引

### 入门

| 篇章 | 内容 |
| --- | --- |
| [01-getting-started](01-getting-started.md) | 安装、运行环境、快速开始、第一个应用 |

### 核心（`@zebra-web/core` / `@zebra-web/zebra`）

| 篇章 | 内容 |
| --- | --- |
| [02-routing](02-routing.md) | 路由：路径参数、通配符、HTTP 方法、groups、405 / 自动 OPTIONS |
| [03-di](03-di.md) | 依赖注入：`Container`、四种 scope、`token`、启动时图校验 |
| [04-middleware](04-middleware.md) | 中间件：Koa 风格 compose、依赖感知的 `middleware()`、错误中间件 |
| [05-http](05-http.md) | HTTP：`ZebraRequest`、请求体解析、响应 helpers、`HttpError` / Problem+Json、静态文件、请求超时 |
| [06-lifecycle](06-lifecycle.md) | 生命周期：boot / ready / shutdown 钩子、优雅停机、session scope 回收 |
| [10-websockets](10-websockets.md) | WebSocket：`app.ws()`、DI 升级决策、ws 会话 |

### 契约优先（`@zebra-web/contract` + `@zebra-web/client`）

| 篇章 | 内容 |
| --- | --- |
| [11-contract-first](11-contract-first.md) | 契约构建、`app.implement`、类型安全客户端、错误处理 |
| [16-mcp](16-mcp.md) | 从同一契约导出 MCP 工具（`@zebra-web/mcp`、`@zebra-web/schema-zod`） |

### 中间件包

| 篇章 | 内容 |
| --- | --- |
| [07-sessions](07-sessions.md) | Cookie 会话（`@zebra-web/session`）：HMAC 签名 `sid`、可插拔 store、防会话固定攻击 |
| [08-cors](08-cors.md) | CORS（`@zebra-web/cors`）：preflight、origin 白名单、credentials 精确回显 |
| [09-rate-limiting](09-rate-limiting.md) | 限流（`@zebra-web/rate-limit`）：固定窗口、`X-RateLimit-*` 头、`trustProxy` |
| [13-observability](13-observability.md) | 可观测性（`@zebra-web/observability`）：requestId / accessLog / errorReporter / metrics / health |
| [14-redis](14-redis.md) | Redis 存储适配（`@zebra-web/redis`）：限流 store + 会话 store |

### 测试与发布

| 篇章 | 内容 |
| --- | --- |
| [12-testing](12-testing.md) | 测试（`@zebra-web/testing`）：`createTestApp` / `createTestClient` 进程内测试 |
| [15-production](15-production.md) | 部署与发布：src 直发策略、锁步版本、性能基准 |
| [api-freeze](api-freeze.md) | v1 API 冻结面与 SemVer 版本策略 |

## 包一览

| 包 | 是什么 |
| --- | --- |
| `@zebra-web/zebra` | 公共门面 —— 再导出 `@zebra-web/core`、`@zebra-web/cors`、`@zebra-web/session` 与（别名后的）`@zebra-web/rate-limit` |
| `@zebra-web/core` | App、DI 容器、路由、HTTP、中间件、`implement` |
| `@zebra-web/contract` | 契约构建器 + 协议（Standard Schema V1，零依赖） |
| `@zebra-web/client` | 派生类型安全客户端（零依赖） |
| `@zebra-web/session` | Cookie 会话：HMAC `sid`、可插拔 store、防固定攻击 |
| `@zebra-web/cors` | CORS 中间件：preflight、origin 白名单、credentials 回显 |
| `@zebra-web/rate-limit` | 固定窗口限流：429 Problem+Json、`X-RateLimit-*` 头、可插拔 store |
| `@zebra-web/observability` | 可观测性中间件：requestId / accessLog / errorReporter / metrics / health |
| `@zebra-web/redis` | Redis 后端：`RedisRateLimitStore` + `RedisSessionStore`（零运行时依赖） |
| `@zebra-web/testing` | 进程内 `createTestApp` / `createTestClient` |

## 示例

仓库根目录下有一套从简到全的示例，每个都可直接运行：

```sh
bun --filter example-hello start           # 最小应用 — http://localhost:3000
bun --filter example-blog start            # DI 服务 + 路由分组 + 结构化错误 — http://localhost:3001
bun --filter example-contract-blog start   # 契约优先：契约 + implement + 类型化客户端
bun --filter example-forum start           # 全功能：契约 API + 会话 + 限流 + CORS + WS + 静态前端 — http://localhost:3002
bun --filter example-better-auth start     # Better Auth 集成 — http://localhost:3003
```

完整列表见仓库 [README](../../README.md)。
