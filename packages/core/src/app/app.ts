import type { WebSocketHandler as BunWebSocketHandler, Server, TLSOptions } from "bun";
import { buildContractHandler } from "../contract/implement.ts";
import { type ContractProcedureDef, isContractProcedure } from "../contract/protocol.ts";
import {
  type ContractHandler,
  type ContractProcedure,
  type ContractRouter,
  type ImplementOptions,
  type ProcedureImpl,
  type RouterImpl,
  isHandlerEntry,
} from "../contract/types.ts";
import type { BindingBuilder } from "../di/binding.ts";
import { Container } from "../di/container.ts";
import { ScopeKind } from "../di/scope.ts";
import type { ClassConstructor, Identifier } from "../di/token.ts";
import type { BodyOptions } from "../http/body.ts";
import { HttpError } from "../http/errors.ts";
import { type ZebraRequest, buildRequest } from "../http/request.ts";
import { type StaticOptions, serveStatic } from "../http/static.ts";
import { compose } from "../middleware/compose.ts";
import { errorMiddleware } from "../middleware/error.ts";
import { getMiddlewareDeps } from "../middleware/helper.ts";
import type { Middleware } from "../middleware/types.ts";
import { Router } from "../router/radix.ts";
import { buildBunWebSocketHandler, buildWsData, buildWsDataWithUpgrade } from "../ws/handler.ts";
import { WsRegistry } from "../ws/registry.ts";
import type { WsData, WsHandler } from "../ws/types.ts";
import { isWebSocketUpgrade, wsProblemResponse } from "../ws/upgrade.ts";
import { validateGraph } from "./boot-validation.ts";
import { Group, type GroupApi } from "./group.ts";
import type { LifecycleEvent, LifecycleHandler } from "./lifecycle.ts";
import type {
  DepsSpec,
  ListenOptions,
  PathParams,
  RegisteredRoute,
  ResolvedDeps,
  RouteHandler,
  ZebraOptions,
} from "./types.ts";

const DEFAULT_BODY = {
  maxSize: 1024 * 1024,
  json: { limit: 1024 * 1024 },
  form: { limit: 1024 * 1024 },
  multipart: { limit: 16 * 1024 * 1024, maxFiles: 10, maxFileSize: 8 * 1024 * 1024 },
};

const DEFAULT_SESSION_TTL = 30 * 60 * 1000;
const DEFAULT_GRACE_PERIOD = 10_000;
const MAX_SESSION_ID_LENGTH = 512;

interface SessionScopeRecord {
  container: Container;
  timer: ReturnType<typeof setTimeout> | undefined;
  activeRequests: number;
}

interface RequestScopes {
  request: Container;
  ephemeralSession?: Container;
  sessionId?: string;
}

/**
 * Precompiled per-route execution plan, built once at boot (freeze) so the
 * per-request path does no middleware scanning, dep inspection or array
 * concatenation. Routes without DI deps and without a session resolver get a
 * zero-cost fast path that skips Container child scope creation entirely.
 */
interface RoutePlan {
  /** Global middlewares + route middlewares, concatenated once at boot. */
  middlewares: Middleware[];
  /** Middlewares that need DI resolution, with their deps spec; empty when none. */
  mwDeps: Array<{ index: number; deps: DepsSpec }>;
  /** True when the route or any middleware declares DI deps. */
  needsDeps: boolean;
  /** True when a per-request Container child scope is required. */
  needsScope: boolean;
}

/** A live per-request deadline: aborting `controller` fires `signal`. */
interface RequestDeadline {
  controller: AbortController;
  timer: ReturnType<typeof setTimeout>;
  ms: number;
  /** Detaches the client-disconnect wiring once the dispatch has settled. */
  detach: () => void;
}

export class Zebra {
  protected container: Container;
  protected router = new Router<RegisteredRoute>();
  protected wsRegistry = new WsRegistry();
  protected middlewares: Middleware[] = [];
  protected routes: RegisteredRoute[] = [];
  protected bodyOpts: BodyOptions;
  protected exposeStack: boolean;
  /** App-level trust statement for `x-forwarded-for` (see `ZebraOptions.trustProxy`). */
  readonly trustProxy: boolean;
  protected frozen = false;
  protected plans = new WeakMap<RegisteredRoute, RoutePlan>();
  private fallbackPlan: RoutePlan | null = null;
  protected hooks: Record<LifecycleEvent, LifecycleHandler[]> = {
    boot: [],
    ready: [],
    shutdown: [],
  };
  protected server: Server<WsData> | null = null;
  private readonly errorMw: Middleware;
  private readonly sessionResolver: NonNullable<ZebraOptions["session"]>["resolver"];
  private readonly wsSession: NonNullable<ZebraOptions["session"]>["wsSession"];
  private readonly sessionTtl: number;
  private readonly gracePeriod: number;
  private readonly requestTimeout: number | undefined;
  private readonly sessions = new Map<string, SessionScopeRecord>();
  private signalHandler: (() => void) | null = null;
  private stopping: Promise<void> | null = null;
  private stopped = false;
  private booted = false;
  private booting: Promise<void> | null = null;
  private inFlight = 0;
  private drainWaiters = new Set<() => void>();

