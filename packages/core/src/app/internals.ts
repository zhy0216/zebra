import type { Server } from "bun";
import { Container } from "../di/container.ts";
import { EventBus } from "../events.ts";
import type { BodyOptions } from "../http/body.ts";
import { HttpError } from "../http/errors.ts";
import { type ZebraRequest, buildRequest } from "../http/request.ts";
import { compose } from "../middleware/compose.ts";
import { errorMiddleware } from "../middleware/error.ts";
import { getMiddlewareDeps } from "../middleware/helper.ts";
import type { Middleware } from "../middleware/types.ts";
import { Router } from "../router/radix.ts";
import { WsRegistry } from "../ws/registry.ts";
import type { WsData } from "../ws/types.ts";
import { isWebSocketUpgrade } from "../ws/upgrade.ts";
import { validateGraph } from "./boot-validation.ts";
import { type RequestScopes, SessionScopeRegistry } from "./scope-registry.ts";
import type { DepsSpec, RegisteredRoute, RouteHandler } from "./types.ts";
import { handleWsUpgrade } from "./ws-upgrade.ts";

const REQUEST_EVENT_NAMES = ["before.request", "after.request", "request.error"] as const;
const MIDDLEWARE_EVENT_NAMES = [
  "before.middleware",
  "after.middleware",
  "middleware.error",
] as const;

/**
 * Precompiled per-route execution plan, built once at boot (freeze) so the
 * per-request path does no middleware scanning, dep inspection or array
 * concatenation. Routes without DI deps and without a session resolver get a
 * zero-cost fast path that skips Container child scope creation entirely.
 */
export interface RoutePlan {
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

export interface AppInternalsOptions {
  container: Container;
  sessionResolver: ((req: Request) => string | undefined | Promise<string | undefined>) | undefined;
  wsSession:
    | ((req: Request, sessionId: string | undefined) => unknown | Promise<unknown>)
    | undefined;
  sessionTtl: number;
  gracePeriod: number;
  requestTimeout: number | undefined;
  exposeStack: boolean;
  bodyOpts: BodyOptions;
}

/**
 * All mutable app state plus the request pipeline, extracted from the
 * `Zebra` class. `Zebra` keeps the public API (registration, lifecycle
 * entry points) and delegates; this class holds the machinery:
 * router/ws registry/middleware state, session scopes, request dispatch,
 * deadline racing, and graceful shutdown coordination.
 */
export class AppInternals {
  readonly container: Container;
  readonly router = new Router<RegisteredRoute>();
  readonly wsRegistry = new WsRegistry();
  readonly middlewares: Middleware[] = [];
  readonly routes: RegisteredRoute[] = [];
  readonly bodyOpts: BodyOptions;
  readonly exposeStack: boolean;
  readonly wsSession: AppInternalsOptions["wsSession"];
  readonly errorMw: Middleware;
  readonly sessions: SessionScopeRegistry;
  readonly requestTimeout: number | undefined;
  readonly gracePeriod: number;
  /** The app event bus — lifecycle, request and middleware events all flow here. */
  readonly events: EventBus<ZebraEvents>;

  frozen = false;
  server: Server<WsData> | null = null;
  booted = false;
  stopped = false;
  stopping: Promise<void> | null = null;
  private booting: Promise<void> | null = null;
  private readonly plans = new WeakMap<RegisteredRoute, RoutePlan>();
  private fallbackPlan: RoutePlan | null = null;
  private signalHandler: (() => void) | null = null;
  private inFlight = 0;
  private drainWaiters = new Set<() => void>();

  constructor(opts: AppInternalsOptions) {
    this.container = opts.container;
    this.bodyOpts = opts.bodyOpts;
    this.exposeStack = opts.exposeStack;
    this.wsSession = opts.wsSession;
    this.requestTimeout = opts.requestTimeout;
    this.gracePeriod = opts.gracePeriod;
    this.events = new EventBus<ZebraEvents>();
    this.errorMw = errorMiddleware({ exposeStack: this.exposeStack });
    this.sessions = new SessionScopeRegistry(this.container, opts.sessionResolver, opts.sessionTtl);
  }

  /** fetch 包装层：先做 WebSocket upgrade 检测，再走正常 HTTP dispatch。 */
  async handleFetch(req: Request, server: Server<WsData>): Promise<Response> {
    // Real socket peer address from Bun (never derived from headers; XFF
    // trust is opt-in via `trustProxy`, see `ZebraRequest.ip`). Resolved
    // lazily: `requestIP` is a native call most requests never need.
    const getIp = (): string | undefined => server.requestIP(req)?.address;
    if (!isWebSocketUpgrade(req)) return this.dispatch(req, getIp);
    return handleWsUpgrade(this, req, server, getIp);
  }

  /**
   * Dispatches a raw `Request` through the composed pipeline. `ip` is the
   * socket peer address (`server.requestIP(req)?.address` from `handleFetch`);
   * it may also be a thunk resolving the address on first use (what
   * `handleFetch` passes — `requestIP` is only invoked when `req.ip` is
   * actually read). `dispatch()` without it (tests, proxies) leaves
   * `req.ip` undefined.
   */
  async dispatch(raw: Request, ip?: string | (() => string | undefined)): Promise<Response> {
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
        typeof ip === "function" ? undefined : ip,
        deadline?.controller.signal,
        url,
        typeof ip === "function" ? ip : undefined,
      );
      const plan = this.planFor(route);
      const listenRequestEvents = this.events.hasAnyOf(REQUEST_EVENT_NAMES);
      const startedAt = listenRequestEvents ? performance.now() : 0;

