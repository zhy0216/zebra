import { Container } from "../di/container.ts";
import { ScopeKind } from "../di/scope.ts";
import { Router } from "../router/radix.ts";
import { buildRequest } from "../http/request.ts";
import { HttpError } from "../http/errors.ts";
import { compose } from "../middleware/compose.ts";
import { errorMiddleware } from "../middleware/error.ts";
import type { Middleware } from "../middleware/types.ts";
import type { ZebraOptions, RouteHandler, DepsSpec, RegisteredRoute } from "./types.ts";
import { Group, type GroupApi } from "./group.ts";
import type { LifecycleEvent, LifecycleHandler } from "./lifecycle.ts";
import { validateGraph } from "./boot-validation.ts";

const DEFAULT_BODY = {
  maxSize: 1024 * 1024,
  json: { limit: 1024 * 1024 },
  form: { limit: 1024 * 1024 },
  multipart: { limit: 16 * 1024 * 1024, maxFiles: 10, maxFileSize: 8 * 1024 * 1024 },
};

export class Zebra {
  protected container: Container;
  protected router = new Router<RegisteredRoute>();
  protected middlewares: Middleware[] = [];
  protected routes: RegisteredRoute[] = [];
  protected bodyOpts;
  protected exposeStack: boolean;
  protected frozen = false;
  protected hooks: Record<LifecycleEvent, LifecycleHandler[]> = { boot: [], ready: [], shutdown: [] };
  protected server: ReturnType<typeof Bun.serve> | null = null;

  constructor(opts: ZebraOptions) {
    this.container = opts.container;
    this.bodyOpts = { ...DEFAULT_BODY, ...(opts.body ?? {}) };
    this.exposeStack = opts.errors?.exposeStack ?? false;
  }

  use(mw: Middleware): this {
    this.middlewares.push(mw);
    return this;
  }

  on(event: LifecycleEvent, fn: LifecycleHandler): this {
    this.hooks[event].push(fn);
    return this;
  }

  async listen(opts: { port: number; hostname?: string }): Promise<{ port: number }> {
    for (const h of this.hooks.boot) await h();
    validateGraph(this.container, this.routes, this.middlewares);
    this.frozen = true;
    const serveOpts: { port: number; hostname?: string; fetch: (req: Request) => Promise<Response> } = {
      port: opts.port,
      fetch: (req) => this.dispatch(req),
    };
    if (opts.hostname !== undefined) serveOpts.hostname = opts.hostname;
    this.server = Bun.serve(serveOpts);
    for (const h of this.hooks.ready) await h();
    return { port: this.server.port as number };
  }

  async stop(): Promise<void> {
    for (const h of this.hooks.shutdown) await h();
    if (this.server) {
      this.server.stop(true);
      this.server = null;
    }
    await this.container.dispose();
  }

  protected register(
    method: string,
    path: string,
    deps: DepsSpec | null,
    handler: RouteHandler,
    extraMws: Middleware[] = [],
  ): void {
    if (this.frozen) {
      throw new Error("Cannot register routes after app.listen()");
    }
    const route: RegisteredRoute = { method, path, deps, handler, middlewares: extraMws };
    this.routes.push(route);
    this.router.add(method, path, route);
  }

  get(path: string, handler: RouteHandler): void;
  get(path: string, deps: DepsSpec, handler: RouteHandler): void;
  get(path: string, a: any, b?: any): void {
    if (b === undefined) this.register("GET", path, null, a);
    else this.register("GET", path, a, b);
  }
  post(path: string, handler: RouteHandler): void;
  post(path: string, deps: DepsSpec, handler: RouteHandler): void;
  post(path: string, a: any, b?: any): void {
    if (b === undefined) this.register("POST", path, null, a);
    else this.register("POST", path, a, b);
  }
  put(path: string, handler: RouteHandler): void;
  put(path: string, deps: DepsSpec, handler: RouteHandler): void;
  put(path: string, a: any, b?: any): void {
    if (b === undefined) this.register("PUT", path, null, a);
    else this.register("PUT", path, a, b);
  }
  patch(path: string, handler: RouteHandler): void;
  patch(path: string, deps: DepsSpec, handler: RouteHandler): void;
  patch(path: string, a: any, b?: any): void {
    if (b === undefined) this.register("PATCH", path, null, a);
    else this.register("PATCH", path, a, b);
  }
  delete(path: string, handler: RouteHandler): void;
  delete(path: string, deps: DepsSpec, handler: RouteHandler): void;
  delete(path: string, a: any, b?: any): void {
    if (b === undefined) this.register("DELETE", path, null, a);
    else this.register("DELETE", path, a, b);
  }

  group(prefix: string, fn: (g: GroupApi) => void): void {
    const g = new Group(prefix, []);
    fn(g);
    for (const r of g.routes) {
      this.register(r.method, r.path, r.deps, r.handler, r.groupMiddlewares);
    }
  }

  async dispatch(raw: Request): Promise<Response> {
    const url = new URL(raw.url);
    const matched = this.router.find(raw.method, url.pathname);

    if (!matched) {
      const req = buildRequest(raw, {}, this.bodyOpts);
      const noMatchMws: Middleware[] = [
        errorMiddleware({ exposeStack: this.exposeStack }),
        ...this.middlewares,
      ];
      return compose(req, noMatchMws, async () => {
        throw new HttpError(404, "not_found", `No route for ${raw.method} ${url.pathname}`);
      });
    }

    const route = matched.handler;
    const req = buildRequest(raw, matched.params, this.bodyOpts);
    const requestScope = this.container.createChildScope(ScopeKind.Request);

    const allMws: Middleware[] = [
      errorMiddleware({ exposeStack: this.exposeStack }),
      ...this.middlewares,
      ...route.middlewares,
    ];

    return compose(req, allMws, async () => {
      const resolved: Record<string, unknown> = {};
      if (route.deps) {
        for (const [name, id] of Object.entries(route.deps)) {
          resolved[name] = requestScope.resolve(id);
        }
      }
      try {
        const result = await (route.deps
          ? (route.handler as any)(req, resolved)
          : (route.handler as any)(req));
        if (result instanceof Response) return result;
        return new Response(JSON.stringify(result), {
          status: 200,
          headers: { "content-type": "application/json; charset=utf-8" },
        });
      } finally {
        await requestScope.dispose();
      }
    });
  }
}
