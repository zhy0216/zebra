# Lifecycle

Zebra exposes boot/ready/shutdown hooks and graceful draining, wired to
`Bun.serve`.

## Hooks

```ts
import { Zebra } from "zebra";

const z = new Zebra();

z.on("boot", async () => {
  // run before the server starts accepting connections
  await connectDatabase();
});

z.on("ready", () => {
  console.log("server is listening");
});

z.on("shutdown", async () => {
  await cleanup();
});
```

- **boot** — runs before `listen` accepts traffic; the DI graph is already
  validated here.
- **ready** — runs once the server is listening.
- **shutdown** — runs during graceful drain on `z.stop()` / SIGINT.

## Disposal

Disposable bindings (`Disposable` interface) are torn down on shutdown; the
disposal is wired into the `Bun.serve` lifecycle so cleanup runs even when
the process is stopping.

## Notes

- Lifecycle hooks cannot be registered after `listen` — Zebra throws if you
  call `z.on` once the app is running.
- `z.stop()` triggers graceful draining: in-flight requests finish, shutdown
  hooks run, disposables are cleaned up.

## Listen options

`z.listen()` accepts the Bun transport options listed below; everything else
flows straight through to `Bun.serve` as-is.

```ts
await z.listen({
  port: 3000,
  hostname: "0.0.0.0",
  idleTimeout: 30,          // seconds before an idle connection is closed (Bun default 10)
  maxRequestBodySize: 4_096, // transport-level body cap in bytes (Bun default 128MB)
  reusePort: true,          // SO_REUSEPORT for multi-process load balancing
  tls: { key: Bun.file("key.pem"), cert: Bun.file("cert.pem") }, // HTTPS
});
```

- **`idleTimeout`** — seconds of inactivity before the connection is closed.
- **`maxRequestBodySize`** — Bun rejects oversized requests at the transport
  level, *before* any handler runs, with a bare 413. Keep it at least as large
  as the largest app-level body limit (see
  [routing → request body limits](routing.md#request-body-limits)) so the app
  parser's more specific per-type limits stay authoritative.
- **`reusePort` / `tls`** — passed through unchanged.

## Request timeout

Set `new Zebra({ requestTimeout: 5_000 })` to give every request a deadline in
milliseconds. When the pipeline (body parsing, session resolution, middleware,
handler) has not answered in time, the client gets a 504 Problem+Json
(`request_timeout`) and the abort is visible to the handler on `req.signal`
(see [routing → timeouts and cancellation](routing.md#timeouts-and-cancellation)).
Opt-in: without it no deadline or cancellation wiring is installed.
`requestTimeout` must be a positive number; `gracePeriod` remains the backstop
for draining in-flight requests during shutdown.
