import type { ServerWebSocket } from "bun";
import type { DepsSpec, ResolvedDeps } from "../app/types.ts";
import type { ZebraRequest } from "../http/request.ts";

export const WS_HANDLER = Symbol.for("zebra.ws.handler");

/**
 * 连接数据（每个 ws 连接一份，生命周期 == 连接）：
 * - `params`：C1 路由路径参数；
 * - `session`：C4 会话句柄（可选；由 `ZebraOptions.session.wsSession` 钩子在升级时填充，
 *   类型由钩子定义，通常来自 @zebra-web/session 的 RequestSession）。未配置钩子或匿名连接
 *   时为 `undefined`，不报错。保留字段——upgrade() 返回对象不应包含同名键（后者会被覆盖）。
 * - `[WS_HANDLER]`：归属路由，open/message/close 分发用；
 * - 其余字段：C2 展开 upgrade() 返回对象。
 *
 * 类型安全约定：索引签名允许访问任意键（裸 `WsData.userId` 为 `unknown`）；
 * 在注册处 handler 的类型参数 `Up` 会把 upgrade() 返回对象并入 `WsData & Up`，
 * 使 `open/message/close` 里 `data.userId` 等字段获得精确类型（见 WsHandler）。
 */
export interface WsData {
  params: Record<string, string>;
  /** C4: 会话句柄，见上。类型由 wsSession 钩子决定（core 不依赖 @zebra-web/session）。 */
  session?: unknown;
  [key: string]: unknown;
  [WS_HANDLER]?: WsHandler<any, any>;
}

/**
 * ws 路由处理器。
 *
 * 签名对齐 Bun `ServerWebSocket` 语义（bun-types `WebSocketHandler`，见 serve.d.ts）：
 * - Bun 原始签名：`open(ws)`、`message(ws, message)`、`close(ws, code, reason)`、
 *   `drain(ws)`、`ping/pong(ws, data)`；
 * - Zebra 折中：把 `ws.data`（升级结果 + params）作为每个回调的第二个参数注入，
 *   Bun 的原始参数（message / code / reason / ping-pong payload）依次后移；
 *   这样 `message(ws, data, msg)` 与条目示例一致，同时 `close` 的 code/reason
 *   顺序与 Bun 完全相同，仅多插了一个 data。所有回调允许 `void | Promise<void>`。
 *
 * DI scope 取舍（连接级 vs 请求级）：
 * - `upgrade` 钩子：单次请求决策，随 HTTP dispatch 走 request scope，
 *   决策完成后立即 dispose（见 app.ts handleFetch 注释）。
 * - `open/message/close`：**不创建请求级 scope**——触发时原始 Request 已结束，
 *   请求级依赖生命周期已到，按 per-message 再建 scope 只会解析到已废弃的请求上下文。
 *   消息处理直接在连接级执行：连接级依赖（C4 的 session、用户注入的连接级服务）
 *   由 `open` 时解析一次、连接内复用；若未来需要 per-connection scope，
 *   在 `open` 中用容器建立并随 `close` 释放。
 *
 * @typeParam D  upgrade 钩子的依赖声明，语义同 middleware()。
 * @typeParam Up  upgrade() 返回对象的类型；推断自 upgrade 的返回（无 upgrade 钩子
 *   时为 Record<string, unknown>，此时 data 的升级字段退化为 unknown）。
 */
export interface WsHandler<
  D extends DepsSpec = never,
  Up extends Record<string, unknown> = Record<string, unknown>,
> {
  /** C2: 命名对象依赖声明，语义同 middleware()；随 upgrade 钩子在 request scope 中解析。 */
  onUpgrade?: D;
  /** C2: 升级决策钩子。返回对象 → 展开进 ws.data（其类型即 Up）；返回 false → 401 拒绝；抛错 → 500。 */
  upgrade?: (
    /**
     * 升级请求。为 `ZebraRequest`（`req.raw` 即原始 `Request`，与设计文档 §8.6
     * 示例 `user.fromRequest(req.raw)` 对齐）；路径参数由第三参 `params` 提供，
     * 可在升级决策时做基于路径的鉴权（如 `/chat/:room` 的房间权限检查）。
     */
    req: ZebraRequest,
    deps: D extends never ? undefined : ResolvedDeps<D>,
    params: Record<string, string>,
  ) => Up | false | Promise<Up | false>;
  /** C3: 连接建立后触发（Bun `open(ws)`）。data 为 `WsData & Up`，upgrade 返回的字段可类型化访问。 */
  open?: (ws: ServerWebSocket<WsData & Up>, data: WsData & Up) => void | Promise<void>;
  /** C3: 收到消息（Bun `message(ws, message)`；message 为 string 或 Buffer，取决于 binaryType）。 */
  message?: (
    ws: ServerWebSocket<WsData & Up>,
    data: WsData & Up,
    message: string | Buffer,
  ) => void | Promise<void>;
  /** C3: 连接关闭（Bun `close(ws, code, reason)`；code/reason 与 Bun 顺序一致）。 */
  close?: (
    ws: ServerWebSocket<WsData & Up>,
    data: WsData & Up,
    code: number,
    reason: string,
  ) => void | Promise<void>;
  /** 背压解除（Bun `drain(ws)`）。 */
  drain?: (ws: ServerWebSocket<WsData & Up>, data: WsData & Up) => void | Promise<void>;
  /** 收到 ping（Bun `ping(ws, data)`，payload 为该次 ping 的负载）。 */
  ping?: (
    ws: ServerWebSocket<WsData & Up>,
    data: WsData & Up,
    payload: Buffer,
  ) => void | Promise<void>;
  /** 收到 pong（Bun `pong(ws, data)`）。 */
  pong?: (
    ws: ServerWebSocket<WsData & Up>,
    data: WsData & Up,
    payload: Buffer,
  ) => void | Promise<void>;
}

export interface WsRoute {
  path: string;
  handler: WsHandler;
}
