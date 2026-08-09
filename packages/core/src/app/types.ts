import type { ContractProcedureDef } from "../contract/protocol.ts";
import type { Container } from "../di/container.ts";
import type { Identifier } from "../di/token.ts";
import type { BodyOptions } from "../http/body.ts";
import type { ZebraRequest } from "../http/request.ts";
import type { Middleware } from "../middleware/types.ts";

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
}

export interface RegisteredRoute {
  method: string;
  path: string;
  deps: DepsSpec | null;
  handler: RouteHandler;
  middlewares: Middleware[];
  contract?: ContractProcedureDef;
}
