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
import { buildRequest } from "../http/request.ts";
import { type StaticOptions, serveStatic } from "../http/static.ts";
import { compose } from "../middleware/compose.ts";
import { errorMiddleware } from "../middleware/error.ts";
import { getMiddlewareDeps } from "../middleware/helper.ts";
import type { Middleware } from "../middleware/types.ts";
import { Router } from "../router/radix.ts";
import { validateGraph } from "./boot-validation.ts";
import { Group, type GroupApi } from "./group.ts";
import type { LifecycleEvent, LifecycleHandler } from "./lifecycle.ts";
import type {
  DepsSpec,
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

export class Zebra {
  protected container: Container;
  protected router = new Router<RegisteredRoute>();
  protected middlewares: Middleware[] = [];
  protected routes: RegisteredRoute[] = [];
  protected bodyOpts: BodyOptions;
  protected exposeStack: boolean;
  protected frozen = false;
  protected hooks: Record<LifecycleEvent, LifecycleHandler[]> = {
    boot: [],
    ready: [],
    shutdown: [],
  };
  protected server: ReturnType<typeof Bun.serve> | null = null;
  private readonly sessionResolver: NonNullable<ZebraOptions["session"]>["resolver"];
  private readonly sessionTtl: number;
  private readonly gracePeriod: number;
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
    this.sessionResolver = opts.sessionResolver ?? opts.session?.resolver;
    this.sessionTtl = opts.sessionTtl ?? opts.session?.ttl ?? DEFAULT_SESSION_TTL;
    this.gracePeriod = opts.gracePeriod ?? DEFAULT_GRACE_PERIOD;
    if (this.sessionTtl <= 0) throw new RangeError("session.ttl must be greater than zero");
    if (this.gracePeriod < 0) throw new RangeError("gracePeriod must not be negative");
  }

  use(mw: Middleware): this {
    this.assertNotFrozen("middleware");
    this.middlewares.push(mw);
    return this;
  }

  /** Frozen copies of all registered routes (OpenAPI/introspection seam). */
  get routeTable(): ReadonlyArray<RegisteredRoute> {
    return Object.freeze(this.routes.map((route) => Object.freeze({ ...route })));
  }

  on(event: LifecycleEvent, fn: LifecycleHandler): this {
    this.assertNotFrozen("lifecycle hooks");
    this.hooks[event].push(fn);
    return this;
  }

  async listen(opts: { port: number; hostname?: string }): Promise<{ port: number }> {
    if (this.stopped) throw new Error("Zebra has been stopped and cannot listen again");
    if (this.server) throw new Error("Zebra is already listening");
    await this.prepare();
    if (this.stopped) throw new Error("Zebra has been stopped and cannot listen again");
    if (this.server) throw new Error("Zebra is already listening");
    const serveOpts: {
      port: number;
      hostname?: string;
      fetch: (req: Request) => Promise<Response>;
    } = {
      port: opts.port,
      fetch: (req) => this.dispatch(req),
    };
    if (opts.hostname !== undefined) serveOpts.hostname = opts.hostname;
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

  get<const Path extends string>(path: Path, handler: RouteHandler<never, PathParams<Path>>): void;
  get<const Path extends string, D extends DepsSpec>(
    path: Path,
    deps: D,
    handler: RouteHandler<ResolvedDeps<D>, PathParams<Path>>,
  ): void;
  get(path: string, a: any, b?: any): void {
    if (b === undefined) this.register("GET", path, null, a);
    else this.register("GET", path, a, b);
  }
  post<const Path extends string>(path: Path, handler: RouteHandler<never, PathParams<Path>>): void;
  post<const Path extends string, D extends DepsSpec>(
    path: Path,
    deps: D,
    handler: RouteHandler<ResolvedDeps<D>, PathParams<Path>>,
  ): void;
  post(path: string, a: any, b?: any): void {
    if (b === undefined) this.register("POST", path, null, a);
    else this.register("POST", path, a, b);
  }
  put<const Path extends string>(path: Path, handler: RouteHandler<never, PathParams<Path>>): void;
  put<const Path extends string, D extends DepsSpec>(
    path: Path,
    deps: D,
    handler: RouteHandler<ResolvedDeps<D>, PathParams<Path>>,
  ): void;
  put(path: string, a: any, b?: any): void {
    if (b === undefined) this.register("PUT", path, null, a);
    else this.register("PUT", path, a, b);
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
    if (b === undefined) this.register("PATCH", path, null, a);
    else this.register("PATCH", path, a, b);
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
    if (b === undefined) this.register("DELETE", path, null, a);
    else this.register("DELETE", path, a, b);
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

  async dispatch(raw: Request): Promise<Response> {
    this.inFlight++;
    const url = new URL(raw.url);
    const matched = this.router.find(raw.method, url.pathname);
    const route = matched?.handler;
    const req = buildRequest(raw, matched?.params ?? {}, this.bodyOpts);
    const errors = errorMiddleware({ exposeStack: this.exposeStack });

    try {
      return await errors(req, async () => {
        const scopes = await this.createRequestScopes(raw);
        try {
          const routeMiddlewares = route?.middlewares ?? [];
          const allMiddlewares = this.withResolvedDeps(
            [...this.middlewares, ...routeMiddlewares],
            scopes.request,
          );

          return compose(req, allMiddlewares, async () => {
            if (!route) {
              throw new HttpError(404, "not_found", `No route for ${raw.method} ${url.pathname}`);
            }

            const resolved = this.resolveDeps(route.deps, scopes.request);
            const result = await (route.handler as RouteHandler)(req, resolved);
            return Zebra.toResponse(result);
          });
        } finally {
          await scopes.request.dispose();
          if (scopes.ephemeralSession) {
            await scopes.ephemeralSession.dispose();
          } else if (scopes.sessionId !== undefined) {
            this.releaseSession(scopes.sessionId);
          }
        }
      });
    } finally {
      this.inFlight--;
      if (this.inFlight === 0) {
        for (const resolve of this.drainWaiters) resolve();
        this.drainWaiters.clear();
      }
    }
  }

  private resolveDeps(deps: DepsSpec | null, scope: Container): Record<string, unknown> {
    const resolved: Record<string, unknown> = {};
    if (!deps) return resolved;
    for (const [name, id] of Object.entries(deps)) resolved[name] = scope.resolve(id);
    return resolved;
  }

  private withResolvedDeps(middlewares: Middleware[], scope: Container): Middleware[] {
    return middlewares.map((mw) => {
      const deps = getMiddlewareDeps(mw);
      if (!deps) return mw;
      return (req, next) => mw(req, next, this.resolveDeps(deps, scope));
    });
  }

  private async createRequestScopes(raw: Request): Promise<RequestScopes> {
    const sessionId = await this.sessionResolver?.(raw);
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
    if (record.activeRequests === 0) record.timer = this.scheduleSessionExpiry(id);
  }

  private scheduleSessionExpiry(id: string): ReturnType<typeof setTimeout> {
    const timer = setTimeout(() => {
      void this.disposeSession(id);
    }, this.sessionTtl);
    timer.unref?.();
    return timer;
  }

  private static toResponse(result: unknown): Response {
    if (result instanceof Response) return result;
    return new Response(JSON.stringify(result), {
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
