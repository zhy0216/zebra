# Better Auth 集成示例

把 [Better Auth](https://better-auth.com) 挂进 Zebra —— 不需要适配层,一个
中间件就够了:Better Auth 的核心入口是 Web Standard 的 `auth.handler(request)`,
Zebra 中间件把 `/api/auth/*` 的请求短路转发过去,其余请求继续走 Zebra 自己的
路由和中间件链。

## 运行

```sh
bun --filter example-better-auth start     # http://localhost:3003
bun --filter example-better-auth test      # 进程内集成测试 (app.dispatch)
```

## 组成

| 文件 | 作用 |
| --- | --- |
| `src/auth.ts` | `betterAuth` 实例 + 编程式建表 (`getMigrations`, 免 CLI) |
| `src/betterAuthMiddleware.ts` | **核心交付物**: `betterAuthMiddleware` / `getBetterSession` / `requireBetterAuth` |
| `src/app.ts` | 组合根: 挂中间件 + 受保护路由 (group 守卫) |
| `src/main.ts` | `listen` 入口 |
| `test/auth.test.ts` | 注册 → 受保护路由 → 登出 → 401 全链路测试 |

## 怎么用

```ts
import { Zebra } from "@zebra-web/zebra";
import { createAuth } from "./auth.ts";
import { betterAuthMiddleware, getBetterSession } from "./betterAuthMiddleware.ts";

const { auth } = await createAuth();
const app = new Zebra();

// 一行挂载完整 Better Auth API (sign-up / sign-in / sign-out / get-session…)
// 注意: 必须注册在其它全局中间件之前。
app.use(betterAuthMiddleware(auth));

// 受保护路由: 未登录 401,已登录拿到 session.user
app.get("/me", async (req) => {
  const session = await getBetterSession(auth, req);
  if (session === null) throw new HttpError(401, "unauthorized", "Not signed in");
  return { user: session.user };
});
```

三种辅助 (均在 `src/betterAuthMiddleware.ts`):

- `betterAuthMiddleware(auth, { basePath })` — 全局挂载,`basePath` 默认 `/api/auth`
- `getBetterSession(auth, req)` — 服务端读会话 (`auth.api.getSession`),返回 `null` 表示匿名
- `requireBetterAuth(auth)` — 守卫中间件,未登录抛 401;配合 `app.group()` 保护一组路由

## 注意

- **数据库**: 直接传 `bun:sqlite` 实例,Better Auth 的 kysely 适配器内置
  `BunSqliteDialect`,自动识别,零原生模块 (better-sqlite3 在 Bun 上有 NAPI
  兼容问题,勿用)。示例默认 `:memory:`,传 `dbPath` 可持久化到文件。
- **会话**: Better Auth 自管会话 cookie 和 CORS,不要与 `@zebra-web/session` 的
  `sid` cookie 混用做认证 —— 两者是两套独立的会话体系。
- **密钥**: `secret` 至少 32 字符,生产环境用环境变量 (如 `BETTER_AUTH_SECRET`)。
- **WebSocket**: upgrade 请求绕过全局中间件 (`app.ts` 的 `handleFetch` 先做
  upgrade 检测),所以 `app.ws()` 不受本中间件影响。