  constructor(opts: ZebraOptions = {}) {
    this.container = opts.container ?? new Container();
    this.bodyOpts = {
      maxSize: opts.body?.maxSize ?? DEFAULT_BODY.maxSize,
      json: { ...DEFAULT_BODY.json, ...(opts.body?.json ?? {}) },
      form: { ...DEFAULT_BODY.form, ...(opts.body?.form ?? {}) },
      multipart: { ...DEFAULT_BODY.multipart, ...(opts.body?.multipart ?? {}) },
    };
    this.exposeStack = opts.errors?.exposeStack ?? false;
    this.trustProxy = opts.trustProxy ?? false;
    this.errorMw = errorMiddleware({ exposeStack: this.exposeStack });
    this.sessionResolver = opts.sessionResolver ?? opts.session?.resolver;
    this.wsSession = opts.session?.wsSession;
    this.sessionTtl = opts.sessionTtl ?? opts.session?.ttl ?? DEFAULT_SESSION_TTL;
    this.gracePeriod = opts.gracePeriod ?? DEFAULT_GRACE_PERIOD;
    this.requestTimeout = opts.requestTimeout;
    if (this.sessionTtl <= 0) throw new RangeError("session.ttl must be greater than zero");
    if (this.gracePeriod < 0) throw new RangeError("gracePeriod must not be negative");
    if (this.requestTimeout !== undefined && this.requestTimeout <= 0) {
      throw new RangeError("requestTimeout must be greater than zero");
    }
  }

  use(mw: Middleware): this {
    this.assertNotFrozen("middleware");
    this.middlewares.push(mw);
    return this;
  }

  /** Frozen copies of all registered routes (OpenAPI/introspection seam). */
  get routeTable(): ReadonlyArray<RegisteredRoute> {
    return Object.freeze(
      this.routes.map((route) => {
        const copy: RegisteredRoute = {
          ...route,
          deps: route.deps ? Object.freeze({ ...route.deps }) : null,
          middlewares: Object.freeze([...route.middlewares]) as Middleware[],
        };
        if (route.contract !== undefined) copy.contract = deepFreeze({ ...route.contract });
        return Object.freeze(copy);
      }),
    );
  }

  on(event: LifecycleEvent, fn: LifecycleHandler): this {
    this.assertNotFrozen("lifecycle hooks");
    this.hooks[event].push(fn);
    return this;
  }

  async listen(opts: ListenOptions): Promise<{ port: number }> {
    if (this.stopped) throw new Error("Zebra has been stopped and cannot listen again");
    if (this.server) throw new Error("Zebra is already listening");
    await this.prepare();
    if (this.stopped) throw new Error("Zebra has been stopped and cannot listen again");
    if (this.server) throw new Error("Zebra is already listening");
    const serveOpts: {
      port: number;
      hostname?: string;
      idleTimeout?: number;
      maxRequestBodySize?: number;
      reusePort?: boolean;
      tls?: TLSOptions | TLSOptions[];
      fetch: (req: Request, server: Server<WsData>) => Promise<Response>;
      websocket: BunWebSocketHandler<WsData>;
    } = {
      port: opts.port,
      fetch: (req, server) => this.handleFetch(req, server),
      websocket: buildBunWebSocketHandler(),
    };
    if (opts.hostname !== undefined) serveOpts.hostname = opts.hostname;
    if (opts.idleTimeout !== undefined) serveOpts.idleTimeout = opts.idleTimeout;
    if (opts.maxRequestBodySize !== undefined) {
      serveOpts.maxRequestBodySize = opts.maxRequestBodySize;
    }
    if (opts.reusePort !== undefined) serveOpts.reusePort = opts.reusePort;
    if (opts.tls !== undefined) serveOpts.tls = opts.tls;
    this.server = Bun.serve(serveOpts);
    this.installSignalHandlers();
    try {
      for (const h of this.hooks.ready) await h();
    } catch (error) {
      await this.stop();
      throw error;
    }
    return { port: this.server.port as number };
  }

  async stop(): Promise<void> {
    if (this.stopping) return this.stopping;
    this.stopping = this.performStop();
    return this.stopping;
  }

  async disposeSession(id: string): Promise<void> {
    const record = this.sessions.get(id);
    if (!record) return;
    this.sessions.delete(id);
    if (record.timer) clearTimeout(record.timer);
    await record.container.dispose();
  }

  protected async prepare(): Promise<void> {
    if (this.booted) return;
    if (this.booting) return this.booting;
    this.booting = this.performPrepare();
    try {
      await this.booting;
    } finally {
      this.booting = null;
    }
  }

  private async performPrepare(): Promise<void> {
    for (const h of this.hooks.boot) await h();
    validateGraph(this.container, this.routes, this.middlewares);
    this.frozen = true;
    // Precompile per-route execution plans (middleware chain, dep indices,
    // scope requirement) once, so dispatch does zero per-request inspection.
    for (const route of this.routes) this.plans.set(route, this.computePlan(route));
    this.fallbackPlan = this.computePlan(undefined);
    this.container.freeze();
    this.booted = true;
  }

