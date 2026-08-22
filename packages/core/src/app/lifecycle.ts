import type { ZebraRequest } from "../http/request.ts";
import type { Middleware } from "../middleware/types.ts";
import type { RegisteredRoute } from "./types.ts";

export type LifecycleEvent = "boot" | "ready" | "shutdown";
export type LifecycleHandler = () => void | Promise<void>;

export interface BeforeRequestEvent {
  readonly request: ZebraRequest;
  readonly route: RegisteredRoute | undefined;
}

export interface AfterRequestEvent {
  readonly request: ZebraRequest;
  readonly route: RegisteredRoute | undefined;
  readonly response: Response;
  readonly duration: number;
}

export interface RequestErrorEvent {
  readonly request: ZebraRequest;
  readonly route: RegisteredRoute | undefined;
  readonly error: unknown;
  readonly duration: number;
}

export interface BeforeMiddlewareEvent {
  readonly request: ZebraRequest;
  readonly middleware: Middleware;
  readonly index: number;
}

export interface AfterMiddlewareEvent {
  readonly request: ZebraRequest;
  readonly middleware: Middleware;
  readonly index: number;
  readonly response: Response;
  readonly duration: number;
}

export interface MiddlewareErrorEvent {
  readonly request: ZebraRequest;
  readonly middleware: Middleware;
  readonly index: number;
  readonly error: unknown;
  readonly duration: number;
}

/**
 * The event table for the app. Extensible by users and third-party packages via
 * `declare global { interface ZebraEvents { ... } }` — never add a string index
 * signature here, or misspelled event names would type-check.
 */
declare global {
  interface ZebraMiddlewareEvents {
    "before.middleware": BeforeMiddlewareEvent;
    "after.middleware": AfterMiddlewareEvent;
    "middleware.error": MiddlewareErrorEvent;
  }

  interface ZebraEvents extends ZebraMiddlewareEvents {
    boot: undefined;
    ready: undefined;
    shutdown: undefined;
    "before.request": BeforeRequestEvent;
    "after.request": AfterRequestEvent;
    "request.error": RequestErrorEvent;
  }
}

/** Exported alias of the global (extensible) `ZebraEvents` table. */
export type ZebraEventMap = ZebraEvents;
