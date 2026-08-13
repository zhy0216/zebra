import "reflect-metadata";
import { expect, test } from "bun:test";
import { Zebra } from "../../src/app/app.ts";
import { Container } from "../../src/di/container.ts";
import { injectable } from "../../src/di/decorators.ts";
import type { WsData } from "../../src/ws/types.ts";

function startApp(fn: (app: Zebra) => void) {
  const app = new Zebra({ container: new Container() });
  fn(app);
  return app;
}

@injectable()
class AuthService {
  fromRequest(req: Request) {
    return req.headers.get("authorization") === "Bearer secret" ? { id: "u1" } : null;
  }
}

/** Headers of a well-formed handshake — required for the upgrade hooks to run
 * (see the pre-validation gate); plain `Upgrade: websocket` alone is rejected. */
const HANDSHAKE_HEADERS = {
  Upgrade: "websocket",
  "Sec-WebSocket-Key": "dGhlIHNhbXBsZSBub25jZQ==",
  "Sec-WebSocket-Version": "13",
};

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

test("app.ws rejects paths without a leading slash", () => {
  const app = startApp(() => {});
  expect(() => app.ws("chat", {})).toThrow(/must start with "\/"/);
});

test("app.ws rejects duplicate paths", () => {
  const app = startApp(() => {});
  app.ws("/chat", {});
  expect(() => app.ws("/chat", {})).toThrow(/Duplicate route/);
});

test("app.ws rejects registration after listen", async () => {
  const app = startApp((a) => a.ws("/chat", {}));
  await app.listen({ port: 0 });
  try {
    expect(() => app.ws("/later", {})).toThrow(/Cannot register ws routes/);
  } finally {
    await app.stop();
  }
});

test("upgrade to a registered ws path succeeds", async () => {
  let opened = false;
  let openedData: any = null;
  let closed = false;
  const app = startApp((a) =>
    a.ws("/chat/:room", {
      open(ws, data) {
        opened = true;
        openedData = data;
        ws.send(`welcome to ${data.params.room}`);
      },
      message(ws, data, msg) {
        ws.send(`echo ${data.params.room}:${msg}`);
      },
      close() {
        closed = true;
      },
    }),
  );
  const { port } = await app.listen({ port: 0 });

  const ws = new WebSocket(`ws://localhost:${port}/chat/lobby`);
  const messages: string[] = [];
  ws.onmessage = (e) => {
    messages.push(String(e.data));
    if (messages.length === 2) {
      ws.close();
      void app.stop();
    }
  };
  ws.onopen = () => ws.send("ping");
  await new Promise<void>((resolve, reject) => {
    ws.onerror = () => reject(new Error("ws connection failed"));
    ws.onclose = () => resolve();
    setTimeout(() => reject(new Error("timeout waiting for ws message")), 3000);
  });
  expect(opened).toBe(true);
  expect(openedData.params).toEqual({ room: "lobby" });
  expect(messages).toEqual(["welcome to lobby", "echo lobby:ping"]);
  for (let i = 0; i < 50 && !closed; i++) await Bun.sleep(10);
  expect(closed).toBe(true);
});

test("upgrade data is readable and typed inside the message handler", async () => {
  const seen: string[] = [];
  const app = startApp((a) => {
    a.injectSingleton(AuthService);
    a.ws("/auth/:room", {
      onUpgrade: { auth: AuthService },
      async upgrade(req, { auth }) {
        const u = auth.fromRequest(req.raw);
        return u ? { userId: u.id } : false;
      },
      message(ws, data, msg) {
        seen.push(`${data.userId}:${data.params.room}:${msg}`);
        ws.send(`ok ${data.userId}`);
      },
    });
  });
  const { port } = await app.listen({ port: 0 });

  const ws = new WebSocket(`ws://localhost:${port}/auth/lobby`, {
    headers: { Authorization: "Bearer secret" },
  });
  const replies: string[] = [];
  ws.onmessage = (e) => {
    replies.push(String(e.data));
    ws.close();
  };
  ws.onopen = () => ws.send("hello");
  await new Promise<void>((resolve, reject) => {
    ws.onerror = () => reject(new Error("ws connection failed"));
    ws.onclose = () => resolve();
    setTimeout(() => reject(new Error("timeout waiting for ws message")), 3000);
  });
  expect(seen).toEqual(["u1:lobby:hello"]);
  expect(replies).toEqual(["ok u1"]);
  void app.stop();
});

