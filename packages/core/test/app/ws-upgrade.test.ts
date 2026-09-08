import { expect, spyOn, test } from "bun:test";
import { request } from "node:http";
import { Zebra, token, wsUpgrade } from "../../src/index.ts";
import { WS_HANDLER, type WsData } from "../../src/ws/types.ts";

function handshake(port: number, path: string, headers: Record<string, string> = {}) {
  return new Promise<{ status: number; headers: Headers; body: string }>((resolve, reject) => {
    const req = request({
      hostname: "127.0.0.1",
      port,
      path,
      headers: {
        Connection: "Upgrade",
        Upgrade: "websocket",
        "Sec-WebSocket-Key": "dGhlIHNhbXBsZSBub25jZQ==",
        "Sec-WebSocket-Version": "13",
        ...headers,
      },
    });
    const responseHeaders = (raw: string[]) => {
      const parsed = new Headers();
      for (let i = 0; i < raw.length; i += 2) parsed.append(raw[i]!, raw[i + 1]!);
      return parsed;
    };
    req.once("upgrade", (res, socket) => {
      socket.destroy();
      resolve({ status: res.statusCode!, headers: responseHeaders(res.rawHeaders), body: "" });
    });
    req.once("response", (res) => {
      const chunks: Buffer[] = [];
      res.on("data", (chunk) => chunks.push(Buffer.from(chunk)));
      res.once("error", reject);
      res.once("end", () =>
        resolve({
          status: res.statusCode!,
          headers: responseHeaders(res.rawHeaders),
          body: Buffer.concat(chunks).toString(),
        }),
      );
    });
    req.once("error", reject);
    req.setTimeout(3000, () => req.destroy(new Error("handshake timed out")));
    req.end();
  });
}

test.each([400, 403, 404, 503])(
  "Response rejection preserves HTTP %i, body and headers without upgrading or opening",
  async (status) => {
    const trace: string[] = [];
    const resource = token<{ dispose(): Promise<void> }>("upgrade resource");
    const app = new Zebra({ session: { wsSession: () => trace.push("session hook") } });
    app.injectFactoryRequest(resource, () => ({
      async dispose() {
        await Promise.resolve();
        trace.push("disposed");
      },
    }));
    const open = spyOn({ open() {} }, "open");
    app.ws("/rooms/:room", {
      onUpgrade: { resource },
      async upgrade(req, deps, params) {
        expect(deps.resource).toBeDefined();
        expect(req.params).toEqual(params);
        expect(params.room).toBe("lobby");
        trace.push("decision");
        return new Response(`refused ${status}`, {
          status,
          headers: { "x-rejection": "custom", "content-type": "text/custom", "retry-after": "7" },
        });
      },
      open,
    });
    const serve = spyOn(Bun, "serve");
    const { port } = await app.listen({ port: 0 });
    const result = serve.mock.results[0]!;
    if (result.type !== "return") throw new Error("listener missing");
    const upgrade = spyOn(result.value, "upgrade");
    try {
      const response = await handshake(port, "/rooms/lobby");
      expect(response.status).toBe(status);
      expect(response.body).toBe(`refused ${status}`);
      expect(response.headers.get("x-rejection")).toBe("custom");
      expect(response.headers.get("content-type")).toBe("text/custom");
      expect(response.headers.get("retry-after")).toBe("7");
      expect(upgrade).not.toHaveBeenCalled();
      expect(open).not.toHaveBeenCalled();
      expect(trace).toEqual(["decision", "disposed"]);
    } finally {
      upgrade.mockRestore();
      serve.mockRestore();
      await result.value.stop(true);
      await app.stop();
    }
  },
);

test.each(["plain", "wrapped"])(
  "%s upgrade data preserves ordinary control-like keys, reserved fields and scope disposal",
  async (kind) => {
    const trace: string[] = [];
    const resource = token<{ dispose(): Promise<void> }>("request");
    const anonymous = token<{ dispose(): Promise<void> }>("anonymous session");
    const app = new Zebra({
      session: { wsSession: () => ({ id: "verified" }) },
    });
    app.injectFactoryRequest(resource, () => ({
      async dispose() {
        trace.push("request disposed");
      },
    }));
    app.injectFactorySession(anonymous, () => ({
      async dispose() {
        trace.push("session disposed");
      },
    }));
    const userData = {
      userId: "u1",
      data: { nested: true },
      headers: { "x-ordinary-data": "not a response header" },
      type: "upgrade",
      params: { room: "spoofed" },
      session: "spoofed",
      [WS_HANDLER]: {
        open() {
          throw new Error("wrong route");
        },
      },
    };
    let openedData: WsData | undefined;
    app.ws("/rooms/:room", {
      onUpgrade: { resource, anonymous },
      upgrade: () => (kind === "plain" ? userData : wsUpgrade(userData)),
      open(_ws, data) {
        openedData = data;
        trace.push("open");
      },
    });
    const { port } = await app.listen({ port: 0 });
    try {
      const response = await handshake(port, "/rooms/lobby");
      expect(response.status).toBe(101);
      expect(response.headers.has("x-ordinary-data")).toBe(false);
      expect(openedData).toMatchObject({
        userId: "u1",
        data: userData.data,
        headers: userData.headers,
        type: "upgrade",
        params: { room: "lobby" },
        session: { id: "verified" },
      });
      expect(trace).toEqual(["request disposed", "session disposed", "open"]);
    } finally {
      await app.stop();
    }
  },
);