  injectValue<T>(id: Identifier<T>, value: T): void {
    this.assertNotFrozen();
    this.container.bind(id).toValue(value);
  }

  injectSingleton<T>(id: Identifier<T>, impl?: ClassConstructor<T>): void {
    this.bindClass(id, impl, ScopeKind.Singleton);
  }
  injectRequest<T>(id: Identifier<T>, impl?: ClassConstructor<T>): void {
    this.bindClass(id, impl, ScopeKind.Request);
  }
  injectTransient<T>(id: Identifier<T>, impl?: ClassConstructor<T>): void {
    this.bindClass(id, impl, ScopeKind.Transient);
  }
  injectSession<T>(id: Identifier<T>, impl?: ClassConstructor<T>): void {
    this.bindClass(id, impl, ScopeKind.Session);
  }

  injectFactorySingleton<T>(id: Identifier<T>, fn: (c: Container) => T): void;
  injectFactorySingleton<T>(
    id: Identifier<T>,
    deps: Record<string, Identifier<unknown>>,
    fn: (deps: Record<string, unknown>) => T,
  ): void;
  injectFactorySingleton(id: any, a: any, b?: any): void {
    this.bindFactory(id, a, b, ScopeKind.Singleton);
  }

  injectFactoryRequest<T>(id: Identifier<T>, fn: (c: Container) => T): void;
  injectFactoryRequest<T>(
    id: Identifier<T>,
    deps: Record<string, Identifier<unknown>>,
    fn: (deps: Record<string, unknown>) => T,
  ): void;
  injectFactoryRequest(id: any, a: any, b?: any): void {
    this.bindFactory(id, a, b, ScopeKind.Request);
  }

  injectFactoryTransient<T>(id: Identifier<T>, fn: (c: Container) => T): void;
  injectFactoryTransient<T>(
    id: Identifier<T>,
    deps: Record<string, Identifier<unknown>>,
    fn: (deps: Record<string, unknown>) => T,
  ): void;
  injectFactoryTransient(id: any, a: any, b?: any): void {
    this.bindFactory(id, a, b, ScopeKind.Transient);
  }

  injectFactorySession<T>(id: Identifier<T>, fn: (c: Container) => T): void;
  injectFactorySession<T>(
    id: Identifier<T>,
    deps: Record<string, Identifier<unknown>>,
    fn: (deps: Record<string, unknown>) => T,
  ): void;
  injectFactorySession(id: any, a: any, b?: any): void {
    this.bindFactory(id, a, b, ScopeKind.Session);
  }

  private bindFactory(
    id: Identifier<any>,
    a: ((c: Container) => any) | Record<string, Identifier<unknown>>,
    b: ((deps: Record<string, unknown>) => any) | undefined,
    scope: ScopeKind,
  ): void {
    this.assertNotFrozen();
    const builder = this.container.bind(id);
    if (b === undefined) {
      // Lazy form: a is the factory fn
      builder.toFactory(a as (c: Container) => any);
    } else {
      // Declared form: a is deps spec, b is the fn taking resolved deps
      builder.toFactoryWithDeps(a as Record<string, Identifier<unknown>>, b);
    }
    Zebra.applyScope(builder, scope);
  }

  private bindClass<T>(
    id: Identifier<T>,
    impl: ClassConstructor<T> | undefined,
    scope: ScopeKind,
  ): void {
    this.assertNotFrozen();
    const b = this.container.bind(id);
    if (impl) b.to(impl);
    else b.toSelf();
    Zebra.applyScope(b, scope);
  }

  private static applyScope(b: BindingBuilder<unknown>, scope: ScopeKind): void {
    switch (scope) {
      case ScopeKind.Singleton:
        b.inSingletonScope();
        break;
      case ScopeKind.Request:
        b.inRequestScope();
        break;
      case ScopeKind.Transient:
        b.inTransientScope();
        break;
      case ScopeKind.Session:
        b.inSessionScope();
        break;
    }
  }

  protected assertNotFrozen(kind = "bindings"): void {
    if (this.frozen) {
      throw new Error(`Cannot register ${kind} after app.listen()`);
    }
  }

  protected register(
    method: string,
    path: string,
    deps: DepsSpec | null,
    handler: RouteHandler,
    extraMws: Middleware[] = [],
    contract?: ContractProcedureDef,
  ): void {
    this.assertNotFrozen("routes");
    const route: RegisteredRoute = {
      method,
      path,
      deps,
      handler,
      middlewares: extraMws,
      ...(contract !== undefined ? { contract } : {}),
    };
    this.routes.push(route);
    this.router.add(method, path, route);
  }

