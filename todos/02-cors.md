# 02 · `@zebra/cors`（v0.3）

CORS 中间件。设计来源：`docs/superpowers/specs/2026-05-16-zebra-v2-design.md` §8.4。

```typescript
app.use(cors({
  origin: ["https://example.com"],
  credentials: true,
  methods: ["GET", "POST", "PUT", "DELETE"],
  maxAge: 600,
}));
```

## C1 · 包骨架 + `cors()` 签名 {#c1}

新建 `packages/cors/`，导出 `cors(opts)` 中间件（遵循现有 `middleware()` helper 的依赖声明模式，`packages/core/src/middleware/helper.ts`）。

选项：

- `origin`: `string | string[] | RegExp | ((origin) => boolean)`，缺省 `*`
- `credentials`（缺省 false，为 true 时 origin 必须精确回显，不能 `*`）
- `methods`（缺省常见方法集）、`allowedHeaders`（缺省回显 `Access-Control-Request-Headers`）、`exposedHeaders`、`maxAge`

涉及文件：`packages/cors/` 新建；`packages/zebra/src/index.ts`（re-export，如现有模式如此）。

## C2 · 预检请求处理 {#c2}

- `OPTIONS` 且带 `Access-Control-Request-Method` → 预检：验证 origin 是否允许，返回 204 + 完整响应头（`Access-Control-Allow-Origin` / `Allow-Credentials` / `Allow-Methods` / `Allow-Headers` / `Max-Age`）
- origin 不允许时：不返回 CORS 头（浏览器侧自然拦截），不 403
- 非预检的 `OPTIONS` 直接放行

涉及文件：`packages/cors/src/cors.ts`（或拆 `preflight.ts`）。

## C3 · 实际请求响应头注入 {#c3}

- 对允许的跨域请求注入 `Access-Control-Allow-Origin`（动态回显具体 origin，配合 Vary: Origin）
- `Vary: Origin` 头必须加（origin 动态匹配时）
- 通过 `after` 钩子或响应包装实现，不动业务 handler 的返回值语义

涉及文件：`packages/cors/src/cors.ts`。

## C4 · Origin 匹配逻辑 {#c4}

- `string | string[]` 精确匹配；`RegExp` 测试；函数判断；缺省 `*`
- credentials 为 true 时禁止 `*`（静默降级为回显请求 origin 或按配置精确列表）

涉及文件：`packages/cors/src/origin.ts`。

## C5 · 测试 {#c5}

- `createTestApp` 集成：预检 204 头齐全、实际请求头注入、credentials+origin 精确回显、不允许的 origin 无 CORS 头、`Vary: Origin` 存在
- 预检不影响正常 GET/POST 流程

涉及文件：`packages/cors/test/`。

## Done criteria

- `bun run typecheck && bun run test` 通过
- README 更新：Features + Packages 表格加 `@zebra/cors`，Status 标 v0.3 进度