test("close handler receives close code and reason from the client", async () => {
  let closeCode = -1;
  let closeReason = "";
  const app = startApp((a) =>
    a.ws("/chat", {
      close(ws, _data, code, reason) {
        closeCode = code;
        closeReason = reason;
      },
    }),
  );
  const { port } = await app.listen({ port: 0 });
  try {
    const ws = new WebSocket(`ws://localhost:${port}/chat`);
    ws.onopen = () => ws.close(4001, "bye");
    await new Promise<void>((resolve, reject) => {
      ws.onerror = () => reject(new Error("ws connection failed"));
      ws.onclose = () => resolve();
      setTimeout(() => reject(new Error("timeout waiting for ws close")), 3000);
    });
    for (let i = 0; i < 50 && (closeCode === -1 || closeReason === ""); i++) {
      await Bun.sleep(10);
    }
    expect(closeCode).toBe(4001);
    expect(closeReason).toBe("bye");
  } finally {
    void app.stop();
  }
});

test("unregistered ws path returns 404 and does not open", async () => {
  const app = startApp((a) => a.ws("/chat", {}));
  const { port } = await app.listen({ port: 0 });
  try {
    const res = await fetch(`http://localhost:${port}/nowhere`, {
      headers: { Upgrade: "websocket" },
    });
    expect(res.status).toBe(404);
    expect(res.headers.get("content-type")).toContain("application/problem+json");
  } finally {
    await app.stop();
  }
});

test("request without upgrade header is handled as normal HTTP", async () => {
  const app = startApp((a) => {
    a.ws("/chat", {});
    a.get("/hello", async () => new Response("hi"));
  });
  const { port } = await app.listen({ port: 0 });
  try {
    const res = await fetch(`http://localhost:${port}/hello`);
    expect(res.status).toBe(200);
    expect(await res.text()).toBe("hi");
  } finally {
    await app.stop();
  }
});

test("ws registration does not affect existing HTTP dispatch", async () => {
  const app = startApp((a) => {
    a.ws("/chat", {});
    a.get("/hello/:name", async (req) => new Response(`hi ${req.params.name}`));
  });
  const res = await app.dispatch(new Request("http://x/hello/yang"));
  expect(res.status).toBe(200);
  expect(await res.text()).toBe("hi yang");
});

test("onUpgrade deps resolve from DI and upgrade() result lands on ws.data", async () => {
  let openedData: WsData | null = null;
  const app = startApp((a) => {
    a.injectSingleton(AuthService);
    a.ws("/auth/:room", {
      onUpgrade: { auth: AuthService },
      async upgrade(req, { auth }) {
        const u = auth.fromRequest(req.raw);
        return u ? { userId: u.id, upgradeTs: 123 } : false;
      },
      open(ws, data) {
        openedData = data;
        ws.close();
      },
    });
  });
  const { port } = await app.listen({ port: 0 });
  try {
    const { closed } = connectAndWait(port, "/auth/lobby", { Authorization: "Bearer secret" });
    await closed;
    expect(openedData).not.toBeNull();
    expect(openedData!.params).toEqual({ room: "lobby" });
    expect(openedData!.userId).toBe("u1");
    expect(openedData!.upgradeTs).toBe(123);
  } finally {
    // C1 模式：连接关闭后 server.stop(false) 仍会等待 socket 收尾（Bun 行为），不 await。
    void app.stop();
  }
});

test("upgrade() returning false rejects with 401 problem+json", async () => {
  const app = startApp((a) => {
    a.injectSingleton(AuthService);
    a.ws("/auth", {
      onUpgrade: { auth: AuthService },
      upgrade: () => false,
    });
  });
  const { port } = await app.listen({ port: 0 });
  try {
    const res = await fetch(`http://localhost:${port}/auth`, {
      headers: HANDSHAKE_HEADERS,
    });
    expect(res.status).toBe(401);
    expect(res.headers.get("content-type")).toContain("application/problem+json");
    const body = (await res.json()) as Record<string, unknown>;
    expect(body.type).toBe("https://errors.zebra.dev/upgrade_rejected");
  } finally {
    await app.stop();
  }
});

