import { HttpError, toProblemJson } from "../http/errors.ts";

export function isWebSocketUpgrade(req: Request): boolean {
  return req.headers.get("upgrade")?.toLowerCase() === "websocket";
}

/**
 * Cheap pre-flight of the two headers a valid WebSocket handshake must carry
 * (full validation still happens in `server.upgrade`). Lets the app skip
 * expensive upgrade hooks — session resolution, DI, auth — for requests that
 * can never upgrade.
 */
export function hasValidHandshakeHeaders(req: Request): boolean {
  return (
    (req.headers.get("sec-websocket-key")?.trim() ?? "") !== "" &&
    req.headers.get("sec-websocket-version")?.trim() === "13"
  );
}

/** 与 errorMiddleware 同格式的 Problem+JSON 响应（404 / 401 路径）。 */
export function wsProblemResponse(
  status: number,
  code: string,
  title: string,
  instance: string,
): Response {
  const problem = toProblemJson(new HttpError(status, code, title), instance, {});
  return new Response(JSON.stringify(problem), {
    status,
    headers: { "content-type": "application/problem+json; charset=utf-8" },
  });
}
