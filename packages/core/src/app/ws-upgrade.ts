import type { Server } from "bun";
import { buildRequest } from "../http/request.ts";
import { buildWsData, buildWsDataWithUpgrade } from "../ws/handler.ts";
import type { WsData } from "../ws/types.ts";
import { isWsUpgrade, upgradeHeaders } from "../ws/upgrade-result.ts";
import { hasValidHandshakeHeaders, wsProblemResponse } from "../ws/upgrade.ts";
import type { AppInternals } from "./internals.ts";

/**
 * The WebSocket upgrade branch of the fetch wrapper, extracted from the app
 * class. Assumes the request is an upgrade with a matched ws route; returns
 * the handshake response (including a route's custom rejection). The expensive decision (session
 * resolution, DI, the auth hook) runs only for well-formed handshakes —
 * Bun's `server.upgrade()` remains the authoritative full validation.
 */
export async function handleWsUpgrade(
  internals: AppInternals,
  req: Request,
  server: Server<WsData>,
  getIp: () => string | undefined,
): Promise<Response> {
  const url = new URL(req.url);
  const matched = internals.wsRegistry.find(url.pathname);
  if (matched === null) {
    return wsProblemResponse(
      404,
      "not_found",
      `No WebSocket route for ${url.pathname}`,
      url.pathname,
    );
  }

  if (!hasValidHandshakeHeaders(req)) {
    return wsProblemResponse(401, "upgrade_failed", "WebSocket upgrade failed", url.pathname);
  }

  // 升级决策链：upgrade 与 wsSession 都是单次请求决策，与 HTTP dispatch 一致走
  // createRequestScopes()；决策完成后立即 dispose。异常路径取舍：钩子抛错 /
  // 依赖解析失败 → 500 upgrade_error；返回 false 才是客户端显式拒绝 →
  // 401 upgrade_rejected（区别于传输层失败 401 upgrade_failed）。
  const handler = matched.handler;
  let data = buildWsData(handler, matched.params);
  let headers: Headers | undefined;
  try {
    const scopes = await internals.sessions.createRequestScopes(req);
    try {
      if (handler.upgrade) {
        const deps = internals.resolveDeps(handler.onUpgrade ?? null, scopes.request);
        const zebraReq = buildRequest<Record<string, string>>(
          req,
          matched.params,
          internals.bodyOpts,
          undefined,
          undefined,
          url,
          getIp,
        );
        const result = await handler.upgrade(zebraReq, deps as never, matched.params);
        if (result instanceof Response) return result;
        if (result === false) {
          return wsProblemResponse(
            401,
            "upgrade_rejected",
            "Upgrade rejected by route handler",
            url.pathname,
          );
        }
        if (result) {
          if (isWsUpgrade(result)) {
            data = buildWsDataWithUpgrade(handler, matched.params, result.data);
            if (result.headers !== undefined) headers = upgradeHeaders(req, result.headers);
          } else {
            data = buildWsDataWithUpgrade(handler, matched.params, result);
          }
        }
      }
      // sessionId 复用 createRequestScopes 的解析结果；最后写入，upgrade()
      // 的展开数据不能覆盖 session（session 为保留字段）。
      if (internals.wsSession) {
        const session = await internals.wsSession(req, scopes.sessionId);
        if (session !== undefined) data.session = session;
      }
    } finally {
      await internals.sessions.disposeScopes(scopes);
    }
  } catch {
    return wsProblemResponse(500, "upgrade_error", "WebSocket upgrade hook failed", url.pathname);
  }
  if (!server.upgrade(req, { data, ...(headers !== undefined ? { headers } : {}) })) {
    return wsProblemResponse(401, "upgrade_failed", "WebSocket upgrade failed", url.pathname);
  }
  return new Response(null, { status: 101 });
}
