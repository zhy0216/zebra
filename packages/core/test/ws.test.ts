// C5: ws 端到端测试补缺口。C1–C4 已在 app/ws.test.ts、ws-session.test.ts 覆盖
// 大部分行为，本文件只补三处缺口：
// - 升级成功显式断言原始握手响应 101（Bun WebSocket 客户端不暴露状态码，用
//   手工握手请求断言）+ open 触发；
// - close 的服务端资源清理：close 回调恰好触发一次、服务端 socket 进入 CLOSED；
// - HTTP 与 ws 路由同一 app 共存互不干扰的端到端验证（双向都走真实服务器）。

import "reflect-metadata";
import { expect, test } from "bun:test";
import { Zebra } from "../src/app/app.ts";
import { Container } from "../src/di/container.ts";

function startApp(fn: (app: Zebra) => void) {
  const app = new Zebra({ container: new Container() });
  fn(app);
  return app;
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

test("upgrade handshake returns 101 and fires open", async () => {
  let opened = false;
  let closed = 0;
  const app = startApp((a) =>
    a.ws("/chat/:room", {
      open() {
        opened = true;
      },
      close() {
        closed++;
      },
    }),
  );
  const { port } = await app.listen({ port: 0 });
  try {
    // Bun 的 WebSocket 客户端不暴露握手状态码，这里用手工握手请求断言原始 101 响应。
    const handshake = await new Promise<string>((resolve, reject) => {
      Bun.connect({
        hostname: "localhost",
        port,
        socket: {
          open(sock) {
            sock.write(
              "GET /chat/lobby HTTP/1.1\r\n" +
                `Host: localhost:${port}\r\n` +
                "Upgrade: websocket\r\n" +
                "Connection: Upgrade\r\n" +
                "Sec-WebSocket-Key: dGhlIHNhbXBsZSBub25jZQ==\r\n" +
                "Sec-WebSocket-Version: 13\r\n\r\n",
            );
          },
          data(sock, data) {
            const text = data.toString();
            sock.close();
            resolve(text);
          },
          error(sock, err) {
            sock.close();
            reject(err);
          },
        },
      });
    });
    expect(handshake).toMatch(/^HTTP\/1\.1 101 Switching Protocols/);
    expect(handshake.toLowerCase()).toContain("upgrade: websocket");
    for (let i = 0; i < 50 && closed === 0; i++) await Bun.sleep(10);
    expect(opened).toBe(true);
    expect(closed).toBe(1);
  } finally {
    void app.stop();
  }
});

test("close cleanup: close fires exactly once and the server-side socket reaches CLOSED", async () => {
  let closeCount = 0;
  let serverSocket: any = null;
  const app = startApp((a) =>
    a.ws("/chat", {
      open(ws) {
        serverSocket = ws;
      },
      close() {
        closeCount++;
      },
    }),
  );
  const { port } = await app.listen({ port: 0 });
  try {
    const { ws } = connectAndWait(port, "/chat");
    ws.onopen = () => ws.close(1000, "done");
    await new Promise<void>((resolve, reject) => {
      ws.onerror = () => reject(new Error("ws connection failed"));
      ws.onclose = () => resolve();
      setTimeout(() => reject(new Error("timeout waiting for ws close")), 3000);
    });
    for (let i = 0; i < 50 && closeCount === 0; i++) await Bun.sleep(10);
    expect(closeCount).toBe(1);
    expect(serverSocket.readyState).toBe(3); // WebSocket.CLOSED：连接已完全回收
  } finally {
    void app.stop();
  }
});

test("HTTP and ws routes coexist on one app without interfering end-to-end", async () => {
  const app = startApp((a) => {
    a.ws("/chat/:room", {
      open(ws, data) {
        ws.send(`welcome to ${data.params.room}`);
      },
      message(ws, data, msg) {
        ws.send(`echo ${data.params.room}:${msg}`);
      },
    });
    a.get("/hello/:name", async (req) => new Response(`hi ${req.params.name}`));
  });
  const { port } = await app.listen({ port: 0 });
  try {
    const http = await fetch(`http://localhost:${port}/hello/yang`);
    expect(http.status).toBe(200);
    expect(await http.text()).toBe("hi yang");

    const ws = new WebSocket(`ws://localhost:${port}/chat/lobby`);
    const messages: string[] = [];
    ws.onmessage = (e) => {
      messages.push(String(e.data));
      if (messages.length === 2) ws.close();
    };
    ws.onopen = () => ws.send("ping");
    await new Promise<void>((resolve, reject) => {
      ws.onerror = () => reject(new Error("ws connection failed"));
      ws.onclose = () => resolve();
      setTimeout(() => reject(new Error("timeout waiting for ws messages")), 3000);
    });
    expect(messages).toEqual(["welcome to lobby", "echo lobby:ping"]);
  } finally {
    void app.stop();
  }
});
