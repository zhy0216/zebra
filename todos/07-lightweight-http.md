# 07 · 轻量 HTTP 生产化补强

## 状态

- 条目 1–7、9 已完成并通过对抗式校验（544 测试 + fuzz 全绿，typecheck/lint/build/verify:packages 通过）。
- **条目 8（Contract-first 补齐表达能力）deferred**：条目正文明确标注这些能力在 contract-first
  设计中为 deferred，且要求"开始实现前先更新设计决策和 API 兼容策略"——涉及 `@zebra/contract` /
  `@zebra/client` / core implement 的跨包 API 扩展（headers/cookies/per-status schema、内容协商、
  client 超时/重试/cookie jar），属于 v2 设计决策范围，本轮不动。
- 非目标声明保持原样（无代码动作）。

## 背景

Zebra 当前已经具备路由、DI、中间件、结构化错误、静态文件、Session、CORS、限流、WebSocket、Contract-first 和测试能力。

下一阶段不继续向 core 堆 ORM、认证、OpenAPI、CLI 或正式 Plugin 系统，而是补齐 HTTP 语义、安全默认值、生产部署能力和轻量化性能路径。

目标定位：

> `@zebra/core` 是轻量 Bun HTTP 核心；可选能力通过独立包提供。

## P0 · HTTP 语义完整性

### 1. HEAD / OPTIONS / 自定义 method

- [x] 增加 `app.head()` 和 `app.options()`。
- [x] 评估增加通用 `app.route(method, path, ...)`，避免 method API 持续扩张。
- [x] 未显式注册 `HEAD` 时，`HEAD` 自动复用对应 `GET` 路由，但响应不包含 body。
- [x] 未显式注册 `OPTIONS` 时，对已知路径自动返回 `204` 和 `Allow`。
- [x] `405 Method Not Allowed` 的 `Allow` 头包含该路径支持的 method。
- [x] Contract 的 `METHODS` / `Method` 类型与 core 行为保持一致。
- [x] 补充静态路由、参数路由、通配路由和 CORS preflight 测试。

验收：正常 GET/HEAD 行为符合 Web 标准；OPTIONS 不再因为未注册路由返回 405；已有五种 method 的行为不变。

### 2. 安全默认值和路径防护

- [x] Session 提供安全 cookie preset，至少覆盖 `HttpOnly` 和 `SameSite=Lax`。
- [x] 不要在 v1 中静默改变已冻结的默认行为；优先新增 opt-in 配置或记录到 v2。
- [x] 增加 trusted proxy 配置，明确何时可以信任 `X-Forwarded-For`。
- [x] Rate-limit 在未配置 trusted proxy 时不要默认信任客户端伪造的转发 IP。
- [x] 静态文件使用 `realpath` 或等价方式校验 symlink，防止 root 内 symlink 指向 root 外部。
- [x] 为上述安全边界增加回归测试和文档警告。

### 3. 请求超时、取消和早期限制

- [x] `listen()` 暴露必要的 Bun server 配置：至少 `idleTimeout`、`maxRequestBodySize`；TLS / `reusePort` 等按兼容性评估。
- [x] 为请求提供 deadline / timeout 能力，并让 handler 能观察 `Request.signal` 的取消。
- [x] body parser 的应用层限制与 Bun transport 层限制保持清晰、可组合的语义。
- [x] 测试超大 body、客户端中断、handler 超时和 graceful shutdown 场景。

## P0 · 轻量化性能

### 4. Zero-cost fast path

- [x] 没有 session resolver、route deps、middleware deps 时，跳过 request/session child scope 创建。
- [x] `withResolvedDeps()` 不要在每个请求重复扫描和包装 middleware；在 boot/freeze 阶段预编译执行链。
- [x] 预计算路由执行计划，减少每请求的数组复制和依赖检查。
- [x] 静态文件请求避免在热路径使用同步 `statSync`；评估 metadata/file cache 或异步实现。
- [x] MemoryStore 的过期清理不要在每次访问时对全部 entry 做 O(n) sweep；评估有界清理策略。
- [x] 为无 DI、带 middleware、带 DI、静态文件四类场景增加 benchmark 和性能回归阈值。

