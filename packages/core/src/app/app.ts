import type { TLSOptions } from "bun";
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
import { type EventArgs, EventBus, type EventHandler } from "../events.ts";
import type { BodyOptions } from "../http/body.ts";
import { type StaticOptions, serveStatic } from "../http/static.ts";
import type { Middleware } from "../middleware/types.ts";
import { buildBunWebSocketHandler } from "../ws/handler.ts";
import { Group, type GroupApi } from "./group.ts";
import { AppInternals } from "./internals.ts";
import type {
  DepsSpec,
  ListenOptions,
  PathParams,
  RegisteredRoute,
  ResolvedDeps,
  RouteHandler,
  ZebraOptions,
} from "./types.ts";
import { type VerbTarget, registerVerb } from "./verbs.ts";

const DEFAULT_BODY: BodyOptions = {
  maxSize: 1024 * 1024,
  json: { limit: 1024 * 1024 },
  form: { limit: 1024 * 1024 },
  multipart: { limit: 16 * 1024 * 1024, maxFiles: 10, maxFileSize: 8 * 1024 * 1024 },
};

const DEFAULT_SESSION_TTL = 30 * 60 * 1000;
const DEFAULT_GRACE_PERIOD = 10_000;

/**
 * The Bun-first app. Public API for registration (routes, DI, middleware,
 * lifecycle, WebSocket, static files, contracts); all request-pipeline
 * machinery lives in `AppInternals` (see internals.ts / scope-registry.ts /
 * ws-upgrade.ts).
 */
export class Zebra {
  /** Internal state + dispatch pipeline; see AppInternals. */
  private readonly internals: AppInternals;
  /** App-level trust statement for `x-forwarded-for` (see `ZebraOptions.trustProxy`). */
  readonly trustProxy: boolean;
  /** Registration sink shared by every verb method (see verbs.ts). */
  private readonly verbs: VerbTarget;
  /** Root DI container (protected — same access surface as pre-split). */
  protected get container(): Container {
    return this.internals.container;
  }

  constructor(opts: ZebraOptions = {}) {
    const sessionTtl = opts.sessionTtl ?? opts.session?.ttl ?? DEFAULT_SESSION_TTL;
    const gracePeriod = opts.gracePeriod ?? DEFAULT_GRACE_PERIOD;
    const requestTimeout = opts.requestTimeout;
    if (sessionTtl <= 0) throw new RangeError("session.ttl must be greater than zero");
    if (gracePeriod < 0) throw new RangeError("gracePeriod must not be negative");
    if (requestTimeout !== undefined && requestTimeout <= 0) {
      throw new RangeError("requestTimeout must be greater than zero");
    }
    this.trustProxy = opts.trustProxy ?? false;
    const container = opts.container ?? new Container();
    this.internals = new AppInternals({
      container,
      sessionResolver: opts.sessionResolver ?? opts.session?.resolver,
      wsSession: opts.session?.wsSession,
      sessionTtl,
      gracePeriod,
      requestTimeout,
      exposeStack: opts.errors?.exposeStack ?? false,
      bodyOpts: {
        maxSize: opts.body?.maxSize ?? DEFAULT_BODY.maxSize,
        json: { ...DEFAULT_BODY.json, ...(opts.body?.json ?? {}) },
        form: { ...DEFAULT_BODY.form, ...(opts.body?.form ?? {}) },
        multipart: { ...DEFAULT_BODY.multipart, ...(opts.body?.multipart ?? {}) },
      },
    });
    this.verbs = {
      add: (method, path, handler) => this.route(method, path, handler),
      addWithDeps: (method, path, deps, handler) => this.route(method, path, deps, handler),
    };
  }

  use(mw: Middleware): this {
    this.assertNotFrozen("middleware");
    this.internals.middlewares.push(mw);
    return this;
  }

