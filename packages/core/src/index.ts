import "reflect-metadata";

export { Zebra } from "./app/app.ts";
export { Container } from "./di/container.ts";
export { token, isToken, type Token, type Identifier, type ClassConstructor, type AbstractConstructor } from "./di/token.ts";
export { injectable, inject, isInjectable, getConstructorDeps } from "./di/decorators.ts";
export { ScopeKind, scopeRank, canDependOn } from "./di/scope.ts";
export { type Disposable, isDisposable } from "./di/disposable.ts";
export {
  CircularDependencyError,
  UnboundTokenError,
  ScopeMismatchError,
} from "./di/errors.ts";
export { HttpError, toProblemJson, type ProblemJson } from "./http/errors.ts";
export { type ZebraRequest, buildRequest } from "./http/request.ts";
export { type Middleware } from "./middleware/types.ts";
export { middleware, getMiddlewareDeps } from "./middleware/helper.ts";
export { type RouteHandler, type DepsSpec, type ZebraOptions, type RegisteredRoute } from "./app/types.ts";
export { type GroupApi } from "./app/group.ts";
export { type LifecycleEvent, type LifecycleHandler } from "./app/lifecycle.ts";
export { validateGraph } from "./app/boot-validation.ts";
export const VERSION = "0.1.0";
