import type { TLSOptions } from "bun";
import type { ContractProcedureDef } from "../contract/protocol.ts";
import type { Container } from "../di/container.ts";
import type { Identifier } from "../di/token.ts";
import type { BodyOptions } from "../http/body.ts";
import type { ZebraRequest } from "../http/request.ts";
import type { Middleware } from "../middleware/types.ts";

/**
 * Options for `Zebra.listen`, passed through to `Bun.serve` as-is.
 *
 * `port` and `hostname` are Zebra's own; the rest are Bun transport options
 * that flow straight into `Bun.serve` when set. Other `Bun.serve` options can
 * be added additively in future minors on request.
 */
export interface ListenOptions {
  port: number;
  hostname?: string;
  /**
   * Seconds to wait before timing out a connection due to inactivity.
   * Passed through to Bun; default is Bun's (10s).
   */
  idleTimeout?: number;
  /**
   * Maximum request body size in bytes enforced by Bun at the transport
   * level (before any handler runs). Default is Bun's (128MB). The
   * app-level `body` limits are enforced inside the body parser and are
   * independent of this — see the body module docs for the composition.
   */
  maxRequestBodySize?: number;
  /** Whether the `SO_REUSEPORT` flag should be set (multi-process load balancing). Default false. */
  reusePort?: boolean;
  /** TLS options (key/cert chains) for serving HTTPS. */
  tls?: TLSOptions | TLSOptions[];
}

type SegmentParam<S extends string> = S extends `:${infer Name}`
  ? Name
  : S extends `*${infer Name}`
    ? Name
    : never;

type PathParamNames<Path extends string> = Path extends `${infer Head}/${infer Tail}`
  ? SegmentParam<Head> | PathParamNames<Tail>
  : SegmentParam<Path>;

export type PathParams<Path extends string> = string extends Path
  ? Record<string, string>
  : [PathParamNames<Path>] extends [never]
    ? Record<never, string>
    : { [K in PathParamNames<Path>]: string };

export type JoinPath<Prefix extends string, Path extends string> = Path extends `/${string}`
  ? `${Prefix}${Path}`
  : `${Prefix}/${Path}`;

export type DepsSpec = Record<string, Identifier<any>>;

export type ResolvedDeps<D extends DepsSpec> = {
  [K in keyof D]: D[K] extends Identifier<infer T> ? T : never;
};

export type RouteHandler<
  D = any,
  P = Record<string, string>,
  B = unknown,
  Q = Record<string, string>,
> = (req: ZebraRequest<P, B, Q>, deps: D) => unknown | Promise<unknown>;

export interface SessionOptions {
  ttl?: number;
  resolver?: (req: Request) => string | undefined | Promise<string | undefined>;
  /**
   * C4: 可选 ws 会话钩子 —— ws 升级时把会话句柄挂到 `ws.data.session`。
   *
   * core 不依赖 @zebra/session：此钩子在构造期传入（通常是 session 包的 helper，
   * 如 `sessionMiddleware()` 返回对象的 `wsSession` 方法），签名
   * `(req, sessionId) => unknown`。`sessionId` 是 `resolver` 在本次升级请求上的
   * 解析结果（未配置 resolver / 无存活会话时为 `undefined`）。返回值非 `undefined`
   * 时写入 `ws.data.session`（open/message/close 均可访问）；返回 `undefined` 或
   * 未配置钩子时 `ws.data.session` 为 `undefined`，升级与消息处理不报错。
   * 钩子抛错按升级决策内部错误处理 → 500 upgrade_error。
   */
  wsSession?: (req: Request, sessionId: string | undefined) => unknown | Promise<unknown>;
}

export interface ZebraOptions {
  container?: Container;
  body?: Partial<BodyOptions>;
  errors?: { exposeStack?: boolean };
  session?: SessionOptions;
  sessionResolver?: SessionOptions["resolver"];
  sessionTtl?: number;
  gracePeriod?: number;
  /**
   * Per-request deadline in milliseconds. When the dispatch pipeline
   * (middleware + handler, including body parsing and session resolution)
   * has not produced a response within the deadline, the request is aborted
   * and the client receives a 504 Problem+Json (`request_timeout`).
   * Handlers observe the cancellation on `req.signal` (which also aborts on
   * client disconnect, via Bun's raw `Request.signal`). Opt-in: when unset,
   * no deadline is applied and no abort wiring happens.
   */
  requestTimeout?: number;
  /**
   * App-level statement that the `x-forwarded-for` header may be trusted
   * (the deployment's edge proxy / CDN / load balancer overwrites it).
   * Core itself never reads `x-forwarded-for` — it only exposes the socket
   * peer address as `ZebraRequest.ip` — so this flag is the documented knob
   * that middleware such as `@zebra/rate-limit`'s `trustProxy` mirrors.
   * Default: false.
   */
  trustProxy?: boolean;
}

export interface RegisteredRoute {
  method: string;
  path: string;
  deps: DepsSpec | null;
  handler: RouteHandler;
  middlewares: Middleware[];
  contract?: ContractProcedureDef;
}
