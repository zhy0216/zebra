// Zebra ↔ Better Auth 集成中间件。
//
// Better Auth 的核心入口就是 Web Standard 的 `auth.handler(request: Request)`,
// 而 Zebra 中间件的签名是 `(req, next) => Promise<Response>`,其中
// `req.raw` 是底层 Request、`req.url` 是解析好的 URL。因此集成不需要任何
// 适配层: 把 `/api/auth/*` 的请求短路转发给 `auth.handler(req.raw)`,其余
// 请求继续走 Zebra 自己的路由/中间件链即可。
//
//   const app = new Zebra();
//   app.use(betterAuthMiddleware(auth));
//   app.get("/me", ...);   // 非 /api/auth 路径仍由 Zebra 处理
//
// 注意:
// - 该中间件要注册在其它全局中间件之前,避免 CORS / body 解析等先消费请求。
// - Better Auth 自管会话 cookie 和 CORS(见其 `cors` 配置),不要与
//   `@zebra/session` 的 sid cookie 混用做认证(两者是两套独立的会话体系)。

import type { Auth } from "better-auth";
import type { Middleware } from "zebra";
import { HttpError } from "zebra";

/** Zebra middleware 拿到的请求,结构上只需 raw + url 两个字段。 */
interface AuthRequestLike {
  raw: Request;
  url: URL;
}

const DEFAULT_BASE_PATH = "/api/auth";

export interface BetterAuthMiddlewareOptions {
  /** Better Auth 独占的 URL 前缀,默认 `/api/auth`。 */
  basePath?: string;
}

export type BetterAuthMiddleware = Middleware & {
  readonly basePath: string;
};

/**
 * 把 `basePath` 前缀下的所有请求交给 Better Auth 的 `auth.handler` 处理,
 * 其余请求放行到 Zebra 路由。注册一次即可挂载完整的 Better Auth API
 * (sign-up / sign-in / sign-out / get-session / social 回调……)。
 */
export function betterAuthMiddleware(
  auth: Auth<any>,
  options: BetterAuthMiddlewareOptions = {},
): BetterAuthMiddleware {
  const basePath = options.basePath ?? DEFAULT_BASE_PATH;
  const mw: Middleware = async (req, next) => {
    const { pathname } = req.url;
    if (pathname === basePath || pathname.startsWith(`${basePath}/`)) {
      return auth.handler(req.raw);
    }
    return next();
  };
  return Object.assign(mw, { basePath });
}

/**
 * 服务端读取当前请求的 Better Auth 会话(用户已登录)。返回 `null` 表示匿名。
 * 基于 `auth.api.getSession`,不产生额外 cookie 写入。
 */
export async function getBetterSession(auth: Auth<any>, req: AuthRequestLike) {
  return auth.api.getSession({ headers: req.raw.headers });
}

/**
 * 路由守卫: 未登录直接抛 401(Problem+Json),已登录放行到 `next()`。
 * 适合挂在 `app.group()` 上统一保护一组路由:
 *
 *   app.group("/account", (g) => {
 *     g.use(requireBetterAuth(auth));
 *     g.get("/me", async (req) => (await getBetterSession(auth, req))!.user);
 *   });
 */
export function requireBetterAuth(auth: Auth<any>): Middleware {
  return async (req, next) => {
    const session = await auth.api.getSession({ headers: req.raw.headers });
    if (session === null) {
      throw new HttpError(401, "unauthorized", "Not signed in");
    }
    return next();
  };
}
