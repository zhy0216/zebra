// C4: session scope 集成 —— core 侧。
//
// 依赖方向约束：core 不依赖 @zebra/session，`ws.data.session` 由构造期传入的
// `ZebraOptions.session.wsSession` 钩子填充。本文件用内联钩子验证：
// - resolver 解析出的 sessionId 传给钩子，结果挂到 ws.data.session（open/message 可达）；
// - 匿名升级 → 钩子收到 undefined，data.session 保持 undefined；
// - 无 session 配置 → data.session 为 undefined，升级与消息处理不报错；
// - 钩子结果与 upgrade() 返回数据并存，session 为保留字段（upgrade 同名键被覆盖）。

import "reflect-metadata";
import { expect, test } from "bun:test";
import { Zebra } from "../../src/app/app.ts";
import type { SessionOptions } from "../../src/app/types.ts";
import { Container } from "../../src/di/container.ts";
import type { WsData } from "../../src/ws/types.ts";

function startApp(session?: SessionOptions) {
  return new Zebra({ container: new Container(), ...(session ? { session } : {}) });
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

const sidResolver = (req: Request) => req.headers.get("x-sid") ?? undefined;

test("session.wsSession hook fills ws.data.session from the resolver's sessionId, reachable in open and message", async () => {
  const sessions: unknown[] = [];
  const app = startApp({
    resolver: sidResolver,
    wsSession: (req, sessionId) =>
      sessionId === undefined ? undefined : { id: sessionId, from: "wsSession" },
  });
  app.ws("/chat/:room", {
    open(ws, data) {
      sessions.push(data.session);
    },
    message(ws, data, msg) {
      sessions.push(data.session);
      ws.send(`ok ${(data.session as { id: string }).id}:${msg}`);
    },
  });
  const { port } = await app.listen({ port: 0 });
  try {
    const ws = new WebSocket(`ws://localhost:${port}/chat/lobby`, {
      headers: { "x-sid": "sess-1" },
    });
    const replies: string[] = [];
    ws.onmessage = (e) => {
      replies.push(String(e.data));
      ws.close();
    };
    ws.onopen = () => ws.send("ping");
    await new Promise<void>((resolve, reject) => {
      ws.onerror = () => reject(new Error("ws connection failed"));
      ws.onclose = () => resolve();
      setTimeout(() => reject(new Error("timeout waiting for ws message")), 3000);
    });
    expect(sessions).toEqual([
      { id: "sess-1", from: "wsSession" },
      { id: "sess-1", from: "wsSession" },
    ]);
    expect(replies).toEqual(["ok sess-1:ping"]);
  } finally {
    void app.stop(); // C1 模式：连接关闭后 server.stop(false) 仍会等待 socket 收尾（Bun 行为），不 await。
  }
});

test("anonymous upgrade: wsSession receives undefined sessionId and data.session stays undefined", async () => {
  const hookSessionIds: (string | undefined)[] = [];
  let openedData: WsData | null = null;
  const app = startApp({
    resolver: sidResolver,
    wsSession: async (req, sessionId) => {
      hookSessionIds.push(sessionId);
      return undefined;
    },
  });
  app.ws("/chat", {
    open(ws, data) {
      openedData = data;
      ws.close();
    },
  });
  const { port } = await app.listen({ port: 0 });
  try {
    const { closed } = connectAndWait(port, "/chat");
    await closed;
    expect(hookSessionIds).toEqual([undefined]);
    expect(openedData).not.toBeNull();
    expect("session" in openedData!).toBe(false);
  } finally {
    void app.stop(); // C1 模式：连接关闭后 server.stop(false) 仍会等待 socket 收尾（Bun 行为），不 await。
  }
});

test("no session config: data.session is undefined and upgrade/message still work", async () => {
  const sessions: unknown[] = [];
  const app = startApp();
  app.ws("/chat", {
    open(ws, data) {
      sessions.push(data.session);
      ws.send("welcome");
    },
    message(ws, data, msg) {
      sessions.push(data.session);
      ws.send(`echo ${msg}`);
    },
  });
  const { port } = await app.listen({ port: 0 });
  try {
    const ws = new WebSocket(`ws://localhost:${port}/chat`);
    const replies: string[] = [];
    ws.onmessage = (e) => {
      replies.push(String(e.data));
      if (replies.length === 2) ws.close();
    };
    ws.onopen = () => ws.send("hi");
    await new Promise<void>((resolve, reject) => {
      ws.onerror = () => reject(new Error("ws connection failed"));
      ws.onclose = () => resolve();
      setTimeout(() => reject(new Error("timeout waiting for ws message")), 3000);
    });
    expect(sessions).toEqual([undefined, undefined]);
    expect(replies).toEqual(["welcome", "echo hi"]);
  } finally {
    void app.stop(); // C1 模式：连接关闭后 server.stop(false) 仍会等待 socket 收尾（Bun 行为），不 await。
  }
});

test("session is a reserved field: wsSession result wins over a session key in upgrade()'s return", async () => {
  let openedData: any = null;
  const app = startApp({
    resolver: sidResolver,
    wsSession: (req, sessionId) =>
      sessionId === undefined ? undefined : { id: sessionId, from: "wsSession" },
  });
  app.ws("/auth", {
    upgrade: (req) => ({ userId: "u1", session: "reserved-key" }),
    open(ws, data) {
      openedData = data;
      ws.close();
    },
  });
  const { port } = await app.listen({ port: 0 });
  try {
    const { closed } = connectAndWait(port, "/auth", { "x-sid": "sess-9" });
    await closed;
    expect(openedData.userId).toBe("u1");
    expect(openedData.session).toEqual({ id: "sess-9", from: "wsSession" });
  } finally {
    void app.stop(); // C1 模式：连接关闭后 server.stop(false) 仍会等待 socket 收尾（Bun 行为），不 await。
  }
});
