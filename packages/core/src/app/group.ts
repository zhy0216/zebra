import type { Middleware } from "../middleware/types.ts";
import type { DepsSpec, JoinPath, PathParams, ResolvedDeps, RouteHandler } from "./types.ts";
import { type VerbTarget, registerVerb } from "./verbs.ts";

export interface GroupApi<Prefix extends string = string> {
  use(mw: Middleware): this;
  route<const Path extends string>(
    method: string,
    path: Path,
    handler: RouteHandler<never, PathParams<JoinPath<Prefix, Path>>>,
  ): void;
  route<const Path extends string, D extends DepsSpec>(
    method: string,
    path: Path,
    deps: D,
    handler: RouteHandler<ResolvedDeps<D>, PathParams<JoinPath<Prefix, Path>>>,
  ): void;
  get<const Path extends string>(
    path: Path,
    handler: RouteHandler<never, PathParams<JoinPath<Prefix, Path>>>,
  ): void;
  get<const Path extends string, D extends DepsSpec>(
    path: Path,
    deps: D,
    handler: RouteHandler<ResolvedDeps<D>, PathParams<JoinPath<Prefix, Path>>>,
  ): void;
  post<const Path extends string>(
    path: Path,
    handler: RouteHandler<never, PathParams<JoinPath<Prefix, Path>>>,
  ): void;
  post<const Path extends string, D extends DepsSpec>(
    path: Path,
    deps: D,
    handler: RouteHandler<ResolvedDeps<D>, PathParams<JoinPath<Prefix, Path>>>,
  ): void;
  put<const Path extends string>(
    path: Path,
    handler: RouteHandler<never, PathParams<JoinPath<Prefix, Path>>>,
  ): void;
  put<const Path extends string, D extends DepsSpec>(
    path: Path,
    deps: D,
    handler: RouteHandler<ResolvedDeps<D>, PathParams<JoinPath<Prefix, Path>>>,
  ): void;
  patch<const Path extends string>(
    path: Path,
    handler: RouteHandler<never, PathParams<JoinPath<Prefix, Path>>>,
  ): void;
  patch<const Path extends string, D extends DepsSpec>(
    path: Path,
    deps: D,
    handler: RouteHandler<ResolvedDeps<D>, PathParams<JoinPath<Prefix, Path>>>,
  ): void;
  delete<const Path extends string>(
    path: Path,
    handler: RouteHandler<never, PathParams<JoinPath<Prefix, Path>>>,
  ): void;
  delete<const Path extends string, D extends DepsSpec>(
    path: Path,
    deps: D,
    handler: RouteHandler<ResolvedDeps<D>, PathParams<JoinPath<Prefix, Path>>>,
  ): void;
  head<const Path extends string>(
    path: Path,
    handler: RouteHandler<never, PathParams<JoinPath<Prefix, Path>>>,
  ): void;
  head<const Path extends string, D extends DepsSpec>(
    path: Path,
    deps: D,
    handler: RouteHandler<ResolvedDeps<D>, PathParams<JoinPath<Prefix, Path>>>,
  ): void;
  options<const Path extends string>(
    path: Path,
    handler: RouteHandler<never, PathParams<JoinPath<Prefix, Path>>>,
  ): void;
  options<const Path extends string, D extends DepsSpec>(
    path: Path,
    deps: D,
    handler: RouteHandler<ResolvedDeps<D>, PathParams<JoinPath<Prefix, Path>>>,
  ): void;
  group<const ChildPrefix extends string>(
    prefix: ChildPrefix,
    fn: (g: GroupApi<JoinPath<Prefix, ChildPrefix>>) => void,
  ): void;
}

export interface GroupedRoute {
  method: string;
  path: string;
  deps: DepsSpec | null;
  handler: RouteHandler;
  groupMiddlewares: Middleware[];
}

export class Group<Prefix extends string = string> implements GroupApi<Prefix> {
  middlewares: Middleware[] = [];
  routes: GroupedRoute[] = [];
  private prefix: string;
  private inherited: Middleware[];
  /** Registration sink shared by every verb method (see verbs.ts). */
  private readonly verbs: VerbTarget = {
    add: (method, path, handler) => this.register(method, path, null, handler),
    addWithDeps: (method, path, deps, handler) => this.register(method, path, deps, handler),
  };

  constructor(prefix: Prefix, inherited: Middleware[] = []) {
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
    const joined = this.prefix + (path.startsWith("/") ? path : `/${path}`);
    this.routes.push({
      method,
      path: joined,
      deps,
      handler,
      groupMiddlewares: [...this.inherited, ...this.middlewares],
    });
  }

