# Redis 存储适配（@zebra/redis）

`@zebra/redis` 为 `@zebra/session` 与 `@zebra/rate-limit` 提供 Redis 后端 store。**零运行时依赖**：不绑定任何 Redis 客户端，只要求你传入的客户端实现一个极小的鸭子类型接口（`RedisLike`）——ioredis、node-redis、Bun.redis 都行。

## 安装

```sh
bun add @zebra/redis
```

## RedisLike 接口

store 只用到这些命令（签名对齐 ioredis 的可变参数形式）：

```ts
interface RedisLike {
  set(key, value, "PX", ms): Promise<unknown>;             // → "OK"
  set(key, value, "PX", ms, "NX"): Promise<unknown>;       // → "OK" | null（键已存在时 null）
  incr(key): Promise<number>;
  get(key): Promise<string | null>;
  del(...keys): Promise<unknown>;
  pexpire(key, ms): Promise<unknown>;
}
```

ioredis 直接可用。node-redis v4 的 `SET` 用选项对象（`{ PX, NX }`）而非可变参数形式，需要一个小适配器：

```ts
import { createClient } from "redis";

const client = createClient();
await client.connect();

const adapted = {
  ...client,
  set: (key, value, px, ms, nx) =>
    client.set(key, value, { PX: ms, ...(nx === "NX" ? { NX: true } : {}) }),
};
```

## RedisRateLimitStore

`RateLimitStore` 的 Redis 实现，语义与 `MemoryStore` 完全一致（固定窗口、惰性开窗、计数含当前请求）：

```ts
import { rateLimit } from "@zebra/rate-limit";
import { RedisRateLimitStore } from "@zebra/redis";

const store = new RedisRateLimitStore(redisClient, { prefix: "myapp:rl:" });

app.use(rateLimit({ windowMs: 60_000, max: 100, store }));
```

选项：`prefix`（默认 `zebra:rate-limit:`）、`now`（时钟覆盖，测试钩子）。

Key 布局：

```
{prefix}{key}        — 请求计数器（仅 INCR 推进）
{prefix}{key}:start  — 窗口起点（epoch ms，SET ... PX ... NX 每窗口只赢一次）
```

原子性设计：

- 窗口认领是单个 `SET key:start <now> PX windowMs NX`——每窗口至多一个请求赢下 NX，并发增量不可能开出两个窗口或对重置时间有分歧；新窗口以 count 1 创建。
- 计数器只用 `INCR` 推进（从不读-改-写），没有增量会丢，不需要 MULTI/EVAL。
- 每次 `INCR` 后跟 `PEXPIRE`，计数键永不泄漏。
- 已知边界竞态：恰好落在「认领」与「SET count 1」之间的 `INCR` 会计入上一窗口（窗口边界少算一个，固定窗口无 Lua 脚本的固有属性）。

## RedisSessionStore

`SessionStore` 的 Redis 实现：

```ts
import { sessionMiddleware } from "@zebra/session";
import { RedisSessionStore } from "@zebra/redis";

const store = new RedisSessionStore(redisClient, { ttl: 30 * 60 * 1000 });
const session = sessionMiddleware({ secret, store });
```

选项：`ttl`（必填，毫秒）、`prefix`（默认 `zebra:session:`）。

Key 布局（全部键带 Redis TTL，数据过期委托给 Redis `PX`，客户端无扫描）：

```
{prefix}{id}         — JSON 编码的会话数据
{prefix}{id}:tomb    — tombstone 标记，destroy 后保留 ttl
```

防复活（镜像 `MemoryStore` 契约）：

- `destroy` 删除数据键并写短 TTL tombstone；`get` / `set` / `touch` 把已 tombstone 的 id 视为缺失——在途请求永远无法复活已销毁会话。
- `get` 每次读都复查 tombstone，同时掩盖了竞态 `set` 留下的记录（它们随 TTL 过期）。
- 数据 JSON 编码，所以会话数据必须可 JSON 序列化（`@zebra/session` 持久化的东西都满足）；损坏的 payload 读作缺失，而不是每个请求都失败。

> 与 `MemoryStore` 的差异：`MemoryStore` 的检查-写入在同一段同步代码里，单进程内原子；跨 Redis 时 tombstone 检查与写入是两次往返，检查与写入之间可能插入并发 `destroy`。读者始终安全（`get` 复查 tombstone）；彻底关闭写窗口需要 Lua 脚本，刻意不在范围内（接口只讲普通命令）。

## 组合使用

```ts
const rateStore = new RedisRateLimitStore(redis);
const sessionStore = new RedisSessionStore(redis, { ttl: 30 * 60 * 1000 });

const session = sessionMiddleware({ secret, store: sessionStore });

const app = new Zebra({
  session: { resolver: session.resolver, wsSession: session.wsSession, ttl: 30 * 60 * 1000 },
});
app.use(session);
app.use(rateLimit({ windowMs: 60_000, max: 100, store: rateStore }));
```

多实例部署下，会话与限流计数都落在共享 Redis 上，而不是各实例各自计数。

## 下一步

- [会话：SessionStore 接口与持久化语义](07-sessions.md#sessionstore-接口与默认实现)
- [限流：RateLimitStore 接口与计数语义](09-rate-limiting.md#ratelimitstore-与默认实现)
