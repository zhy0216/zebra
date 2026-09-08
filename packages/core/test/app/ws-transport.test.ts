import { expect, spyOn, test } from "bun:test";
import { Zebra } from "../../src/index.ts";

test("a real listener enforces the payload limit before dispatch with Bun's native 1006 closure", async () => {
  const limit = 1024 * 1024;
  const options = {
    maxPayloadLength: limit,
    idleTimeout: 30,
    backpressureLimit: limit * 4,
    closeOnBackpressureLimit: true,
  };
  const consumed: number[] = [];
  let serverClose: { code: number; reason: string; readyState: number } | undefined;
  const app = new Zebra();
  app.ws("/binary", {
    upgrade: () => ({ userId: "u1" }),
    message(ws, data, payload) {
      expect(data.userId).toBe("u1");
      expect(Buffer.isBuffer(payload)).toBe(true);
      consumed.push(payload.length);
      ws.send(String(payload.length));
    },
    close(ws, _data, code, reason) {
      serverClose = { code, reason, readyState: ws.readyState };
    },
  });
  const serve = spyOn(Bun, "serve");
  const { port } = await app.listen({ port: 0, websocket: options });
  const result = serve.mock.results[0]!;
  if (result.type !== "return") throw new Error("listener missing");
  const ws = new WebSocket(`ws://127.0.0.1:${port}/binary`);
  const replies: string[] = [];
  try {
    expect(serve.mock.calls[0]![0].websocket).toMatchObject(options);
    const clientClose = await new Promise<{ code: number; wasClean: boolean }>(
      (resolve, reject) => {
        const timer = setTimeout(() => {
          ws.terminate();
          reject(new Error("oversize close timed out"));
        }, 3000);
        ws.onopen = () => ws.send(new Uint8Array(limit));
        ws.onmessage = (event) => {
          replies.push(String(event.data));
          ws.send(new Uint8Array(limit + 1));
        };
        ws.onclose = (event) => {
          clearTimeout(timer);
          resolve({ code: event.code, wasClean: event.wasClean });
        };
        ws.onerror = () => {
          clearTimeout(timer);
          reject(new Error("WebSocket error"));
        };
      },
    );
    expect(replies).toEqual([String(limit)]);
    expect(consumed).toEqual([limit]);
    // Bun 1.4.2 (current stable on 2026-09-08) force-closes before message
    // dispatch. Keep the 1 MiB transport cap; no 1009 close frame is sent.
    expect(clientClose).toEqual({ code: 1006, wasClean: false });
    expect(serverClose).toEqual({ code: 1006, reason: "Received too big message", readyState: 3 });
  } finally {
    ws.terminate();
    serve.mockRestore();
    await result.value.stop(true);
    await app.stop();
  }
});