test("upgrade() throwing is treated as internal error (500)", async () => {
  const app = startApp((a) => {
    a.injectSingleton(AuthService);
    a.ws("/boom", {
      onUpgrade: { auth: AuthService },
      upgrade: async () => {
        throw new Error("boom");
      },
    });
  });
  const { port } = await app.listen({ port: 0 });
  try {
    const res = await fetch(`http://localhost:${port}/boom`, {
      headers: HANDSHAKE_HEADERS,
    });
    expect(res.status).toBe(500);
    expect(res.headers.get("content-type")).toContain("application/problem+json");
    const body = (await res.json()) as Record<string, unknown>;
    expect(body.type).toBe("https://errors.zebra.dev/upgrade_error");
  } finally {
    await app.stop();
  }
});

test("a request with Upgrade but no handshake headers is rejected before hooks run", async () => {
  let upgrades = 0;
  const app = startApp((a) => {
    a.injectSingleton(AuthService);
    a.ws("/auth", {
      onUpgrade: { auth: AuthService },
      upgrade: () => {
        upgrades++;
        return {};
      },
    });
  });
  const { port } = await app.listen({ port: 0 });
  try {
    const res = await fetch(`http://localhost:${port}/auth`, {
      headers: { Upgrade: "websocket" },
    });
    expect(res.status).toBe(401);
    const body = (await res.json()) as Record<string, unknown>;
    expect(body.type).toBe("https://errors.zebra.dev/upgrade_failed");
    // The expensive upgrade decision (session resolution + DI + auth hook)
    // never ran for a request that can never upgrade.
    expect(upgrades).toBe(0);
  } finally {
    await app.stop();
  }
});

test("unbound onUpgrade dep is an internal error (500), not a client rejection", async () => {
  const app = startApp((a) =>
    a.ws("/unbound", {
      onUpgrade: { auth: AuthService },
      upgrade: () => ({}),
    }),
  );
  const { port } = await app.listen({ port: 0 });
  try {
    const res = await fetch(`http://localhost:${port}/unbound`, {
      headers: HANDSHAKE_HEADERS,
    });
    expect(res.status).toBe(500);
    const body = (await res.json()) as Record<string, unknown>;
    expect(body.type).toBe("https://errors.zebra.dev/upgrade_error");
  } finally {
    await app.stop();
  }
});

test("upgrade hook receives path params for path-based auth (room checks)", async () => {
  const allowedRooms: string[] = [];
  let opened: boolean = false;
  const app = startApp((a) => {
    a.ws("/chat/:room", {
      upgrade: async (_req, _deps, params) => {
        allowedRooms.push(params.room ?? "");
        // Room-based auth: only the "lobby" room may be joined.
        return params.room === "lobby" ? { room: params.room } : false;
      },
      open(ws, data) {
        opened = true;
        ws.send(`in ${data.room}`);
      },
    });
  });
  const { port } = await app.listen({ port: 0 });

  const ws = new WebSocket(`ws://localhost:${port}/chat/lobby`);
  const msg = await new Promise<string>((resolve, reject) => {
    ws.onmessage = (e) => resolve(String(e.data));
    ws.onerror = () => reject(new Error("ws error"));
  });
  ws.close();
  await Bun.sleep(30);
  expect(msg).toBe("in lobby");
  expect(allowedRooms).toEqual(["lobby"]);

  // Non-lobby rooms are rejected at the upgrade decision (401, no socket).
  const denied = await fetch(`http://localhost:${port}/chat/secret`, {
    headers: HANDSHAKE_HEADERS,
  });
  expect(denied.status).toBe(401);
  const body = (await denied.json()) as Record<string, unknown>;
  expect(body.type).toBe("https://errors.zebra.dev/upgrade_rejected");
  expect(allowedRooms).toEqual(["lobby", "secret"]);
  await app.stop();
});

test("ws route without upgrade hook upgrades directly with params only", async () => {
  let openedData: WsData | null = null;
  const app = startApp((a) =>
    a.ws("/plain/:room", {
      open(ws, data) {
        openedData = data;
        ws.close();
      },
    }),
  );
  const { port } = await app.listen({ port: 0 });
  try {
    const { closed } = connectAndWait(port, "/plain/lobby");
    await closed;
    expect(openedData).not.toBeNull();
    expect(openedData!.params).toEqual({ room: "lobby" });
    expect(Object.keys(openedData!)).toEqual(["params"]);
  } finally {
    void app.stop();
  }
});
