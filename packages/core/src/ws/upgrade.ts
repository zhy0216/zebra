import { HttpError, toProblemJson } from "../http/errors.ts";

export function isWebSocketUpgrade(req: Request): boolean {
  return req.headers.get("upgrade")?.toLowerCase() === "websocket";
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