  implement<Def extends ContractProcedureDef>(
    proc: ContractProcedure<Def>,
    handler: ContractHandler<Def>,
  ): void;
  implement<Def extends ContractProcedureDef, D extends DepsSpec>(
    proc: ContractProcedure<Def>,
    deps: D,
    handler: ContractHandler<Def, ResolvedDeps<D>>,
    opts?: ImplementOptions,
  ): void;
  implement<R extends ContractRouter>(router: R, impls: RouterImpl<R, never>): void;
  implement<R extends ContractRouter, D extends DepsSpec>(
    router: R,
    deps: D,
    impls: RouterImpl<R, ResolvedDeps<D>>,
    opts?: ImplementOptions,
  ): void;
  implement(
    procOrRouter: unknown,
    depsOrImpls: unknown,
    implsOrOpts?: unknown,
    opts?: unknown,
  ): void {
    if (isContractProcedure(procOrRouter)) {
      const def = procOrRouter.def;
      if (implsOrOpts === undefined) {
        this.registerContract(def, null, depsOrImpls as ProcedureImpl<any, any>, undefined);
      } else {
        this.registerContract(
          def,
          depsOrImpls as DepsSpec,
          implsOrOpts as ProcedureImpl<any, any>,
          opts as ImplementOptions | undefined,
        );
      }
      return;
    }
    const router = procOrRouter as ContractRouter;
    if (implsOrOpts === undefined) {
      this.registerRouter(router, null, depsOrImpls, undefined);
    } else {
      this.registerRouter(
        router,
        depsOrImpls as DepsSpec,
        implsOrOpts,
        opts as ImplementOptions | undefined,
      );
    }
  }

  private registerContract(
    def: ContractProcedureDef,
    deps: DepsSpec | null,
    entry: ProcedureImpl<any, any>,
    opts: ImplementOptions | undefined,
  ): void {
    this.assertNotFrozen("routes");
    const entryHandler = isHandlerEntry(entry) ? entry : { handler: entry };
    const middlewares = entryHandler.middlewares ?? [];
    if (opts?.middlewares) middlewares.push(...opts.middlewares);
    const wrapped = buildContractHandler(def, entryHandler.handler, {
      exposeStack: this.exposeStack,
      validateOutput: opts?.validateOutput ?? true,
    });
    this.register(def.method, def.path, deps, wrapped, middlewares, def);
  }

  private registerRouter(
    router: ContractRouter,
    deps: DepsSpec | null,
    impls: unknown,
    opts: ImplementOptions | undefined,
  ): void {
    this.assertNotFrozen("routes");
    const problems: string[] = [];
    const walk = (
      node: ContractRouter,
      prefix: string,
      implsNode: Record<string, unknown>,
    ): void => {
      const usedHere = new Set<string>();
      for (const [key, value] of Object.entries(node)) {
        const dotted = prefix === "" ? key : `${prefix}.${key}`;
        if (isContractProcedure(value)) {
          const impl = implsNode[key];
          if (impl === undefined) {
            problems.push(`missing: ${dotted} (${value.def.method} ${value.def.path})`);
          } else {
            usedHere.add(key);
            this.registerContract(value.def, deps, impl as ProcedureImpl<any, any>, opts);
          }
        } else if (typeof value !== "object" || value === null) {
          problems.push(
            `invalid: ${dotted} — expected a ContractProcedure or ContractRouter, got ${
              value === null ? "null" : typeof value
            }`,
          );
        } else {
          const child = implsNode[key];
          if (child === undefined || typeof child !== "object") {
            problems.push(`missing: ${dotted}`);
          } else {
            usedHere.add(key);
            walk(value as ContractRouter, dotted, child as Record<string, unknown>);
          }
        }
      }
      for (const key of Object.keys(implsNode)) {
        if (!usedHere.has(key)) problems.push(`extra: ${prefix === "" ? key : `${prefix}.${key}`}`);
      }
    };
    walk(router, "", impls as Record<string, unknown>);
    if (problems.length > 0) {
      throw new Error(`Router implementation mismatch — ${problems.join("; ")}`);
    }
  }