  route<const Path extends string>(
    method: string,
    path: Path,
    handler: RouteHandler<never, PathParams<JoinPath<Prefix, Path>>>,
  ): void;
  route<const Path extends string, D extends DepsSpec>(
    method: string,
    path: Path,
    deps: D,
    handler: RouteHandler<ResolvedDeps<D>, PathParams<JoinPath<Prefix, Path>>>,
  ): void;
  route(method: string, path: string, a: any, b?: any): void {
    if (b === undefined) this.register(method, path, null, a);
    else this.register(method, path, a, b);
  }
  get<const Path extends string>(
    path: Path,
    handler: RouteHandler<never, PathParams<JoinPath<Prefix, Path>>>,
  ): void;
  get<const Path extends string, D extends DepsSpec>(
    path: Path,
    deps: D,
    handler: RouteHandler<ResolvedDeps<D>, PathParams<JoinPath<Prefix, Path>>>,
  ): void;
  get(path: string, a: any, b?: any): void {
    registerVerb(this.verbs, "GET", path, a, b);
  }
  post<const Path extends string>(
    path: Path,
    handler: RouteHandler<never, PathParams<JoinPath<Prefix, Path>>>,
  ): void;
  post<const Path extends string, D extends DepsSpec>(
    path: Path,
    deps: D,
    handler: RouteHandler<ResolvedDeps<D>, PathParams<JoinPath<Prefix, Path>>>,
  ): void;
  post(path: string, a: any, b?: any): void {
    registerVerb(this.verbs, "POST", path, a, b);
  }
  put<const Path extends string>(
    path: Path,
    handler: RouteHandler<never, PathParams<JoinPath<Prefix, Path>>>,
  ): void;
  put<const Path extends string, D extends DepsSpec>(
    path: Path,
    deps: D,
    handler: RouteHandler<ResolvedDeps<D>, PathParams<JoinPath<Prefix, Path>>>,
  ): void;
  put(path: string, a: any, b?: any): void {
    registerVerb(this.verbs, "PUT", path, a, b);
  }
  patch<const Path extends string>(
    path: Path,
    handler: RouteHandler<never, PathParams<JoinPath<Prefix, Path>>>,
  ): void;
  patch<const Path extends string, D extends DepsSpec>(
    path: Path,
    deps: D,
    handler: RouteHandler<ResolvedDeps<D>, PathParams<JoinPath<Prefix, Path>>>,
  ): void;
  patch(path: string, a: any, b?: any): void {
    registerVerb(this.verbs, "PATCH", path, a, b);
  }
  delete<const Path extends string>(
    path: Path,
    handler: RouteHandler<never, PathParams<JoinPath<Prefix, Path>>>,
  ): void;
  delete<const Path extends string, D extends DepsSpec>(
    path: Path,
    deps: D,
    handler: RouteHandler<ResolvedDeps<D>, PathParams<JoinPath<Prefix, Path>>>,
  ): void;
  delete(path: string, a: any, b?: any): void {
    registerVerb(this.verbs, "DELETE", path, a, b);
  }
  head<const Path extends string>(
    path: Path,
    handler: RouteHandler<never, PathParams<JoinPath<Prefix, Path>>>,
  ): void;
  head<const Path extends string, D extends DepsSpec>(
    path: Path,
    deps: D,
    handler: RouteHandler<ResolvedDeps<D>, PathParams<JoinPath<Prefix, Path>>>,
  ): void;
  head(path: string, a: any, b?: any): void {
    registerVerb(this.verbs, "HEAD", path, a, b);
  }
  options<const Path extends string>(
    path: Path,
    handler: RouteHandler<never, PathParams<JoinPath<Prefix, Path>>>,
  ): void;
  options<const Path extends string, D extends DepsSpec>(
    path: Path,
    deps: D,
    handler: RouteHandler<ResolvedDeps<D>, PathParams<JoinPath<Prefix, Path>>>,
  ): void;
  options(path: string, a: any, b?: any): void {
    registerVerb(this.verbs, "OPTIONS", path, a, b);
  }

  group<const ChildPrefix extends string>(
    prefix: ChildPrefix,
    fn: (g: GroupApi<JoinPath<Prefix, ChildPrefix>>) => void,
  ): void {
    const childPrefix = this.prefix + (prefix.startsWith("/") ? prefix : `/${prefix}`);
    const child = new Group<JoinPath<Prefix, ChildPrefix>>(
      childPrefix as JoinPath<Prefix, ChildPrefix>,
      [...this.inherited, ...this.middlewares],
    );
    fn(child);
    for (const r of child.routes) this.routes.push(r);
  }
}
