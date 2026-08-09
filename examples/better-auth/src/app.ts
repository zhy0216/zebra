// 组合根: 把 Better Auth 挂进 Zebra 中间件链,并演示两种读取会话的方式
// (handler 内直接查 / group 守卫中间件)。

import { Zebra } from "zebra";
import { type AuthOptions, createAuth } from "./auth.ts";
import {
  betterAuthMiddleware,
  getBetterSession,
  requireBetterAuth,
} from "./betterAuthMiddleware.ts";

export interface AppOptions extends AuthOptions {}

export async function buildApp(opts: AppOptions = {}): Promise<Zebra> {
  const { auth } = await createAuth(opts);

  const app = new Zebra();

  // --- Better Auth 接管 /api/auth/* --------------------------------------
  // 必须在其它全局中间件之前注册。
  app.use(betterAuthMiddleware(auth));

  // --- 公开路由 -----------------------------------------------------------
  app.get(
    "/",
    async () =>
      new Response(
        [
          "better-auth + zebra",
          "",
          "POST /api/auth/sign-up/email { email, password, name }",
          "POST /api/auth/sign-in/email { email, password }",
          "GET  /api/auth/get-session",
          "POST /api/auth/sign-out",
          "",
          "GET /account/me   — 受保护,未登录返回 401",
        ].join("\n"),
        { headers: { "content-type": "text/plain; charset=utf-8" } },
      ),
  );

  // --- 受保护路由: group 守卫中间件(未登录 401,已登录拿到 session.user) --
  app.group("/account", (g) => {
    g.use(requireBetterAuth(auth));
    g.get("/me", async (req) => {
      const session = await getBetterSession(auth, req);
      return { user: session!.user, sessionId: session!.session.id };
    });
  });

  return app;
}