  route<const Path extends string>(
    method: string,
    path: Path,
    handler: RouteHandler<never, PathParams<Path>>,
  ): void;
  route<const Path extends string, D extends DepsSpec>(
    method: string,
    path: Path,
    deps: D,
    handler: RouteHandler<ResolvedDeps<D>, PathParams<Path>>,
  ): void;
  route(method: string, path: string, a: any, b?: any): void {
    if (b === undefined) this.register(method, path, null, a);
    else this.register(method, path, a, b);
  }
  get<const Path extends string>(path: Path, handler: RouteHandler<never, PathParams<Path>>): void;
  get<const Path extends string, D extends DepsSpec>(
    path: Path,
    deps: D,
    handler: RouteHandler<ResolvedDeps<D>, PathParams<Path>>,
  ): void;
  get(path: string, a: any, b?: any): void {
    if (b === undefined) this.route("GET", path, a);
    else this.route("GET", path, a, b);
  }
  post<const Path extends string>(path: Path, handler: RouteHandler<never, PathParams<Path>>): void;
  post<const Path extends string, D extends DepsSpec>(
    path: Path,
    deps: D,
    handler: RouteHandler<ResolvedDeps<D>, PathParams<Path>>,
  ): void;
  post(path: string, a: any, b?: any): void {
    if (b === undefined) this.route("POST", path, a);
    else this.route("POST", path, a, b);
  }
  put<const Path extends string>(path: Path, handler: RouteHandler<never, PathParams<Path>>): void;
  put<const Path extends string, D extends DepsSpec>(
    path: Path,
    deps: D,
    handler: RouteHandler<ResolvedDeps<D>, PathParams<Path>>,
  ): void;
  put(path: string, a: any, b?: any): void {
    if (b === undefined) this.route("PUT", path, a);
    else this.route("PUT", path, a, b);
  }
  patch<const Path extends string>(
    path: Path,
    handler: RouteHandler<never, PathParams<Path>>,
  ): void;
  patch<const Path extends string, D extends DepsSpec>(
    path: Path,
    deps: D,
    handler: RouteHandler<ResolvedDeps<D>, PathParams<Path>>,
  ): void;
  patch(path: string, a: any, b?: any): void {
    if (b === undefined) this.route("PATCH", path, a);
    else this.route("PATCH", path, a, b);
  }
  delete<const Path extends string>(
    path: Path,
    handler: RouteHandler<never, PathParams<Path>>,
  ): void;
  delete<const Path extends string, D extends DepsSpec>(
    path: Path,
    deps: D,
    handler: RouteHandler<ResolvedDeps<D>, PathParams<Path>>,
  ): void;
  delete(path: string, a: any, b?: any): void {
    if (b === undefined) this.route("DELETE", path, a);
    else this.route("DELETE", path, a, b);
  }
  head<const Path extends string>(path: Path, handler: RouteHandler<never, PathParams<Path>>): void;
  head<const Path extends string, D extends DepsSpec>(
    path: Path,
    deps: D,
    handler: RouteHandler<ResolvedDeps<D>, PathParams<Path>>,
  ): void;
  head(path: string, a: any, b?: any): void {
    if (b === undefined) this.route("HEAD", path, a);
    else this.route("HEAD", path, a, b);
  }
  options<const Path extends string>(
    path: Path,
    handler: RouteHandler<never, PathParams<Path>>,
  ): void;
  options<const Path extends string, D extends DepsSpec>(
    path: Path,
    deps: D,
    handler: RouteHandler<ResolvedDeps<D>, PathParams<Path>>,
  ): void;
  options(path: string, a: any, b?: any): void {
    if (b === undefined) this.route("OPTIONS", path, a);
    else this.route("OPTIONS", path, a, b);
  }

  ws<
    const Path extends string,
    D extends DepsSpec = never,
    Up extends Record<string, unknown> = Record<string, unknown>,
  >(path: Path, handler: WsHandler<D, Up>): this {
    this.assertNotFrozen("ws routes");
    this.wsRegistry.add(path, handler);
    return this;
  }

  static(routPath: string, root: string, opts: Partial<StaticOptions> = {}): void {
    const o: StaticOptions = {
      index: opts.index ?? "index.html",
      maxAge: opts.maxAge ?? 3600,
    };
    const prefix = routPath.replace(/\/+$/, "");
    const serve = async (req: Parameters<RouteHandler>[0], file: string) =>
      serveStatic(root, file, o, req.headers);
    this.register("GET", prefix, null, async (req) => serve(req, ""));
    this.register("GET", `${prefix}/*file`, null, async (req) => {
      return serve(req, (req.params as Record<string, string>).file ?? "");
    });
  }

  group<const Prefix extends string>(prefix: Prefix, fn: (g: GroupApi<Prefix>) => void): void {
    const g = new Group<Prefix>(prefix, []);
    fn(g);
    for (const r of g.routes) {
      this.register(r.method, r.path, r.deps, r.handler, r.groupMiddlewares);
    }
  }

  /** fetch 包装层：先做 WebSocket upgrade 检测，再走正常 HTTP dispatch。 */
  private async handleFetch(req: Request, server: Server<WsData>): Promise<Response> {
    // Real socket peer address from Bun (never derived from headers; XFF
    // trust is opt-in via `trustProxy`, see `ZebraRequest.ip`).
    const ip = server.requestIP(req)?.address;
    if (!isWebSocketUpgrade(req)) return this.dispatch(req, ip);

    const url = new URL(req.url);
    const matched = this.wsRegistry.find(url.pathname);
    if (matched === null) {
      return wsProblemResponse(
        404,
        "not_found",
        `No WebSocket route for ${url.pathname}`,
        url.pathname,
      );
    }

    // C2+C4: 升级决策链。
    // scope 取舍：upgrade 与 wsSession 都是单次请求决策，与 HTTP dispatch 一致走
    // createRequestScopes()（session resolver 在本次升级请求上解析出 sessionId）；
    // 决策完成后立即 dispose，因此 request-scoped 依赖只在钩子执行期间可用，
    // 不要把它们挂在 ws.data 上跨连接使用。会话句柄（C4）是连接级对象，
    // 由 wsSession 钩子构造后随 ws.data 缓存到连接生命周期。
    // 异常路径取舍：upgrade() 抛错 / 依赖解析失败 / wsSession 抛错均视为内部错误
    // → 500 upgrade_error；返回 false 才是客户端显式拒绝 → 401 upgrade_rejected
    // （区别于传输层失败 401 upgrade_failed）。
    const handler = matched.handler;
    let data = buildWsData(handler, matched.params);
    try {
      const scopes = await this.createRequestScopes(req);
      try {
        if (handler.upgrade) {
          const deps = this.resolveDeps(handler.onUpgrade ?? null, scopes.request);
          const zebraReq = buildRequest<Record<string, string>>(
            req,
            matched.params,
            this.bodyOpts,
            ip,
          );
          const result = await handler.upgrade(zebraReq, deps as never, matched.params);
          if (result === false) {
            return wsProblemResponse(
              401,
              "upgrade_rejected",
              "Upgrade rejected by route handler",
              url.pathname,
            );
          }
          if (result) {
            data = buildWsDataWithUpgrade(handler, matched.params, result);
          }
        }
        // C4: sessionId 复用 createRequestScopes 的解析结果；最后写入，upgrade()
        // 的展开数据不能覆盖 session（session 为保留字段）。
        if (this.wsSession) {
          const session = await this.wsSession(req, scopes.sessionId);
          if (session !== undefined) data.session = session;
        }
      } finally {
        await this.disposeScopes(scopes);
      }
    } catch {
      return wsProblemResponse(500, "upgrade_error", "WebSocket upgrade hook failed", url.pathname);
    }
    if (!server.upgrade(req, { data })) {
      return wsProblemResponse(401, "upgrade_failed", "WebSocket upgrade failed", url.pathname);
    }
    return new Response(null, { status: 101 });
  }

