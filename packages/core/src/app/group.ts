import type { Middleware } from "../middleware/types.ts";
import type { DepsSpec, RouteHandler } from "./types.ts";

export interface GroupApi {
  use(mw: Middleware): this;
  get(path: string, handler: RouteHandler): void;
  get(path: string, deps: DepsSpec, handler: RouteHandler): void;
  post(path: string, handler: RouteHandler): void;
  post(path: string, deps: DepsSpec, handler: RouteHandler): void;
  put(path: string, handler: RouteHandler): void;
  put(path: string, deps: DepsSpec, handler: RouteHandler): void;
  patch(path: string, handler: RouteHandler): void;
  patch(path: string, deps: DepsSpec, handler: RouteHandler): void;
  delete(path: string, handler: RouteHandler): void;
  delete(path: string, deps: DepsSpec, handler: RouteHandler): void;
  group(prefix: string, fn: (g: GroupApi) => void): void;
}

export interface GroupedRoute {
  method: string;
  path: string;
  deps: DepsSpec | null;
  handler: RouteHandler;
  groupMiddlewares: Middleware[];
}

export class Group implements GroupApi {
  middlewares: Middleware[] = [];
  routes: GroupedRoute[] = [];
  private prefix: string;
  private inherited: Middleware[];

  constructor(prefix: string, inherited: Middleware[] = []) {
    this.prefix = prefix.replace(/\/+$/, "");
    this.inherited = inherited;
  }

  use(mw: Middleware): this {
    this.middlewares.push(mw);
    return this;
  }

  private register(
    method: string,
    path: string,
    deps: DepsSpec | null,
    handler: RouteHandler,
  ): void {
    const joined = this.prefix + (path.startsWith("/") ? path : "/" + path);
    this.routes.push({
      method,
      path: joined,
      deps,
      handler,
      groupMiddlewares: [...this.inherited, ...this.middlewares],
    });
  }

  get(path: string, a: any, b?: any): void {
    if (b === undefined) this.register("GET", path, null, a);
    else this.register("GET", path, a, b);
  }
  post(path: string, a: any, b?: any): void {
    if (b === undefined) this.register("POST", path, null, a);
    else this.register("POST", path, a, b);
  }
  put(path: string, a: any, b?: any): void {
    if (b === undefined) this.register("PUT", path, null, a);
    else this.register("PUT", path, a, b);
  }
  patch(path: string, a: any, b?: any): void {
    if (b === undefined) this.register("PATCH", path, null, a);
    else this.register("PATCH", path, a, b);
  }
  delete(path: string, a: any, b?: any): void {
    if (b === undefined) this.register("DELETE", path, null, a);
    else this.register("DELETE", path, a, b);
  }

  group(prefix: string, fn: (g: GroupApi) => void): void {
    const child = new Group(
      this.prefix + (prefix.startsWith("/") ? prefix : "/" + prefix),
      [...this.inherited, ...this.middlewares],
    );
    fn(child);
    for (const r of child.routes) this.routes.push(r);
  }
}
