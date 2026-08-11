# Lifecycle

Zebra's lifecycle consists of three event hooks and an explicit graceful-shutdown process. All hooks fire at fixed points in `listen()` / `stop()`.

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

`LifecycleEvent = "boot" | "ready" | "shutdown"`; `on()` returns `this` for chaining. Registering hooks after `listen()` throws.

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