  /**
   * Dispatches a raw `Request` through the composed pipeline. `ip` is the
   * socket peer address (`server.requestIP(req)?.address` from `handleFetch`);
   * `dispatch()` without it (tests, proxies) leaves `req.ip` undefined.
   */
  async dispatch(raw: Request, ip?: string): Promise<Response> {
    this.inFlight++;
    const deadline = this.createDeadline(raw);
    try {
      const url = new URL(raw.url);
      let matched = this.router.find(raw.method, url.pathname);
      // HEAD falls back to the GET handler when no HEAD route is registered;
      // the response body is stripped afterwards (see headFromGet).
      let headFromGet = false;
      if (matched === null && raw.method === "HEAD") {
        matched = this.router.find("GET", url.pathname);
        headFromGet = matched !== null;
      }
      const route = matched?.handler;
      const req = buildRequest<Record<string, string>>(
        raw,
        matched?.params ?? {},
        this.bodyOpts,
        ip,
        deadline?.controller.signal,
      );
      const plan = this.planFor(route);

      const res = await this.errorMw(req, async () => {
        return this.raceDeadline(deadline, async () => {
          if (plan.needsScope) {
            const scopes = await this.createRequestScopes(raw);
            let disposed = false;
            const disposeOnce = async (): Promise<void> => {
              if (disposed) return;
              disposed = true;
              await this.disposeScopes(scopes);
            };
            try {
              return await this.raceDeadline(deadline, async () => {
                try {
                  return await this.runWithScopes(req, raw, url, route, scopes, plan);
                } finally {
                  await disposeOnce();
                }
              });
            } catch (error) {
              // Timeout / client-disconnect path: the background work may never
              // settle (hung handler), so dispose the scopes here — the work's
              // own finally is guarded idempotent. Cleanup failures must not
              // mask the 504 that is about to be answered.
              try {
                await disposeOnce();
              } catch {
                // ignore — the deadline error takes precedence
              }
              throw error;
            }
          }
          // Zero-cost fast path: no session resolver and no DI deps anywhere in
          // the chain — no Container child scope, no dep resolution, the
          // precompiled middleware array is run as-is and the handler gets {}.
          return this.runWithoutScopes(req, raw, url, route, plan);
        });
      });
      if (headFromGet && res.body !== null) {
        return new Response(null, {
          status: res.status,
          statusText: res.statusText,
          headers: res.headers,
        });
      }
      return res;
    } finally {
      clearTimeout(deadline?.timer);
      deadline?.detach();
      this.inFlight--;
      if (this.inFlight === 0) {
        for (const resolve of this.drainWaiters) resolve();
        this.drainWaiters.clear();
      }
    }
  }

  /**
   * Creates the per-request deadline when `requestTimeout` is configured.
   * The controller aborts on Bun's client-disconnect signal and on the
   * timeout timer; `detach` removes the client-disconnect wiring once the
   * dispatch has settled.
   */
  private createDeadline(raw: Request): RequestDeadline | null {
    const ms = this.requestTimeout;
    if (ms === undefined) return null;
    const controller = new AbortController();
    let detach = (): void => {};
    const base = raw.signal;
    if (base.aborted) {
      controller.abort();
    } else {
      const onAbort = (): void => controller.abort();
      base.addEventListener("abort", onAbort, { once: true });
      detach = () => base.removeEventListener("abort", onAbort);
    }
    const timer = setTimeout(() => {
      controller.abort(new HttpError(504, "request_timeout", "Request timed out", { limit: ms }));
    }, ms);
    timer.unref?.();
    return { controller, timer, ms, detach };
  }

