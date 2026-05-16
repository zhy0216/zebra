import type { Container } from "../di/container.ts";
import type { BodyOptions } from "../http/body.ts";
import type { ZebraRequest } from "../http/request.ts";
import type { Middleware } from "../middleware/types.ts";

export type RouteHandler<D = any> = (req: ZebraRequest, deps?: D) => Promise<unknown>;

export type DepsSpec = Record<string, any>;

export interface ZebraOptions {
  container: Container;
  body?: Partial<BodyOptions>;
  errors?: { exposeStack?: boolean };
}

export interface RegisteredRoute {
  method: string;
  path: string;
  deps: DepsSpec | null;
  handler: RouteHandler;
  middlewares: Middleware[];
}