      let res: Response;
      if (listenRequestEvents) {
        res = await this.errorMw(req, async () => {
          return this.raceDeadline(deadline, async () => {
            try {
              await this.events.emit("before.request", { request: req, route });
              return await this.runPipeline(plan, req, raw, url, route, deadline);
            } catch (error) {
              await this.emitRequestError(req, route, error, startedAt);
              throw error;
            }
          });
        });
      } else {
        // Zero-listeners fast path: identical pipeline, no event wrapping.
        res = await this.errorMw(req, async () => {
          return this.raceDeadline(deadline, async () =>
            this.runPipeline(plan, req, raw, url, route, deadline),
          );
        });
      }
      if (headFromGet && res.body !== null) {
        res = new Response(null, {
          status: res.status,
          statusText: res.statusText,
          headers: res.headers,
        });
      }
      if (listenRequestEvents) {
        await this.events.emit("after.request", {
          request: req,
          route,
          response: res,
          duration: performance.now() - startedAt,
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

  async prepare(): Promise<void> {
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
    await this.events.emit("boot");
    validateGraph(this.container, this.routes, this.middlewares);
    this.frozen = true;
    // Precompile per-route execution plans (middleware chain, dep indices,
    // scope requirement) once, so dispatch does zero per-request inspection.
    for (const route of this.routes) this.plans.set(route, this.computePlan(route));
    this.fallbackPlan = this.computePlan(undefined);
    this.container.freeze();
    this.booted = true;
  }

  async stop(): Promise<void> {
    if (this.stopping) return this.stopping;
    this.stopping = this.performStop();
    return this.stopping;
  }

  installSignalHandlers(): void {
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

    await this.sessions.disposeAll();
    await this.container.dispose();
    await this.events.emit("shutdown");
  }

  private waitForDrain(): Promise<void> {
    if (this.inFlight === 0) return Promise.resolve();
    return new Promise((resolve) => this.drainWaiters.add(resolve));
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

  /**
   * Runs the composed pipeline (scope path or zero-cost fast path). Extracted
   * so `dispatch` can wrap it with the `request.error` emission uniformly.
   */
  private async runPipeline(
    plan: RoutePlan,
    req: ZebraRequest<Record<string, string>>,
    raw: Request,
    url: URL,
    route: RegisteredRoute | undefined,
    deadline: RequestDeadline | null,
  ): Promise<Response> {
    if (plan.needsScope) {
      const scopes = await this.sessions.createRequestScopes(raw);
      let disposed = false;
      const disposeOnce = async (): Promise<void> => {
        if (disposed) return;
        disposed = true;
        await this.sessions.disposeScopes(scopes);
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
  }

  private async emitRequestError(
    req: ZebraRequest,
    route: RegisteredRoute | undefined,
    error: unknown,
    startedAt: number,
  ): Promise<void> {
    try {
      await this.events.emit("request.error", {
        request: req,
        route,
        error,
        duration: performance.now() - startedAt,
      });
    } catch {
      // The request already failed; a throwing `request.error` listener must
      // not mask the original error or the Problem+Json response that follows.
    }
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
      return AppInternals.toResponse(result);
    };
  }

  resolveDeps(deps: DepsSpec | null, scope: Container): Record<string, unknown> {
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
    const hasSessionResolver = this.sessions.hasResolver();
    // Middleware-event wrappers are created once at plan-compile time (the
    // `middleware` payload keeps the original function reference, not a
    // `Function.name` string). Each wrapper short-circuits on the bus's live
    // listener state, so listener-less runs stay near zero-cost.
    const eventWrapped = middlewares.map((mw, index) => this.wrapForMiddlewareEvents(mw, index));
    return {
      middlewares: eventWrapped,
      mwDeps,
      needsDeps,
      needsScope: needsDeps || hasSessionResolver,
    };
  }

  /**
   * Wraps a middleware to fire `before.middleware` / `after.middleware` /
   * `middleware.error` around its execution. `index` is the precompiled plan
   * position. A throwing `before.*` / `after.*` listener propagates as a normal
   * pipeline error (→ Problem+Json); a throwing error-listener never masks the
   * original middleware error.
   */
  private wrapForMiddlewareEvents(mw: Middleware, index: number): Middleware {
    return (req, next, deps) => {
      if (!this.events.hasAnyOf(MIDDLEWARE_EVENT_NAMES)) return mw(req, next, deps);
      const startedAt = performance.now();
      return (async () => {
        await this.events.emit("before.middleware", { request: req, middleware: mw, index });
        let response: Response;
        try {
          response = await mw(req, next, deps);
        } catch (error) {
          try {
            await this.events.emit("middleware.error", {
              request: req,
              middleware: mw,
              index,
              error,
              duration: performance.now() - startedAt,
            });
          } catch {
            // never mask the original middleware error
          }
          throw error;
        }
        await this.events.emit("after.middleware", {
          request: req,
          middleware: mw,
          index,
          response,
          duration: performance.now() - startedAt,
        });
        return response;
      })();
    };
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
}
