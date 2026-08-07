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
}
