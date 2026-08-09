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
