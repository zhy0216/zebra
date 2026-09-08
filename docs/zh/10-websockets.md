# WebSocket

`app.ws(path, handler)` 把 WebSocket 升级路径接入 `Bun.serve`，支持 radix 路由参数、DI 解析的升级决策（`onUpgrade` + `upgrade()`）以及连接级会话（`ws.data.session`）。

## 快速开始

```ts
import { Zebra } from "@zebra-web/zebra";

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
  upgrade?: (req, deps, params) =>
    Up | WsUpgrade<Up> | Response | false |
    Promise<Up | WsUpgrade<Up> | Response | false>;
  open?: (ws, data) => void | Promise<void>;
  message?: (ws, data, message) => void | Promise<void>;  // string | Buffer
  close?: (ws, data, code, reason) => void | Promise<void>;
  drain?: (ws, data) => void | Promise<void>;
  ping?: (ws, data, payload) => void | Promise<void>;
  pong?: (ws, data, payload) => void | Promise<void>;
}
```

回调对齐 Bun `ServerWebSocket` 语义，只是把 `ws.data`（升级结果 + 路径参数）作为第二个参数注入，Bun 的原始参数（message / code / reason / ping-pong payload）依次后移。

回调 Promise 的异常会被捕获并报告，但回调不会串行执行：异步 `open` 完成前就可能
收到 `message`。在 `open` 加载状态的应用需自行设置就绪屏障和有界的接收队列。

## 升级决策链（`upgrade` 钩子）

`upgrade` 钩子在升级发生前运行，可以决定**接受还是拒绝**连接，并把自定义数据展开进 `ws.data`：

| 返回值 | 行为 |
| --- | --- |
| `Up` 对象 | 升级成功，字段展开进 `ws.data`（类型为 `Up`，open/message/close 里可类型化访问） |
| `wsUpgrade(data, { headers })` | 携带额外响应头成功升级；仅 `data` 展开进 `ws.data`，保留类型推断 |
| `Response` | 拒绝升级，不调用 Bun `upgrade` 或 `open`；原样返回 status、body 和 headers |
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
- 自定义拒绝跳过 `wsSession`；所有决策路径仍会释放并等待 request scope 清理。钩子或释放失败仍返回 **500** `upgrade_error`。

### 自定义拒绝与成功响应头

`wsUpgrade`、`WsUpgrade<Up>` 和 `WsUpgradeOptions` 均可从
`@zebra-web/core` 或 `@zebra-web/zebra` 公开导入：

```ts
import { Zebra, wsUpgrade, type WsUpgrade, type WsUpgradeOptions } from "@zebra-web/core";

const app = new Zebra();
const protocol = "chat-v1";

app.ws("/chat/:room", {
  upgrade(req, _deps, params) {
    if (params.room !== "lobby") {
      return new Response("Room unavailable", {
        status: 404,
        headers: { "x-room-status": "unavailable" },
      });
    }
    const offered = req.headers.get("sec-websocket-protocol")?.split(",").map((p) => p.trim());
    const headers = new Headers({ "x-chat-server": "zebra" });
    if (offered?.includes(protocol)) headers.set("sec-websocket-protocol", protocol);
    return wsUpgrade({ userId: "u1" }, { headers });
  },
  message(ws, data, message) {
    // data.userId 和 ws.data.userId 都是 string。
    ws.send(`${data.userId}: ${message}`);
  },
});
```

helper 签名为
`wsUpgrade<Up extends Record<string, unknown>>(data: Up, options?: WsUpgradeOptions): WsUpgrade<Up>`。
`WsUpgradeOptions.headers` 接受 Bun 的 `HeadersInit`（record、元组数组或 `Headers`）。
多条 `Set-Cookie` 使用元组数组或 `Headers.append`。返回值由 symbol 区分；普通对象中
的 `data`、`headers`、`type` 字段仍是原来的连接数据，不会被解释为升级控制字段。

显式返回的 `Sec-WebSocket-Protocol` 必须是客户端提供的单个合法 token，大小写精确匹配。
非法或未提供的选择会在调用 Bun upgrade 前返回 **500** `upgrade_error`，不会伪造协议。
不设置响应头时，保留 Bun 现有协商行为（Bun 1.4 选择客户端提供的第一个协议，无提供则
不协商协议）。Zebra 不选择业务协议，也不内置业务鉴权策略。

## 监听器 transport 选项

`ListenOptions.websocket` 接受 `WsTransportOptions`，是 Bun WebSocket handler 配置的
受类型约束子集，对该 listener 的所有 WS 路由生效：

```ts
await app.listen({
  port: 3000,
  websocket: {
    maxPayloadLength: 1024 * 1024,
    idleTimeout: 120,
    backpressureLimit: 4 * 1024 * 1024,
    closeOnBackpressureLimit: true,
  },
});
```

| 选项 | 含义 | 省略时的 Bun 默认值 |
| --- | --- | --- |
| `maxPayloadLength` | 单条接收消息的最大字节数 | 16 MiB |
| `idleTimeout` | 无消息或 ping 的空闲秒数；`0` 禁用 | 120 |
| `backpressureLimit` | 每连接发送缓冲的最大字节数 | 16 MiB |
| `closeOnBackpressureLimit` | 发送缓冲溢出时关闭连接 | `false` |

只透传这四个字段。即使无类型调用者传入 `open`、`message`、`data` 等额外字段，所有回调
和连接 data 分发仍由 Zebra 管理。省略字段保持 Bun 默认值；顶层
`listen({ idleTimeout })` 单独控制 HTTP 连接。transport 值由 Bun 校验，参见
[Bun WebSockets](https://bun.com/docs/runtime/http/websockets)。

payload 限制在路由 `message` 回调前执行，也适用于二进制消息。当前验证使用
[Bun 1.4.2](https://github.com/oven-sh/bun/releases/tag/bun-v1.4.2)，即截至 2026-09-08
的最新稳定版。Bun 对超限消息直接终止连接，不发送 close frame：客户端观察到 **1006**，服务端 close
回调也报告 **1006**，reason 为 `Received too big message`。不能依赖此 transport
限制产生 **1009** 关闭握手。上限为 1 MiB 时，1 MiB 二进制消息可进入 handler，
1 MiB + 1 字节则绝不进入。Zebra 保留该硬上限，并暴露 Bun 原生关闭行为。
早先 Bun 1.4.0 验证也观察到相同行为，仓库最低版本要求保持不变。
应用队列上限与处理顺序仍由应用负责；发送背压限制的是
待发送字节，而非异步任务量。

## 连接数据 `ws.data`

```ts
interface WsData {
  params: Record<string, string>;   // 路由路径参数
  session?: unknown;                // C4 会话句柄（wsSession 钩子填充）
  [key: string]: unknown;           // upgrade() 返回对象展开
}
```

- `params` 是路由参数（`/chat/:room` 的 `room`）。
- `session` 由 `ZebraOptions.session.wsSession` 钩子填充（通常来自 `@zebra-web/session` 的 `RequestSession`）。未配置钩子或匿名连接时为 `undefined`，不报错。
- `upgrade()` 的返回对象展开为其余字段；`session` 是保留字段（upgrade 返回的同名键会被覆盖）。

## 会话与 WebSocket

用 `@zebra-web/session` 时，把 `sessionMiddleware()` 返回的 `wsSession` 接进 Zebra 构造选项：

```ts
import { sessionMiddleware } from "@zebra-web/session";

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
- 匿名连接返回 `undefined`；session 钩子不会在升级时创建或签发新 cookie。虽然 `wsUpgrade` 支持自定义握手响应头，session middleware 的匿名会话策略保持不变。
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