  /**
   * Races the dispatch pipeline against the deadline signal: when the signal
   * aborts (timeout fired, or client disconnect propagated), the request is
   * answered with a 504 Problem+Json `request_timeout` via the error
   * middleware. The underlying work keeps running in the background but can
   * observe the abort on `req.signal`.
   */
  private raceDeadline(
    deadline: RequestDeadline | null,
    work: () => Promise<Response>,
  ): Promise<Response> {
    if (deadline === null) return work();
    const { controller, ms } = deadline;
    return Promise.race([
      work(),
      new Promise<never>((_, reject) => {
        const onAbort = (): void => {
          controller.signal.removeEventListener("abort", onAbort);
          reject(new HttpError(504, "request_timeout", "Request timed out", { limit: ms }));
        };
        if (controller.signal.aborted) onAbort();
        else controller.signal.addEventListener("abort", onAbort, { once: true });
      }),
    ]);
  }

  private async runWithScopes(
    req: ZebraRequest<Record<string, string>>,
    raw: Request,
    url: URL,
    route: RegisteredRoute | undefined,
    scopes: RequestScopes,
    plan: RoutePlan,
  ): Promise<Response> {
    return compose(
      req,
      this.withResolvedDeps(plan, scopes.request),
      this.finalHandler(req, raw, url, route, scopes.request),
    );
  }

  /** Fast path: plain precompiled middleware chain, handler receives `{}`. */
  private async runWithoutScopes(
    req: ZebraRequest<Record<string, string>>,
    raw: Request,
    url: URL,
    route: RegisteredRoute | undefined,
    plan: RoutePlan,
  ): Promise<Response> {
    return compose(req, plan.middlewares, this.finalHandler(req, raw, url, route, null));
  }

  /** The terminal handler: 404/405 for unmatched paths, deps + handler otherwise. */
  private finalHandler(
    req: ZebraRequest<Record<string, string>>,
    raw: Request,
    url: URL,
    route: RegisteredRoute | undefined,
    scope: Container | null,
  ): () => Promise<Response> {
    return async () => {
      if (!route) {
        const allowed = this.allowedMethodsFor(url.pathname);
        if (allowed) {
          // OPTIONS on a known path is answered automatically with 204 + Allow;
          // an explicitly registered OPTIONS route already won the lookup above.
          // Deliberate: the auto-response runs in the terminal handler, so
          // route-level middlewares (e.g. auth guards) do NOT run for it —
          // preflight requests must stay unauthenticated. Register an explicit
          // OPTIONS route when a custom preflight (or guard) is required.
          if (raw.method === "OPTIONS") {
            return new Response(null, { status: 204, headers: { allow: allowed.join(", ") } });
          }
          throw new HttpError(405, "method_not_allowed", "Method Not Allowed", undefined, {
            allow: allowed.join(", "),
          });
        }
        throw new HttpError(404, "not_found", `No route for ${raw.method} ${url.pathname}`);
      }

      const resolved = scope === null ? {} : this.resolveDeps(route.deps, scope);
      const result = await (route.handler as RouteHandler)(req, resolved);
      return Zebra.toResponse(result);
    };
  }

  private async disposeScopes(scopes: RequestScopes): Promise<void> {
    let cleanupError: unknown;
    try {
      await scopes.request.dispose();
    } catch (error) {
      cleanupError = error;
    }
    if (scopes.ephemeralSession) {
      try {
        await scopes.ephemeralSession.dispose();
      } catch (error) {
        cleanupError ??= error;
      }
    } else if (scopes.sessionId !== undefined) {
      this.releaseSession(scopes.sessionId);
    }
    if (cleanupError !== undefined) throw cleanupError;
  }

  private resolveDeps(deps: DepsSpec | null, scope: Container): Record<string, unknown> {
    const resolved: Record<string, unknown> = {};
    if (!deps) return resolved;
    for (const [name, id] of Object.entries(deps)) resolved[name] = scope.resolve(id);
    return resolved;
  }

  /** Methods supported on a known path; HEAD is implied by GET (RFC 9110 §9.3.2). */
  private allowedMethodsFor(path: string): string[] | null {
    const allowed = this.router.allowedMethods(path);
    if (allowed === null) return null;
    if (allowed.includes("GET") && !allowed.includes("HEAD")) return [...allowed, "HEAD"];
    return allowed;
  }

  private withResolvedDeps(plan: RoutePlan, scope: Container): Middleware[] {
    if (plan.mwDeps.length === 0) return plan.middlewares;
    // Dep indices were precomputed at boot: only the middlewares that declare
    // deps are wrapped (no scanning, no per-request map of every middleware).
    const mws = [...plan.middlewares];
    for (const { index, deps } of plan.mwDeps) {
      const orig = mws[index]!;
      mws[index] = (req, next) => orig(req, next, this.resolveDeps(deps, scope));
    }
    return mws;
  }

  /** Returns the precompiled plan, or computes one on the fly pre-listen (tests/proxies). */
  private planFor(route: RegisteredRoute | undefined): RoutePlan {
    if (this.booted) {
      if (route !== undefined) return this.plans.get(route) ?? this.computePlan(route);
      return this.fallbackPlan ?? this.computePlan(undefined);
    }
    return this.computePlan(route);
  }

