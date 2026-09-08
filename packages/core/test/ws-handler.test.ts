import { expect, spyOn, test } from "bun:test";
import type { ServerWebSocket } from "bun";
import { buildBunWebSocketHandler, buildWsData } from "../src/ws/handler.ts";
import type { WsData, WsHandler } from "../src/ws/types.ts";

test("transport options cannot replace any callback or inject connection data, even from JS", async () => {
  const calls: unknown[][] = [];
  const route: WsHandler<any, any> = {};
  const poison = () => {
    throw new Error("transport replaced route dispatch");
  };
  const options = {
    maxPayloadLength: 1024,
    idleTimeout: 0,
    backpressureLimit: 0,
    closeOnBackpressureLimit: false,
    data: { wrong: true },
    open: poison,
    message: poison,
    close: poison,
    drain: poison,
    ping: poison,
    pong: poison,
    error: poison,
  };
  const handler = buildBunWebSocketHandler(options);
  const data = buildWsData(route, { room: "lobby" });
  const ws = { data } as ServerWebSocket<WsData>;
  const payload = Buffer.from("ping");
  const names = ["open", "message", "close", "drain", "ping", "pong"] as const;
  for (const name of names)
    route[name] = (...args: unknown[]) => {
      calls.push([name, ...args]);
    };
  handler.open!(ws);
  handler.message(ws, "hello");
  handler.close!(ws, 1000, "done");
  handler.drain!(ws);
  handler.ping!(ws, payload);
  handler.pong!(ws, payload);
  expect(calls).toEqual([
    ["open", ws, data],
    ["message", ws, data, "hello"],
    ["close", ws, data, 1000, "done"],
    ["drain", ws, data],
    ["ping", ws, data, payload],
    ["pong", ws, data, payload],
  ]);
  expect(handler).toMatchObject({
    maxPayloadLength: 1024,
    idleTimeout: 0,
    backpressureLimit: 0,
    closeOnBackpressureLimit: false,
  });
  expect(handler).not.toHaveProperty("data");
  expect(handler).not.toHaveProperty("error");

  const report = spyOn(console, "error").mockImplementation(() => {});
  const error = new Error("async callback failed");
  try {
    for (const name of names)
      route[name] = async () => {
        throw error;
      };
    handler.open!(ws);
    handler.message(ws, "hello");
    handler.close!(ws, 1000, "done");
    handler.drain!(ws);
    handler.ping!(ws, payload);
    handler.pong!(ws, payload);
    await Promise.resolve();
    expect(report).toHaveBeenCalledTimes(6);
    expect(report).toHaveBeenCalledWith("[zebra:ws] handler callback failed:", error);
  } finally {
    report.mockRestore();
  }
});

test("omitting transport settings leaves all Bun defaults unset", () => {
  const handler = buildBunWebSocketHandler();
  expect(Object.keys(handler)).toEqual(["open", "message", "close", "drain", "ping", "pong"]);
  const ws = { data: {} } as ServerWebSocket<WsData>;
  handler.open!(ws);
  handler.message(ws, "hello");
  handler.close!(ws, 1000, "done");
  handler.drain!(ws);
  handler.ping!(ws, Buffer.alloc(0));
  handler.pong!(ws, Buffer.alloc(0));
});
