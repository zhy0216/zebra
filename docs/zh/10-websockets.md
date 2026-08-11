# WebSocket

`app.ws(path, handler)` 把 WebSocket 升级路径接入 `Bun.serve`，支持 radix 路由参数、DI 解析的升级决策（`onUpgrade` + `upgrade()`）以及连接级会话（`ws.data.session`）。

## 快速开始

```ts
import { Zebra } from "zebra";

const app = new Zebra();

app.ws("/chat/:room", {
  open(ws, data) {
    ws.subscribe(`room:${data.params.room}`);
    ws.send(JSON.stringify({ type: "joined", room: data.params.room }));
  },
  message(ws, data, message) {
    ws.publish(`room:${data.params.room}`, String(message));
  },
  close(ws, data) {
    ws.unsubscribe(`room:${data.params.room}`);
  },
});

await app.listen({ port: 3000 });
```

## 处理器签名

```ts
interface WsHandler<D, Up> {
  onUpgrade?: D;                    // 升级钩子的依赖声明（语义同 middleware()）
  upgrade?: (req, deps, params) => Up | false | Promise<Up | false>;
  open?: (ws, data) => void | Promise<void>;
  message?: (ws, data, message) => void | Promise<void>;  // string | Buffer
  close?: (ws, data, code, reason) => void | Promise<void>;
  drain?: (ws, data) => void | Promise<void>;
  ping?: (ws, data, payload) => void | Promise<void>;
  pong?: (ws, data, payload) => void | Promise<void>;
}
```

回调对齐 Bun `ServerWebSocket` 语义，只是把 `ws.data`（升级结果 + 路径参数）作为第二个参数注入，Bun 的原始参数（message / code / reason / ping-pong payload）依次后移。

## 升级决策链（`upgrade` 钩子）

`upgrade` 钩子在升级发生前运行，可以决定**接受还是拒绝**连接，并把自定义数据展开进 `ws.data`：

| 返回值 | 行为 |
| --- | --- |
| `Up` 对象 | 升级成功，字段展开进 `ws.data`（类型为 `Up`，open/message/close 里可类型化访问） |
| `false` | 客户端显式拒绝 → **401** `upgrade_rejected` |
| 抛错 | 内部错误 → **500** `upgrade_error` |

```ts
app.ws("/topics/:topicId/live", {
  onUpgrade: { forum: ForumService },          // DI 解析
  async upgrade(_req, { forum }, params) {
    const topic = await forum.findTopic(Number(params.topicId));
    return topic === undefined ? false : { topicId: topic.id };  // 不存在 → 401
  },
  open(ws, data) {
    // data.topicId: number —— 类型来自 upgrade 返回值
  },
});
```

要点：

- `onUpgrade` 的依赖在**升级请求的 request scope** 里解析，决策完成后立即 dispose——**不要**把 request 作用域依赖挂到 `ws.data` 上跨连接使用（连接级依赖在 `open` 里解析一次并随连接复用）。
- 升级请求不经过 `app.use` 全局中间件——基于路径的鉴权在 `upgrade` 钩子里做。
- 传输层失败（Bun `upgrade` 返回 false）→ **401** `upgrade_failed`（区别于上面的 `upgrade_rejected`）。

## 连接数据 `ws.data`

```ts
interface WsData {
  params: Record<string, string>;   // 路由路径参数
  session?: unknown;                // C4 会话句柄（wsSession 钩子填充）
  [key: string]: unknown;           // upgrade() 返回对象展开
}
```

- `params` 是路由参数（`/chat/:room` 的 `room`）。
- `session` 由 `ZebraOptions.session.wsSession` 钩子填充（通常来自 `@zebra/session` 的 `RequestSession`）。未配置钩子或匿名连接时为 `undefined`，不报错。
- `upgrade()` 的返回对象展开为其余字段；`session` 是保留字段（upgrade 返回的同名键会被覆盖）。

## 会话与 WebSocket

用 `@zebra/session` 时，把 `sessionMiddleware()` 返回的 `wsSession` 接进 Zebra 构造选项：

```ts
import { sessionMiddleware } from "@zebra/session";

const session = sessionMiddleware({ secret, cookie: { preset: "secure" } });

const app = new Zebra({
  session: { resolver: session.resolver, wsSession: session.wsSession, ttl: 30 * 60 * 1000 },
});
app.use(session);

app.ws("/chat/:room", {
  async open(ws, data) {
    const s = data.session;               // RequestSession | undefined
    const userId = s === undefined ? undefined : await s.get("userId");
    ws.send(JSON.stringify({ type: "joined", userId }));
  },
});
```

会话语义：

- `sessionId` 来自升级请求上经 resolver **验证过的存活会话**（不存活即匿名）。
- 匿名连接返回 `undefined`——升级响应无法回发 Set-Cookie，伪造新 id 只会产生客户端拿不到的孤儿记录。
- **ws 没有 HTTP 响应路径的自动持久化**：写会话数据后需显式 `await session.flush()`。

## DI 作用域取舍

| 场景 | 作用域 |
| --- | --- |
| `upgrade` 钩子 | 单次请求决策，request scope，决策后立即 dispose |
| `open` / `message` / `close` | 不创建 request scope（原始 Request 已结束）；连接级依赖在 `open` 时解析一次、连接内复用 |

## 广播模式

配合 `ws.subscribe` / `ws.publish` 做房间广播：

```ts
app.ws("/feed/:topicId", {
  open(ws, data) {
    ws.subscribe(`feed:${data.params.topicId}`);
  },
});

// HTTP handler 里广播到主题房间：
z.post("/topics/:id/posts", { feed: LiveFeed }, async (req, { feed }) => {
  const post = await feed.create(...);
  // LiveFeed 内部持有 ServerWebSocket 引用，或直接用 app 级 pub/sub
  return post;
});
```

`examples/forum` 的 `LiveFeed` 是完整范例（订阅/退订、广播、shutdown 时 dispose）。

## 无匹配路由

对未注册的 ws 路径发起升级 → **404** `not_found` Problem+Json。

## 下一步

- [会话：wsSession 钩子的完整语义](07-sessions.md#websocket-会话)
- [HTTP 请求在 ws 升级里不可用（升级先于中间件链）](04-middleware.md)
- [forum 示例：ws + 契约 + 限流 + 静态前端](README.md#示例)
