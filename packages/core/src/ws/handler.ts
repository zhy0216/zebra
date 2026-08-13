import type { WebSocketHandler as BunWebSocketHandler, ServerWebSocket } from "bun";
import { WS_HANDLER, type WsData, type WsHandler } from "./types.ts";

/** 组装连接数据：C1 携带路径参数与所属路由，C2 在此合并 upgrade() 返回。 */
export function buildWsData(handler: WsHandler<any, any>, params: Record<string, string>): WsData {
  return { params, [WS_HANDLER]: handler };
}

/**
 * C2: upgrade() 返回的附加数据展开进 ws.data，params 与 handler symbol 最后写入、不可被覆盖。
 * 泛型 Up 使调用处拿到 `WsData & Up`，upgrade 返回字段保持类型化。
 */
export function buildWsDataWithUpgrade<Up extends Record<string, unknown>>(
  handler: WsHandler<any, any>,
  params: Record<string, string>,
  upgradeData: Up,
): WsData & Up {
  return { ...upgradeData, params, [WS_HANDLER]: handler } as WsData & Up;
}

function wsHandlerOf(ws: ServerWebSocket<WsData>): WsHandler<any, any> | undefined {
  return ws.data[WS_HANDLER];
}

/**
 * 汇总所有 ws 路由的 open/message/close（及 drain/ping/pong）到 Bun.serve 的
 * 单个 websocket 配置。
 *
 * 分发对齐 Bun 语义：`message(ws, message)`、`close(ws, code, reason)` 的原始参数
 * 顺序不变，`ws.data`（升级结果 + params，见 WsHandler 注释）作为第二个参数注入。
 */
export function buildBunWebSocketHandler(): BunWebSocketHandler<WsData> {
  return {
    open(ws) {
      invokeWsCallback(ws, wsHandlerOf(ws)?.open, [ws, ws.data]);
    },
    message(ws, message) {
      invokeWsCallback(ws, wsHandlerOf(ws)?.message, [ws, ws.data, message]);
    },
    close(ws, code, reason) {
      invokeWsCallback(ws, wsHandlerOf(ws)?.close, [ws, ws.data, code, reason]);
    },
    drain(ws) {
      invokeWsCallback(ws, wsHandlerOf(ws)?.drain, [ws, ws.data]);
    },
    ping(ws, payload) {
      invokeWsCallback(ws, wsHandlerOf(ws)?.ping, [ws, ws.data, payload]);
    },
    pong(ws, payload) {
      invokeWsCallback(ws, wsHandlerOf(ws)?.pong, [ws, ws.data, payload]);
    },
  };
}

/**
 * Invokes one WS handler callback without letting a throw (sync or async)
 * become an unhandled rejection — there is no HTTP error channel for these.
 */
function invokeWsCallback(_ws: ServerWebSocket<WsData>, fn: unknown, args: unknown[]): void {
  if (typeof fn !== "function") return;
  try {
    const result = (fn as (...a: unknown[]) => unknown)(...args);
    if (result instanceof Promise) {
      result.catch((error) => reportWsError(error));
    }
  } catch (error) {
    reportWsError(error);
  }
}

function reportWsError(error: unknown): void {
  console.error("[zebra:ws] handler callback failed:", error);
}