  /** Builds the execution plan: precomputed chain + dep indices + scope requirement. */
  private computePlan(route: RegisteredRoute | undefined): RoutePlan {
    const middlewares =
      route !== undefined && route.middlewares.length > 0
        ? [...this.middlewares, ...route.middlewares]
        : this.middlewares;
    const mwDeps: Array<{ index: number; deps: DepsSpec }> = [];
    middlewares.forEach((mw, index) => {
      const deps = getMiddlewareDeps(mw);
      if (deps !== null) mwDeps.push({ index, deps });
    });
    const needsDeps = mwDeps.length > 0 || (route !== undefined && route.deps !== null);
    return {
      middlewares,
      mwDeps,
      needsDeps,
      needsScope: needsDeps || this.sessionResolver !== undefined,
    };
  }

  private async createRequestScopes(raw: Request): Promise<RequestScopes> {
    const resolved = await this.sessionResolver?.(raw);
    const sessionId =
      typeof resolved === "string" &&
      resolved.length > 0 &&
      resolved.length <= MAX_SESSION_ID_LENGTH
        ? resolved
        : undefined;
    if (sessionId === undefined) {
      const session = this.container.createChildScope(ScopeKind.Session);
      return {
        request: session.createChildScope(ScopeKind.Request),
        ephemeralSession: session,
      };
    }

    let record = this.sessions.get(sessionId);
    if (!record) {
      const container = this.container.createChildScope(ScopeKind.Session);
      record = { container, timer: undefined, activeRequests: 0 };
      this.sessions.set(sessionId, record);
    } else if (record.timer) {
      clearTimeout(record.timer);
      record.timer = undefined;
    }
    record.activeRequests++;
    return {
      request: record.container.createChildScope(ScopeKind.Request),
      sessionId,
    };
  }

  private releaseSession(id: string): void {
    const record = this.sessions.get(id);
    if (!record) return;
    record.activeRequests = Math.max(0, record.activeRequests - 1);
    if (record.activeRequests === 0) {
      // Drop any stale timer before arming a fresh one — an orphaned timer
      // must never fire against a session that has since been re-activated.
      if (record.timer) {
        clearTimeout(record.timer);
        record.timer = undefined;
      }
      record.timer = this.scheduleSessionExpiry(id);
    }
  }

  private scheduleSessionExpiry(id: string): ReturnType<typeof setTimeout> {
    const timer = setTimeout(() => {
      void this.expireSession(id);
    }, this.sessionTtl);
    timer.unref?.();
    return timer;
  }

  /**
   * Timer-driven expiry: re-arms when a request re-entered the session in the
   * meantime instead of disposing a live container. The public
   * `disposeSession(id)` remains the explicit, unconditional escape hatch.
   */
  private async expireSession(id: string): Promise<void> {
    const record = this.sessions.get(id);
    if (!record) return;
    if (record.activeRequests > 0) {
      record.timer = this.scheduleSessionExpiry(id);
      return;
    }
    await this.disposeSession(id);
  }

  private static toResponse(result: unknown): Response {
    if (result instanceof Response) return result;
    if (result === undefined) return new Response(null, { status: 204 });
    let body: string;
    try {
      body = JSON.stringify(result);
    } catch {
      // BigInt, circular structures, etc.: surface a structured 500 instead of
      // letting the raw TypeError escape the pipeline.
      throw new HttpError(500, "response_serialization", "Response value is not JSON-serializable");
    }
    return new Response(body, {
      status: 200,
      headers: { "content-type": "application/json; charset=utf-8" },
    });
  }

  private installSignalHandlers(): void {
    if (this.signalHandler) return;
    this.signalHandler = () => {
      void this.stop();
    };
    process.on("SIGTERM", this.signalHandler);
    process.on("SIGINT", this.signalHandler);
  }

  private removeSignalHandlers(): void {
    if (!this.signalHandler) return;
    process.off("SIGTERM", this.signalHandler);
    process.off("SIGINT", this.signalHandler);
    this.signalHandler = null;
  }

  private async performStop(): Promise<void> {
    this.stopped = true;
    this.removeSignalHandlers();
    const server = this.server;
    this.server = null;

    const gracefulStop = Promise.all([
      server?.stop(false) ?? Promise.resolve(),
      this.waitForDrain(),
    ]).then(() => undefined);
    let timer: ReturnType<typeof setTimeout> | undefined;
    const timedOut = await Promise.race([
      gracefulStop.then(() => false),
      new Promise<boolean>((resolve) => {
        timer = setTimeout(() => resolve(true), this.gracePeriod);
        timer.unref?.();
      }),
    ]);
    if (timer) clearTimeout(timer);
    if (timedOut && server) await server.stop(true);

    for (const id of [...this.sessions.keys()]) await this.disposeSession(id);
    await this.container.dispose();
    for (const h of this.hooks.shutdown) await h();
  }

  private waitForDrain(): Promise<void> {
    if (this.inFlight === 0) return Promise.resolve();
    return new Promise((resolve) => this.drainWaiters.add(resolve));
  }
}

function deepFreeze<T>(value: T): T {
  if (value === null || typeof value !== "object" || Object.isFrozen(value)) return value;
  Object.freeze(value);
  for (const key of Object.keys(value)) {
    deepFreeze((value as Record<string, unknown>)[key]);
  }
  return value;
}
