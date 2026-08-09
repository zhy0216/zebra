# 04 · `@zebra/websocket`（v0.4）

WebSocket 支持。设计来源：`docs/superpowers/specs/2026-05-16-zebra-v2-design.md` §8.6。

> 依赖前置：`01-session.md` 的 session scope 集成（C4 提到 `ws.data.session` 可达）。

```typescript
app.ws("/chat/:room", {
  onUpgrade: { user: AuthService },           // DI for upgrade decision
  async upgrade(req, { user }) {
    const u = await user.fromRequest(req.raw);
    return u ? { userId: u.id } : false;       // false → 401
  },
  open(ws, data) { ... },
  message(ws, data, msg) { ... },
  close(ws, data) { ... },
});
```

## C1 · `app.ws()` 注册 + 接入 Bun.serve upgrade 路径 {#c1}

- `Zebra` 增加 `ws(path, handler)` 注册方法（`packages/core/src/app/app.ts`），路由匹配复用现有 radix router 的路径参数能力
- `listen()` 时把 upgrade 处理接入 `Bun.serve({ fetch, websocket })`（`app.ts:146` 附近）：`fetch` 检测 `Upgrade: websocket` → 路由匹配 → 升级；未注册的 path 返回 404
- 升级决策失败（upgrade 返回 false / 抛错）→ 401 响应
- 不匹配的 ws 路径走正常 HTTP 处理

涉及文件：`packages/core/src/app/app.ts`、`packages/core/src/ws/`（新建）。

## C2 · Upgrade 钩子 + DI 依赖声明 {#c2}

- `onUpgrade: { user: AuthService }` 命名对象依赖声明，复用现有容器解析（`middleware()` helper 模式，`packages/core/src/middleware/helper.ts`）
- `upgrade(req, deps)` 返回 `false` → 401；返回对象 → 挂到 `ws.data`
- 同步/异步均可；异常走 401 或 500（写明取舍）

涉及文件：`packages/core/src/ws/`。

## C3 · open / message / close handlers {#c3}

- `open(ws, data)`、`message(ws, data, msg)`、`close(ws, data)` 签名对齐 Bun `ServerWebSocket` 语义
- `ws.data` 携带 upgrade 结果 + session 信息，类型安全
- 每个 ws 连接的消息处理不做请求级 DI scope（连接级还是请求级，写明并实现一种）

涉及文件：`packages/core/src/ws/`。

## C4 · 集成 session scope {#c4}

- `ws.data.session` 在 open 时可用（依赖 `@zebra/session` 的 resolver；从 upgrade 请求解析会话并缓存到连接）
- 无 session 配置时 `ws.data.session` 为 undefined，不报错

涉及文件：`packages/core/src/ws/`、`packages/session/`（如需要暴露解析 helper）。

## C5 · 测试 {#c5}

- 用 Bun 原生 WebSocket 客户端写端到端测试：升级成功、路径参数、upgrade false → 401、message 回显、close 清理
- 普通 HTTP 请求不受 ws 注册影响

涉及文件：`packages/core/test/ws.test.ts`（或 `packages/websocket/` 若拆包更合适——先做 core 内，拆包留给评审）。

## Done criteria

- `bun run typecheck && bun run test` 通过
- README 更新：Features 加 WebSocket，Status 标 v0.4 进度