  /** Frozen copies of all registered routes (OpenAPI/introspection seam). */
  get routeTable(): ReadonlyArray<RegisteredRoute> {
    return Object.freeze(
      this.internals.routes.map((route) => {
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

  /**
   * Registers an event listener. Lifecycle events (`boot` / `ready` /
   * `shutdown`) may only be registered before `listen()`; request, middleware
   * and user-defined events remain registerable at runtime.
   */
  on<K extends keyof ZebraEvents & string>(event: K, handler: EventHandler<ZebraEvents[K]>): this {
    this.assertLifecycleRegisterable(event);
    this.internals.events.on(event, handler);
    return this;
  }

  /** Registers a one-shot listener, removed before the first dispatch. */
  once<K extends keyof ZebraEvents & string>(
    event: K,
    handler: EventHandler<ZebraEvents[K]>,
  ): this {
    this.assertLifecycleRegisterable(event);
    this.internals.events.once(event, handler);
    return this;
  }

  /** Removes a listener by its original handler (works for `once` registrations). */
  off<K extends keyof ZebraEvents & string>(event: K, handler: EventHandler<ZebraEvents[K]>): this {
    this.internals.events.off(event, handler);
    return this;
  }

  /**
   * Dispatches an event: listeners run in registration order, awaited
   * sequentially. A throwing listener rejects the returned promise and stops
   * the remaining listeners. `undefined`-payload events take no arguments.
   */
  emit<K extends keyof ZebraEvents & string>(
    event: K,
    ...args: EventArgs<ZebraEvents[K]>
  ): Promise<void> {
    return this.internals.events.emit(event, ...args);
  }

  /** The app's event bus — same table as `Zebra.on/once/off/emit`. */
  get events(): EventBus<ZebraEvents> {
    return this.internals.events;
  }

  async listen(opts: ListenOptions): Promise<{ port: number }> {
    if (this.internals.stopped) throw new Error("Zebra has been stopped and cannot listen again");
    if (this.internals.server || this.internals.starting) {
      throw new Error("Zebra is already listening");
    }
    // Acquire the guard before prepare() can invoke any user boot hooks.
    this.internals.starting = true;
    try {
      return await this.performListen(opts);
    } finally {
      this.internals.starting = false;
    }
  }

  private async performListen(opts: ListenOptions): Promise<{ port: number }> {
    await this.prepare();
    // stop() can run during boot, including from inside a boot hook. Do not
    // wait for startup in stop(): that would deadlock a hook awaiting stop().
    if (this.internals.stopped) throw new Error("Zebra has been stopped and cannot listen again");
    const serveOpts: {
      port: number;
      hostname?: string;
      idleTimeout?: number;
      maxRequestBodySize?: number;
      reusePort?: boolean;
      tls?: TLSOptions | TLSOptions[];
      fetch: (
        req: Request,
        server: import("bun").Server<import("../ws/types.ts").WsData>,
      ) => Promise<Response>;
      websocket: import("bun").WebSocketHandler<import("../ws/types.ts").WsData>;
    } = {
      port: opts.port,
      fetch: (req, server) => this.internals.handleFetch(req, server),
      websocket: buildBunWebSocketHandler(),
    };
    if (opts.hostname !== undefined) serveOpts.hostname = opts.hostname;
    if (opts.idleTimeout !== undefined) serveOpts.idleTimeout = opts.idleTimeout;
    if (opts.maxRequestBodySize !== undefined) {
      serveOpts.maxRequestBodySize = opts.maxRequestBodySize;
    }
    if (opts.reusePort !== undefined) serveOpts.reusePort = opts.reusePort;
    if (opts.tls !== undefined) serveOpts.tls = opts.tls;
    const server = Bun.serve(serveOpts);
    this.internals.server = server;
    this.internals.installSignalHandlers();
    try {
      await this.internals.events.emit("ready");
    } catch (error) {
      try {
        await this.stop();
      } catch (cleanupError) {
        // The caller must receive the ready hook's original failure. The
        // separate shutdown failure remains visible in diagnostics and stop().
        console.error("[zebra] shutdown after ready failure failed:", cleanupError);
      }
      throw error;
    }
    if (this.internals.stopped) throw new Error("Zebra has been stopped and cannot listen again");
    return { port: server.port as number };
  }

  async stop(): Promise<void> {
    return this.internals.stop();
  }

  async disposeSession(id: string): Promise<void> {
    await this.internals.sessions.disposeSession(id);
  }

  protected async prepare(): Promise<void> {
    await this.internals.prepare();
  }

  injectValue<T>(id: Identifier<T>, value: T): void {
    this.assertNotFrozen();
    this.internals.container.bind(id).toValue(value);
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
    const builder = this.internals.container.bind(id);
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
    const b = this.internals.container.bind(id);
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
    if (this.internals.frozen) {
      throw new Error(`Cannot register ${kind} after app.listen()`);
    }
  }

  /** Lifecycle hooks freeze at `listen()`; other events stay open at runtime. */
  private assertLifecycleRegisterable(event: string): void {
    if (event === "boot" || event === "ready" || event === "shutdown") {
      this.assertNotFrozen("lifecycle hooks");
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
    this.internals.routes.push(route);
    this.internals.router.add(method, path, route);
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
      exposeStack: this.internals.exposeStack,
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
    registerVerb(this.verbs, "GET", path, a, b);
  }
  post<const Path extends string>(path: Path, handler: RouteHandler<never, PathParams<Path>>): void;
  post<const Path extends string, D extends DepsSpec>(
    path: Path,
    deps: D,
    handler: RouteHandler<ResolvedDeps<D>, PathParams<Path>>,
  ): void;
  post(path: string, a: any, b?: any): void {
    registerVerb(this.verbs, "POST", path, a, b);
  }
  put<const Path extends string>(path: Path, handler: RouteHandler<never, PathParams<Path>>): void;
  put<const Path extends string, D extends DepsSpec>(
    path: Path,
    deps: D,
    handler: RouteHandler<ResolvedDeps<D>, PathParams<Path>>,
  ): void;
  put(path: string, a: any, b?: any): void {
    registerVerb(this.verbs, "PUT", path, a, b);
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
    registerVerb(this.verbs, "PATCH", path, a, b);
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
    registerVerb(this.verbs, "DELETE", path, a, b);
  }
  head<const Path extends string>(path: Path, handler: RouteHandler<never, PathParams<Path>>): void;
  head<const Path extends string, D extends DepsSpec>(
    path: Path,
    deps: D,
    handler: RouteHandler<ResolvedDeps<D>, PathParams<Path>>,
  ): void;
  head(path: string, a: any, b?: any): void {
    registerVerb(this.verbs, "HEAD", path, a, b);
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
    registerVerb(this.verbs, "OPTIONS", path, a, b);
  }

  ws<
    const Path extends string,
    D extends DepsSpec = never,
    Up extends Record<string, unknown> = Record<string, unknown>,
  >(path: Path, handler: import("../ws/types.ts").WsHandler<D, Up>): this {
    this.assertNotFrozen("ws routes");
    this.internals.wsRegistry.add(path, handler);
    return this;
  }

  static(routPath: string, root: string, opts: Partial<StaticOptions> = {}): void {
    const o: StaticOptions = {
      index: opts.index ?? "index.html",
      maxAge: opts.maxAge ?? 3600,
      // Pass every optional knob through — an omitted one keeps serveStatic's
      // own default (cacheTtl 1000, dotfiles "deny").
      ...(opts.cacheTtl !== undefined ? { cacheTtl: opts.cacheTtl } : {}),
      ...(opts.dotfiles !== undefined ? { dotfiles: opts.dotfiles } : {}),
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

  /**
   * Dispatches a raw `Request` through the composed pipeline. `ip` is the
   * socket peer address (`server.requestIP(req)?.address` from the fetch
   * wrapper); it may also be a thunk resolving the address on first use.
   * `dispatch()` without it (tests, proxies) leaves `req.ip` undefined.
   */
  async dispatch(raw: Request, ip?: string | (() => string | undefined)): Promise<Response> {
    return this.internals.dispatch(raw, ip);
  }
}

function deepFreeze<T>(value: T): T {
  for (const key of Object.keys(value as object) as Array<keyof T>) {
    const v = value[key];
    if (v !== null && typeof v === "object") deepFreeze(v);
  }
  return Object.freeze(value);
}