验收：无依赖的最小 GET 路由不创建 Container child scope；吞吐和 p95 延迟相对当前基线有可复现改善，且带 DI/session 的语义不变。

## P1 · 生产可观测性

### 5. Observability 扩展点

- [x] 增加 request ID 生成 / 透传策略。
- [x] 增加 access log hook：method、path、status、duration、request ID。
- [x] 增加 `onError` / error reporter hook；未知异常仍返回通用 Problem+Json，但不能无日志丢失。
- [x] 提供最小 metrics seam（请求数、错误数、延迟、in-flight）。
- [x] readiness / liveness 不必内置业务逻辑，但应提供清晰的扩展方式。
- [x] 优先放入独立 `@zebra/observability` 或 middleware 包，避免 core 依赖 logger 实现。

## P1 · 多实例部署

### 6. 可插拔存储适配器

- [x] 为 `@zebra/session` 增加 Redis 适配器包或独立示例。
- [x] 为 `@zebra/rate-limit` 增加 Redis / 分布式计数适配器包或独立示例。
- [x] 明确 MemoryStore 只适合单进程 / 开发 / 测试，不适合多实例共享状态。
- [x] 覆盖并发、TTL、destroy 后不可复活、网络错误和降级策略测试。

## P1 · HTTP 使用体验

### 7. 请求和响应 helper

- [x] 增加 `req.json()`、`req.text()`、`req.form()` 等常用请求 helper，保持 lazy + memoized 语义。
- [x] 增加 `json()`、`text()`、`html()`、`redirect()`、`stream()` 等轻量 Response helper。
- [x] 明确字符串、二进制、空值、`Response` 的默认 content-type / status 规则。
- [x] 大文件上传和下载提供 streaming 路径，不要求所有 body 一次性缓冲到内存。

## P2 · Contract-first 完整性

### 8. 补齐契约表达能力

- [ ] headers schema。
- [ ] cookies schema。
- [ ] per-status output / error schema。
- [ ] content-type / content negotiation。
- [ ] client timeout、retry、cookie jar 等可选能力。
- [ ] 评估 contract 与 group / mount prefix 的组合方式。

这些能力当前在 contract-first 设计中明确标记为 deferred；开始实现前先更新设计决策和 API 兼容策略。

## P2 · 发布和工程质量

### 9. 发布前检查

- [x] 增加 CI：typecheck、test、lint、build，至少覆盖 Linux + Bun 版本矩阵。
- [x] 增加 `bun pm pack` / tarball 安装 smoke test，确认发布内容和 exports 可用。
- [x] 明确 `src` 直发与 `dist` 构建产物的策略，避免 build 产物未被 package 使用。
- [x] 增加 CHANGELOG、SECURITY、CONTRIBUTING 和支持的 Bun/TypeScript 版本说明。
- [x] 对关键 HTTP 安全路径增加 fuzz / property tests：path、cookie、range、body parser、router precedence。

## 非目标

- [ ] 不把 ORM、数据库层、JWT/认证、OpenAPI 生成、CLI、正式 Plugin 系统放入 `@zebra/core`。
- [ ] 不为了功能数量牺牲最小安装路径和无依赖路由的性能。

## 建议执行顺序

1. HEAD / OPTIONS / Allow + 安全 cookie / trusted proxy。
2. timeout / transport options + zero-cost fast path。
3. request ID / error hook / access log。
4. Response/request helper 和 streaming。
5. Redis adapters。
6. Contract-first 扩展与发布工程化。

## 校验命令

- 类型检查：`bun run typecheck`
- 测试：`bun run test`
- Lint：`bun run lint`
- Benchmark：`bun run bench`
