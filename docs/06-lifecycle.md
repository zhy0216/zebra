# Lifecycle

Zebra's lifecycle consists of three event hooks and an explicit graceful-shutdown process. All hooks fire at fixed points in `listen()` / `stop()`. The hooks are events on a unified, type-safe async event bus that also carries request- and middleware-level events.

## Event hooks

```ts
z.on("boot", async () => {
  // before graph validation and route-plan compilation
});

z.on("ready", async () => {
  // after the server has started accepting connections
});

z.on("shutdown", async () => {
  // after graceful shutdown completes and the container is disposed
});
```

`LifecycleEvent = "boot" | "ready" | "shutdown"`; `on()` returns `this` for chaining. Registering lifecycle hooks after `listen()` throws — request, middleware and user-defined events stay open at runtime.

### Order

```
z.listen()
  ├─ [boot hooks] (in registration order, all awaited)
  ├─ validateGraph: validate the dependency graph (unbound / cycle / scope violation → throw)
  ├─ precompile route execution plans, freeze the container
  ├─ Bun.serve() starts listening
  └─ [ready hooks] (in registration order, all awaited; any failure → stop() and rethrow)

process receives SIGTERM / SIGINT (or you call z.stop())
  └─ [graceful shutdown] (below)
      └─ [shutdown hooks] (after the container and all instances are disposed)
```

### Semantics

- **A failing boot hook**: `listen()` throws and the server never starts.
- **A failing ready hook**: automatically `stop()`s and rethrows — no half-started server is left behind.
- **Shutdown hooks** run *after* the container is disposed. All singleton instances are already released at this point — use it for final cleanup (closing external connections, flushing buffers). Don't resolve container deps here.

## The event bus

All events — lifecycle, request, middleware and user-defined — flow through a single async `EventBus`. It is type-safe: every event carries **at most one payload**, and events without a payload use `undefined` and take no argument at the call site.

```ts
z.on("user.created", (user) => {
  // user: { id: string; email: string }
});
await z.emit("user.created", { id: "u1", email: "a@example.com" });
z.off("user.created", handler);

z.once("boot", () => {});            // fires once, then unsubscribes
await z.emit("ready");               // undefined payload → no argument
```

Semantics:

- Listeners run in registration order and are **awaited sequentially**; a throwing (or rejected) listener rejects the current `emit()` and stops the remaining listeners.
- `once()` listeners are removed before they run — a throwing one never fires again.
- `off()` removes by the original handler and also works for `once()` registrations; registering the same handler twice is deduplicated.
- The listener set is snapshotted at dispatch: listeners added/removed inside an emit only affect the next emit.
- `emit()` with no listeners resolves immediately, doesn't swallow errors, and never logs.

`z.events` exposes the same `EventBus` instance (`EventEmitter` is an alias) for plugins, along with `removeAllListeners()` / `listenerCount()`.

### Declaring events

Zebra does **not** take an events generic. The event table is a global interface you extend from any `.d.ts`:

```ts
// zebra-events.d.ts
import type { UserCreated } from "./domain";

declare global {
  interface ZebraEvents {
    "user.created": UserCreated;
  }
}

export {};
```

Now `z.on("user.created", ...)` and `z.emit("user.created", ...)` are fully typed. Misspelled event names and mismatched payloads are rejected by TypeScript (no string index signature on `ZebraEvents`). Third-party middleware can extend `ZebraMiddlewareEvents` the same way to publish their own events. The exported `ZebraEventMap` is the type alias of `ZebraEvents`.

### Request events

```ts
z.on("before.request", ({ request, route }) => {
  // after routing, before the middleware/handler pipeline
});
z.on("after.request", ({ response, duration }) => {
  // after the final response is produced (2xx/4xx/5xx), before dispatch returns
});
z.on("request.error", ({ error, duration }) => {
  // the original pipeline error, before it becomes Problem+Json
});
```

For a failing request both `request.error` and `after.request` fire (`request.error` first, then `after.request` with the Problem+Json response). Event-listener errors are treated as normal pipeline errors: they can't bypass the Problem+Json error middleware or the request timeout.

### Middleware events

```ts
z.on("before.middleware", ({ middleware, index }) => {});
z.on("after.middleware", ({ middleware, index, response, duration }) => {});
z.on("middleware.error", ({ middleware, index, error, duration }) => {});
```

They fire per middleware, in the precompiled route-plan order (`index`), and `middleware` is the original function reference (never a `Function.name` string). The wrappers are compiled once at boot; with no listeners the request pipeline keeps its zero-cost fast path, and a throwing `middleware.error` listener never masks the original error.

## Graceful shutdown `stop()`

`z.stop()` is idempotent (concurrent calls run once), and runs:

1. Marks `stopped`, removes signal handlers, stops accepting new connections (`Bun.serve.stop(false)`).
2. **Waits for in-flight requests to drain** (`waitForDrain`), racing against `gracePeriod` (default 10 seconds):
   - on timeout, force-terminates remaining connections (`server.stop(true)`).
3. Reclaims all session-scope containers (`disposeSession`, one by one).
4. Disposes the root container (every singleton's `dispose()`, LIFO).
5. Runs `shutdown` hooks.

Process signals (SIGTERM / SIGINT) trigger `stop()` automatically — when a platform (Railway / Fly / K8s) sends SIGTERM, the app drains gracefully instead of being killed immediately.

```ts
await z.listen({ port: 3000 });
// SIGTERM triggers the shutdown flow above automatically
```

Or call it manually:

```ts
const server = await z.listen({ port: 3000 });
process.on("SIGUSR2", () => void z.stop());
```

A stopped app cannot `listen()` again (throws `Zebra has been stopped and cannot listen again`).

## Session scope reclamation

Session containers (the cache containers behind session-scoped DI):

- A resolver returns `sessionId` → the session container is created on first use, tracking active-request count.
- When active requests hit 0, an idle timer of `sessionTtl` (default 30 min) starts; a returning request cancels it.
- Timer expiry → `disposeSession(id)`: clears the timer, disposes the container (releasing that session's session-scoped instances).
- `app.disposeSession(id)` reclaims one immediately (e.g. at logout).

> Data-level session expiry is owned by `@zebra/session`'s store (a separate TTL owner); core's `sessionTtl` only reclaims the DI container. The two are independent by design — see [Sessions](07-sessions.md#ttl-ownership).

## Disposal

Instances implementing `Disposable` (`dispose(): Promise<void>`) are disposed at scope end:

- request scope → request end (success or failure)
- session scope → session reclamation / `disposeSession(id)`
- singleton → `stop()`

Disposal is LIFO (dependencies before dependents), and a single failed disposal does not block the rest (errors are aggregated and rethrown).

## Next steps

- [DI: scopes and disposal details](03-di.md)
- [Sessions: cookie sessions and TTL ownership](07-sessions.md)
- [Production: shutdown and health checks](15-production.md)
