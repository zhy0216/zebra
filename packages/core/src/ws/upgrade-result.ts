import type { HeadersInit } from "bun";

const WS_UPGRADE = Symbol.for("zebra.ws.upgrade");

export interface WsUpgradeOptions {
  /** Additional handshake response headers. A selected subprotocol must be offered by the client. */
  headers?: HeadersInit;
}

/** An explicit successful upgrade, created by wsUpgrade; ordinary data/headers keys stay data. */
export interface WsUpgrade<Up extends Record<string, unknown>> extends WsUpgradeOptions {
  readonly [WS_UPGRADE]: true;
  readonly data: Up;
}

export function wsUpgrade<Up extends Record<string, unknown>>(
  data: Up,
  options: WsUpgradeOptions = {},
): WsUpgrade<Up> {
  return {
    [WS_UPGRADE]: true,
    data,
    ...(options.headers !== undefined ? { headers: options.headers } : {}),
  };
}

export function isWsUpgrade(value: object): value is WsUpgrade<Record<string, unknown>> {
  return WS_UPGRADE in value && value[WS_UPGRADE] === true;
}

export function upgradeHeaders(req: Request, init: HeadersInit): Headers {
  const headers = new Headers(init);
  const protocol = headers.get("sec-websocket-protocol");
  if (protocol !== null) {
    const offered = req.headers
      .get("sec-websocket-protocol")
      ?.split(",")
      .map((p) => p.trim());
    // Bun accepts arbitrary protocol response headers; enforce a single offered
    // token here so a server cannot invent a protocol the client did not offer.
    if (!/^[!#$%&'*+\-.^_`|~0-9A-Za-z]+$/.test(protocol) || !offered?.includes(protocol)) {
      throw new TypeError("WebSocket subprotocol must be a single protocol offered by the client");
    }
  }
  return headers;
}
