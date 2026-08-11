# 中间件

中间件是 Zebra 请求管道的核心扩展点。Zebra 使用 Koa 风格的洋葱模型：中间件在 handler 之前运行，通过 `await next()` 把控制权交给链上的下一个中间件，返回后再执行「after」逻辑。

## 签名

```ts
type Middleware = (
  req: ZebraRequest,
  next: () => Promise<Response>,
  deps?: Record<string, unknown>, // 仅依赖感知中间件（middleware() 包装的）有值
) => Promise<Response>;
```

`req` 就是路由 handler 拿到的那个 `ZebraRequest`（同一次请求共享同一个对象，所以中间件可以通过 `req.ctx` 传递数据）。`next()` 返回下游最终产出的 `Response`，中间件可以包装它（改头、包 body）后返回，也可以直接短路返回自己的响应。

```ts
import type { Middleware } from "zebra";

const timing: Middleware = async (req, next) => {
  const start = performance.now();
  const res = await next();
  res.headers.set("x-timing-ms", String(performance.now() - start));
  return res;
};

z.use(timing);
```

## 注册方式

中间件有三层作用域，按注册顺序依次执行：

1. **全局** —— `app.use(mw)`，所有路由（除 ws upgrade）都经过。
2. **组级** —— `group` 内 `g.use(mw)`，仅该组路由。
3. **路由级** —— 路由 handler 的 `middlewares`（见契约实现 `{ middlewares, handler }` 形式，以及 `implement` 的 `opts.middlewares`）。

执行顺序：全局 → 祖先组 → 组 → 路由级。

> **注意**：WebSocket **升级请求**不经过 `app.use` 全局中间件（升级在组成链之前处理）。ws 的鉴权在 `upgrade` 钩子里做。

## 依赖感知的 `middleware()`

想让中间件声明 DI 依赖，用 `middleware(deps, fn)` 包装，第三个参数拿到解析好的依赖：

```ts
import { middleware } from "zebra";

const requireAuth = middleware({ session: AuthService }, async (req, next, { session }) => {
  const user = await session.userFrom(req);
  if (!user) throw new HttpError(401, "unauthorized", "Login required");
  req.ctx.set(USER_KEY, user);
  return next();
});
```

`getMiddlewareDeps(mw)` 可以读取中间件声明的依赖（框架内部用它做启动时校验与运行时解析）。声明了依赖的中间件需要走 request scope，代价是一次 Container 子作用域创建——但计划在启动时预编译，运行时只按预计算的下标包装需要解析的中间件。

## 通过 `req.ctx` 传递数据

`req.ctx` 是一个 `Map<symbol, unknown>`，同一次请求的中间件与 handler 共享。用符号键避免碰撞：

```ts
const USER_KEY = Symbol("zebra.user");

const attachUser = middleware({ auth: AuthService }, async (req, next, { auth }) => {
  req.ctx.set(USER_KEY, await auth.userFrom(req));
  return next();
});

// handler 里：
z.get("/me", async (req) => req.ctx.get(USER_KEY));
```

## 错误中间件（内置）

Zebra 自带错误中间件，是**管道最外层**的包装：

- 任何中间件/handler 抛出的错误都会被捕获，转换为 RFC 9457 Problem+Json 响应（`application/problem+json`）。
- `HttpError` 的 `headers`（比如 `Allow`、`Retry-After`）会被原样复制到响应头。
- `errors.exposeStack: true` 时，未知错误会在 body 里带 `stack` 字段。

```json
{
  "type": "https://errors.zebra.dev/not_found",
  "status": 404,
  "title": "No route for GET /nope",
  "instance": "/nope"
}
```

自定义错误处理：在 `app.use` 里注册你自己的错误中间件（必须在 `next()` 外层 catch），或者用 `@zebra/observability` 的 `errorReporter` 只做上报不改响应（见 [可观测性](13-observability.md)）。

## 约束与语义

- `next()` 只能调用一次；重复调用抛错。
- 中间件短路（不调用 `next()`）时返回的响应会直接成为最终响应——下游 handler 不会执行。
- 中间件在 `listen()` 前注册；之后注册抛错。
- 内置中间件包（`@zebra/session`、`@zebra/cors`、`@zebra/rate-limit`、`@zebra/observability`）都是普通 `Middleware`，直接 `app.use` 即可。

## 下一步

- [HTTP：ZebraRequest / 响应 / 错误](05-http.md)
- [Cookie 会话中间件](07-sessions.md)
- [CORS 中间件](08-cors.md)
- [限流中间件](09-rate-limiting.md)
