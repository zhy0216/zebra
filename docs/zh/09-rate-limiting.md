# 限流（@zebra-web/rate-limit）

`@zebra-web/rate-limit` 提供固定窗口限流中间件：按 key 计数（惰性窗口轮转、原子自增）、可插拔 `RateLimitStore`（内存默认）、429 Problem+Json 响应带 `X-RateLimit-*` / `Retry-After` 头。

## 安装

```sh
bun add @zebra-web/rate-limit
```

## 快速开始

```ts
import { Zebra } from "@zebra-web/core";
import { rateLimit } from "@zebra-web/rate-limit";

const app = new Zebra();

app.use(rateLimit({ windowMs: 60_000, max: 100 })); // 全局：每 IP 每分钟 100 次
```

key 默认是 socket 对端 IP（`req.ip`）；无 socket 的场景（如 `app.dispatch()` 测试）回退到共享的 `anonymous` key。

## 选项

```ts
interface RateLimitOptions {
  windowMs: number;                        // 窗口长度（毫秒），必填
  max: number;                             // 每 key 每窗口最大请求数，必填
  keyBy?: (req: ZebraRequest) => string | Promise<string>;
  store?: RateLimitStore;                  // 默认 MemoryStore({ windowMs })
  trustProxy?: boolean;                    // 默认 false
}
```

### 自定义 key：按用户限流

限流 key 不一定要是 IP。登录场景通常按用户（或会话）限流：

```ts
import { getSession } from "@zebra-web/session";

const writeLimit = rateLimit({
  windowMs: 60_000,
  max: 30,
  keyBy: async (req) => {
    const s = getSession(req);
    const userId = s === undefined ? undefined : await s.get("userId");
    return typeof userId === "number" ? `user:${userId}` : "anonymous";
  },
});

app.post("/api/posts", writeLimit, async (req) => { ... });
```

### trustProxy 与 x-forwarded-for

**安全警告**：`x-forwarded-for` 是客户端可伪造的。默认 `trustProxy: false` —— key 用真实 socket IP（`req.ip`，来自 Bun `requestIP`，永不从 header 推导）。

只有在**部署的边界代理（反向代理 / CDN / 负载均衡）会覆盖该 header** 时才开 `trustProxy: true`：

- 开启后取 `x-forwarded-for` 的最左项（客户端第一跳看到的对端地址）。
- 没有该 header 的请求共享 `anonymous` key，而不是豁免限流。

```ts
app.use(rateLimit({ windowMs: 60_000, max: 100, trustProxy: true }));
// 仅在确信代理会覆盖 x-forwarded-for 时使用
```

## 响应语义

### 超限（429）

超限时 `next()` 不会被调用，中间件抛出 `HttpError(429, "rate_limit_exceeded", ...)`，core 的错误中间件把它转成 Problem+Json：

```json
{
  "type": "https://errors.zebra.dev/rate_limit_exceeded",
  "status": 429,
  "title": "Too Many Requests",
  "detail": { "limit": 30, "retryAfterSeconds": 42 }
}
```

响应头：

| 头 | 含义 |
| --- | --- |
| `X-RateLimit-Limit` | 配置的 `max` |
| `X-RateLimit-Remaining` | `max - count`（下限 0；429 时为 0） |
| `X-RateLimit-Reset` | 窗口到期时间（epoch 秒） |
| `Retry-After` | 距窗口重置的秒数（向上取整，下限 1） |

### 未超限

handler 正常执行，响应在返回路径包装上 `X-RateLimit-*` 头。handler 抛出的错误原样传播（**不会被限流中间件吞掉**）——core 错误中间件仍能看到原始错误。

## 计数语义（固定窗口）

- 每个 key 每个窗口一个计数器；计数器与窗口轮转属于 store。
- **惰性窗口打开**：只有 `store.increment(key, windowMs)` 能开窗或轮转——没有全局定时器、没有后台扫描。
- **原子性**：单个 `increment` 调用内完成读-改-写，且不跨越 `await`——单线程事件循环下并发请求串行处理，无丢失更新，进程内 store 不需要锁或 CAS。
- 计数含当前请求：窗口内第一个请求 count = 1；`allowed` 是 `count <= max`，即窗口内第 `max+1` 个请求被拒。

## 底层原语

```ts
import { checkLimit, createLimiter } from "@zebra-web/rate-limit";

// 直接检查一个 key
const { allowed, count, remaining, resetAt } = await checkLimit(store, key, windowMs, max);

// 或绑定 store 的限流器
const limiter = createLimiter(store);
const result = await limiter.check(key, windowMs, max);
```

`RateLimitResult = { allowed, count, remaining, resetAt }`（`resetAt` 为 epoch 毫秒）。

## RateLimitStore 与默认实现

```ts
interface RateLimitStore {
  increment(key: string, windowMs: number): Promise<IncrementResult>; // { count, resetAt }
  reset(key: string): Promise<void>;
}
```

- `MemoryStore({ windowMs })` —— 默认，进程内 Map。
- 自建后端（Redis）实现该接口即可；`@zebra-web/redis` 已提供 `RedisRateLimitStore`（见 [Redis](14-redis.md)）。

## 门面导出

从 `@zebra-web/zebra` 门面导入时，`MemoryStore` 与 `RateLimitMemoryStore`（别名，避免与 session 包的 `MemoryStore` 冲突）：

```ts
import { checkLimit, createLimiter, RateLimitMemoryStore, rateLimit } from "@zebra-web/zebra";
```

## 下一步

- [Redis 后端限流 store](14-redis.md)
- [会话章节：按用户限流的 keyBy 依赖](07-sessions.md)
- [可观测性：429 的监控](13-observability.md)