test.each(["record", "tuples", "Headers"])(
  "wsUpgrade accepts %s headers and negotiates a non-first offered subprotocol",
  async (form) => {
    const entries: [string, string][] = [
      ["Sec-WebSocket-Protocol", "chat-v1"],
      ["x-upgrade", "accepted"],
      ["set-cookie", "one=1; HttpOnly"],
      ["set-cookie", "two=2; HttpOnly"],
    ];
    const headers =
      form === "record"
        ? Object.fromEntries(entries)
        : form === "tuples"
          ? entries
          : new Headers(entries);
    const app = new Zebra();
    app.ws("/chat", { upgrade: () => wsUpgrade({ userId: "u1" }, { headers }) });
    const { port } = await app.listen({ port: 0 });
    try {
      const response = await handshake(port, "/chat", {
        "Sec-WebSocket-Protocol": "other, chat-v1",
      });
      expect(response.status).toBe(101);
      expect(response.headers.get("sec-websocket-protocol")).toBe("chat-v1");
      expect(response.headers.get("x-upgrade")).toBe("accepted");
      expect(response.headers.getSetCookie()).toEqual(
        form === "record" ? ["two=2; HttpOnly"] : ["one=1; HttpOnly", "two=2; HttpOnly"],
      );
      const ws = new WebSocket(`ws://127.0.0.1:${port}/chat`, ["other", "chat-v1"]);
      await new Promise<void>((resolve, reject) => {
        const timer = setTimeout(() => {
          ws.terminate();
          reject(new Error("timeout"));
        }, 3000);
        ws.onopen = () => ws.close();
        ws.onerror = () => {
          clearTimeout(timer);
          reject(new Error("connection failed"));
        };
        ws.onclose = () => {
          clearTimeout(timer);
          resolve();
        };
      });
      expect(ws.protocol).toBe("chat-v1");
    } finally {
      await app.stop();
    }
  },
);

test.each([undefined, "other", "CHAT-V1", "chat-v1, other"])(
  "an unoffered or invalid selection (%s) fails without upgrading and disposes the scope",
  async (offered) => {
    let disposed = 0;
    const resource = token<{ dispose(): void }>("request");
    const app = new Zebra();
    app.injectFactoryRequest(resource, () => ({
      dispose() {
        disposed++;
      },
    }));
    app.ws("/chat", {
      onUpgrade: { resource },
      upgrade: () =>
        wsUpgrade(
          {},
          {
            headers: {
              "sec-websocket-protocol": offered === "chat-v1, other" ? offered : "chat-v1",
            },
          },
        ),
      open() {
        throw new Error("must not open");
      },
    });
    const serve = spyOn(Bun, "serve");
    const { port } = await app.listen({ port: 0 });
    const result = serve.mock.results[0]!;
    if (result.type !== "return") throw new Error("listener missing");
    const upgrade = spyOn(result.value, "upgrade");
    try {
      const response = await handshake(
        port,
        "/chat",
        offered ? { "Sec-WebSocket-Protocol": offered } : {},
      );
      expect(response.status).toBe(500);
      expect(JSON.parse(response.body).type).toBe("https://errors.zebra.dev/upgrade_error");
      expect(response.headers.has("sec-websocket-protocol")).toBe(false);
      expect(upgrade).not.toHaveBeenCalled();
      expect(disposed).toBe(1);
    } finally {
      upgrade.mockRestore();
      serve.mockRestore();
      await app.stop();
    }
  },
);

test("omitted protocol headers retain Bun negotiation and never invent an unoffered protocol", async () => {
  const app = new Zebra();
  app.ws("/chat", { upgrade: () => wsUpgrade({}, { headers: { "x-upgrade": "yes" } }) });
  const { port } = await app.listen({ port: 0 });
  try {
    const legacy = await handshake(port, "/chat");
    expect(legacy.status).toBe(101);
    expect(legacy.headers.has("sec-websocket-protocol")).toBe(false);
    const offered = await handshake(port, "/chat", { "Sec-WebSocket-Protocol": "one, two" });
    expect(offered.status).toBe(101);
    expect(offered.headers.get("sec-websocket-protocol")).toBe("one");
  } finally {
    await app.stop();
  }
});

test.each(["false", "throw", "session throw", "dispose throw", "transport false"])(
  "%s retains its rejection semantics and releases request resources",
  async (mode) => {
    let disposed = 0;
    const resource = token<{ dispose(): Promise<void> }>("request");
    const app = new Zebra({
      session: {
        wsSession: () => {
          if (mode === "session throw") throw new Error("session failed");
        },
      },
    });
    app.injectFactoryRequest(resource, () => ({
      async dispose() {
        disposed++;
        if (mode === "dispose throw") throw new Error("cleanup failed");
      },
    }));
    app.ws("/chat", {
      onUpgrade: { resource },
      async upgrade() {
        if (mode === "throw") throw new Error("decision failed");
        if (mode === "false") return false;
        return wsUpgrade({ userId: "u1" });
      },
    });
    const serve = spyOn(Bun, "serve");
    const { port } = await app.listen({ port: 0 });
    const result = serve.mock.results[0]!;
    if (result.type !== "return") throw new Error("listener missing");
    const upgrade = spyOn(result.value, "upgrade").mockReturnValue(false);
    try {
      const response = await handshake(port, "/chat");
      const code =
        mode === "false"
          ? "upgrade_rejected"
          : mode === "transport false"
            ? "upgrade_failed"
            : "upgrade_error";
      expect(response.status).toBe(code === "upgrade_error" ? 500 : 401);
      expect(JSON.parse(response.body).type).toBe(`https://errors.zebra.dev/${code}`);
      expect(disposed).toBe(1);
      expect(upgrade).toHaveBeenCalledTimes(mode === "transport false" ? 1 : 0);
    } finally {
      upgrade.mockRestore();
      serve.mockRestore();
      await app.stop();
    }
  },
);
