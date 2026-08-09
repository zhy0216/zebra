import { describe, expect, test } from "bun:test";
import { buildApp } from "../src/app.ts";

// ---------------------------------------------------------------------------
// 集成测试驱动真实组合根 (buildApp) 走 app.dispatch() —— 与线上服务器完全一致
// 的中间件链,只是不占端口。会话 cookie 从响应的 Set-Cookie 中取出后在请求间
// 传递,模拟浏览器行为。
// ---------------------------------------------------------------------------

async function buildTestApp() {
  const app = await buildApp({ secret: "test-secret-0123456789abcdef0123456789" });
  const request = async (path: string, init: RequestInit = {}) =>
    app.dispatch(new Request(`http://test.local${path}`, init));
  return { app, request };
}

/** 从响应中取会话 cookie(排除空值和 Expires 过期项)。 */
function sessionCookieOf(res: Response): string | null {
  const parts = res.headers
    .getSetCookie()
    .map((c) => c.split(";")[0]!)
    .filter((kv) => kv.split("=")[1] !== "");
  return parts.length > 0 ? parts.join("; ") : null;
}

const SIGN_UP = (email: string) =>
  JSON.stringify({ email, password: "hunter2hunter2", name: "Ada" });

describe("better-auth integration", () => {
  test("非 /api/auth 路径仍由 Zebra 路由处理", async () => {
    const { request } = await buildTestApp();
    const res = await request("/");
    expect(res.status).toBe(200);
    expect(await res.text()).toContain("better-auth");
  });

  test("注册 → /account/me 拿到用户 → 登出 → 401 完整链路", async () => {
    const { request } = await buildTestApp();

    // 1. 匿名访问受保护路由 → 401 (Problem+Json)
    const anon = await request("/account/me");
    expect(anon.status).toBe(401);

    // 2. 注册(自动登录,响应带会话 cookie)
    const signUp = await request("/api/auth/sign-up/email", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: SIGN_UP("ada@example.com"),
    });
    expect(signUp.status).toBe(200);
    const cookie = sessionCookieOf(signUp);
    expect(cookie).not.toBeNull();
    expect(cookie).toContain("better-auth.session_token");

    const authed = { headers: { cookie: cookie! } };

    // 3. 带 cookie 访问受保护路由 → 200 + 用户信息
    const me = await request("/account/me", authed);
    expect(me.status).toBe(200);
    const body = (await me.json()) as { user: { email: string } };
    expect(body.user.email).toBe("ada@example.com");

    // 4. better-auth 自身的 get-session 端点同样可用
    const getSession = await request("/api/auth/get-session", authed);
    expect(getSession.status).toBe(200);
    const sessionBody = (await getSession.json()) as { user: { email: string } };
    expect(sessionBody.user.email).toBe("ada@example.com");

    // 5. 登出后 cookie 被清除,受保护路由回到 401
    const signOut = await request("/api/auth/sign-out", {
      method: "POST",
      headers: { cookie: cookie! },
    });
    expect(signOut.status).toBe(200);
    // 登出响应的 Set-Cookie 把 session cookie 置空并带上过期时间
    expect(signOut.headers.get("set-cookie")).toContain("better-auth.session_token=");
    const meAfter = await request("/account/me");
    expect(meAfter.status).toBe(401);
  });

  test("错误密码登录 → 401 INVALID_EMAIL_OR_PASSWORD", async () => {
    const { request } = await buildTestApp();

    await request("/api/auth/sign-up/email", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: SIGN_UP("grace@example.com"),
    });

    const res = await request("/api/auth/sign-in/email", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ email: "grace@example.com", password: "wrong-password" }),
    });
    expect(res.status).toBe(401);
    const body = (await res.json()) as { code?: string };
    expect(body.code).toBe("INVALID_EMAIL_OR_PASSWORD");
  });
});
