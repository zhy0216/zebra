# Cookie 会话（@zebra/session）

`@zebra/session` 提供基于签名 cookie 的服务端会话：HMAC-SHA256 签名的 `sid` cookie、可插拔的 `SessionStore`（内存默认）、滚动 TTL 续期与防会话固定攻击。它还通过 `resolver` 与 core 的会话作用域 DI 协同。

## 安装

```sh
bun add @zebra/session
```

## 快速开始

```ts
import { Zebra } from "@zebra/core";
import { sessionMiddleware } from "@zebra/session";

const session = sessionMiddleware({
  secret: "a-long-random-secret",
  cookie: { httpOnly: true, sameSite: "lax", maxAge: 7 * 24 * 60 * 60, path: "/" },
});

const app = new Zebra({
  session: { resolver: session.resolver, wsSession: session.wsSession, ttl: 30 * 60 * 1000 },
});

app.use(session);

app.get("/counter", async (req) => {
  const s = getSession(req)!;
  const count = (await s.get<number>("count")) ?? 0;
  await s.set("count", count + 1);
  return { count: count + 1 };
});
```

关键接线：

1. `sessionMiddleware({ secret, cookie?, store? })` 返回中间件对象。
2. 它的 `.resolver` 接进 `new Zebra({ session: { resolver, ttl } })` —— 让**会话作用域 DI** 按同一个会话 id 工作（core 不依赖 session 包，resolver 是它们之间的桥）。
3. `.wsSession` 接进 `session: { wsSession }` —— 让 WebSocket 连接拿到会话句柄（见 [WebSocket](10-websockets.md)）。
4. `app.use(session)` 挂载中间件，在 `req.ctx.session` 上提供读写的 `RequestSession`，并在响应路径持久化。

## RequestSession API

`getSession(req)` 返回当前请求的会话句柄（中间件未运行时为 `undefined`）：

```ts
interface RequestSession {
  readonly id: string;      // 已校验的会话 id（新访客则新生成）
  readonly isNew: boolean;  // 本次请求是否新建了会话
  get<T>(key: string): Promise<T | undefined>;
  set(key: string, value: unknown): Promise<void>;
  delete(key: string): Promise<void>;
  has(key: string): Promise<boolean>;
  data(): Promise<Record<string, unknown>>; // 浅拷贝
  flush(): Promise<void>;   // 立即持久化（中间件在响应结束也会持久化）
  destroy(): Promise<void>; // 销毁：删数据 + 响应带过期 Set-Cookie
}
```

- 数据**惰性加载**：首次访问 `get`/`set` 才从 store 拉取，请求内缓存。
- `set`/`delete` 标记脏；响应结束时（即使出错）自动持久化。新访客没写过数据则什么都不写（不会污染 store）。
- `destroy()` 后句柄失效，后续变更不再持久化，响应携带 `Set-Cookie: sid=; Max-Age=0` 让客户端丢弃 cookie。

## 持久化语义

| 场景 | 行为 |
| --- | --- |
| 新会话 + 无写入 | 不写 store（匿名请求零开销） |
| 新会话 + 有写入 | `store.set(id, data)` + `Set-Cookie`（带签名） |
| 已有会话 + 有写入 | `store.set(id, data)` |
| 已有会话 + 无写入 | `store.touch(id)` —— 滚动续期 TTL |
| `destroy()` | `store.destroy(id)` + 过期 cookie；**永不复原** |

持久化发生在 `next()` 之后（包括 handler 抛错的路径，只要会话未销毁）——见下方「TTL 归属」。

## Cookie 细节

- 默认 cookie 名 `sid`，路径 `/`。
- 值 = `HMAC-SHA256(secret, id)` 签名的 id。`parseSignedCookie` 校验签名；篡改的 cookie 视为匿名。
- **默认 cookie 没有任何安全属性**（这是冻结的 v1 行为）。需要硬化时用 `preset: "secure"`（`HttpOnly` + `SameSite=Lax`），或显式传属性（会覆盖 preset）：

```ts
sessionMiddleware({
  secret,
  cookie: { preset: "secure" },            // HttpOnly + SameSite=Lax
  // 或显式：cookie: { httpOnly: true, sameSite: "strict", secure: true }
});
```

`SECURE_COOKIE` 常量即 `{ httpOnly: true, sameSite: "lax" }`；也可用 `SECURE_COOKIE` 环境变量控制。

## 防会话固定攻击

- 签名只证明 cookie 是**真的**，不证明会话还**活着**。resolver 与 `openSession` 在复用 id 前都会查 store：校验通过但 store 里没有记录（已销毁或已过期）的 id 视为**新访客**——生成新 sid + 新 cookie 替换旧的，绝不复活旧会话。
- 这保证 core 的会话 DI 作用域与中间件数据层一致：销毁过的会话既不会复活数据，也不会复活 DI 作用域。
- `MemoryStore` 用短命 tombstone 阻止在途请求的 `set` 复活已销毁会话。

## SessionStore 接口与默认实现

```ts
interface SessionStore {
  get(id: string): Promise<unknown | undefined>;
  set(id: string, data: unknown): Promise<void>;
  touch(id: string, ttl?: number): Promise<void>;
  destroy(id: string): Promise<void>;
}
```

- `MemoryStore({ ttl })` —— 默认，`Map` 后端，惰性清扫（每次访问最多扫 `SWEEP_BUDGET` 条），无计时器、无泄漏；TTL 毫秒。
- 自建后端（Redis / Postgres）：实现该接口即可。`@zebra/redis` 已提供 `RedisSessionStore`（见 [Redis](14-redis.md)）。

## TTL 归属

两套 TTL 独立设计：

- **store TTL 属主数据**：会话 id 存活 ⟺ store 里有它的记录。过期后 cookie 失效、数据删除。
- **core 的 `sessionTtl` 只回收 DI 容器**：`app.disposeSession(id)` 清理容器与计时器，绝不触碰 store 数据。

需要同时立即回收 DI 容器与销毁会话数据时，`session.destroy()`（store 层）+ `app.disposeSession(id)`（容器层）配合使用。

## 登出模式

```ts
import { HttpError } from "@zebra/core";
import { getSession } from "@zebra/session";

z.post("/logout", async (req) => {
  const s = getSession(req);
  if (!s) throw new HttpError(401, "unauthorized", "No session");
  await s.destroy();
  // 响应自动带过期 Set-Cookie；store 记录已删，旧 cookie 无法复活会话
  return { ok: true };
});
```

## WebSocket 会话

`sessionMiddleware` 返回的 `.wsSession` 钩子会在 ws 升级时把连接级会话句柄挂到 `ws.data.session`（匿名连接为 `undefined`，升级响应无法回发 Set-Cookie，所以不伪造新会话）。ws 里没有 HTTP 响应路径的自动持久化，写入需显式 `await session.flush()`。详见 [WebSocket 章节](10-websockets.md)。

## 下一步

- [会话作用域 DI 的协同](03-di.md#session-作用域)
- [Redis 后端 store](14-redis.md)
- [WebSocket 里的会话](10-websockets.md)
