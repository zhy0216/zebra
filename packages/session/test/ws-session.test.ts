// C4: session scope 集成 —— session 包侧端到端。
//
// `mw.wsSession` 是 core `ZebraOptions.session.wsSession` 的默认实现：core 在升级
// 请求上经 resolver 解析出存活 sessionId 后回调，本包用 store 构造可读写的
// `RequestSession` 挂到 `ws.data.session`。覆盖：
// - HTTP 登录写入的数据可在 ws open 里经 `data.session` 读回（id 一致）；
// - 匿名 ws 连接（无 cookie）→ `data.session` 为 undefined。

import "reflect-metadata";
import { expect, test } from "bun:test";
import type { ZebraRequest } from "@zebra/core";
import { Zebra } from "@zebra/core";

import { MemoryStore, getSession, sessionMiddleware, verify } from "../src/index.ts";
import type { RequestSession } from "../src/session.ts";

const SECRET = "test-secret";

/** Extracts the raw `sid=...` cookie from a Set-Cookie header. */
function extractCookie(res: Response): string {
  return res.headers.get("set-cookie")!.split(";")[0]!;
}

function connectAndWait(port: number, path: string, headers?: Record<string, string>) {
  const ws = new WebSocket(`ws://localhost:${port}${path}`, headers ? { headers } : undefined);
  return {
    ws,
    closed: new Promise<void>((resolve, reject) => {
      ws.onerror = () => reject(new Error("ws connection failed"));
      ws.onclose = () => resolve();
      setTimeout(() => reject(new Error("timeout waiting for ws close")), 3000);
    }),
  };
}

test("ws.data.session is a live RequestSession: reads data written over HTTP with the same id", async () => {
  const mw = sessionMiddleware({ secret: SECRET, store: new MemoryStore({ ttl: 30_000 }) });
  const app = new Zebra({ session: { resolver: mw.resolver, wsSession: mw.wsSession } });
  app.use(mw);
  app.post("/login", async (req: ZebraRequest) => {
    const s = getSession(req)!;
    await s.set("user", { id: 42 });
    return { ok: true };
  });
  const opened: { value: { sid: string | undefined; user: unknown } | null } = { value: null };
  app.ws("/chat/:room", {
    open(ws, data) {
      const s = data.session as RequestSession | undefined;
      void (async () => {
        opened.value = { sid: s?.id, user: s === undefined ? undefined : await s.get("user") };
        ws.close();
      })();
    },
  });
  const { port } = await app.listen({ port: 0 });
  try {
    const login = await fetch(`http://localhost:${port}/login`, { method: "POST" });
    const cookie = extractCookie(login);
    const sid = verify(cookie.slice("sid=".length), SECRET)!;

    await connectAndWait(port, "/chat/lobby", { cookie }).closed;
    for (let i = 0; i < 50 && opened.value === null; i++) await Bun.sleep(10);
    expect(opened.value).toEqual({ sid, user: { id: 42 } });
  } finally {
    void app.stop(); // C1 模式：连接关闭后 server.stop(false) 仍会等待 socket 收尾（Bun 行为），不 await。
  }
});

test("anonymous ws connection: no cookie → data.session is undefined", async () => {
  const mw = sessionMiddleware({ secret: SECRET, store: new MemoryStore({ ttl: 30_000 }) });
  const app = new Zebra({ session: { resolver: mw.resolver, wsSession: mw.wsSession } });
  app.use(mw);
  let openedSession: unknown = "sentinel";
  app.ws("/chat", {
    open(ws, data) {
      openedSession = data.session;
      ws.close();
    },
  });
  const { port } = await app.listen({ port: 0 });
  try {
    await connectAndWait(port, "/chat").closed;
    for (let i = 0; i < 50 && openedSession === "sentinel"; i++) await Bun.sleep(10);
    expect(openedSession).toBeUndefined();
  } finally {
    void app.stop(); // C1 模式：连接关闭后 server.stop(false) 仍会等待 socket 收尾（Bun 行为），不 await。
  }
});
