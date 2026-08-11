# Observability (@zebra/observability)

A zero-dependency observability middleware suite: request id, access logs, error reporting, metrics, and health endpoints. All pure middleware — nothing depends on `@zebra/core` beyond its types, nothing ships its own logger; **you bring the sinks**.

## Install

```sh
bun add @zebra/observability
```

## Quick start

```ts
import { Zebra } from "@zebra/core";
import { accessLog, errorReporter, health, metrics, requestId } from "@zebra/observability";

const app = new Zebra();

app.use(requestId()); // must be first: everything below correlates on the id
app.use(accessLog()); // console.log per request
app.use(errorReporter((error, req, info) => {
  console.error("handler failed", error, info.requestId);
}));
const metricsHandle = metrics({ onSample: (s) => console.log(s) });
app.use(metricsHandle);
app.use(health({ readiness: () => db.ping() }));

app.get("/", () => Response.json({ ok: true }));
```

**Middleware order matters**: `requestId` must be registered before `accessLog` / `errorReporter` / `metrics` so they can read the id from `req.ctx`. Health probes are ordinary requests — registering `health` inside the stack logs and counts them too.

## requestId

```ts
requestId({ headerName?, generator?, propagate? })
```

- Keeps a client-provided `x-request-id` (or the configured header), or generates one (default `crypto.randomUUID`).
- Stores it on `req.ctx` (`REQUEST_ID_KEY`), read via `getRequestId(req)`.
- `propagate: true` (default) echoes the id on the response header.

```ts
import { getRequestId, requestId } from "@zebra/observability";

app.use(requestId({ headerName: "x-trace-id" }));
app.get("/", (req) => Response.json({ id: getRequestId(req) }));
```

> Note: responses produced by core's error middleware are built after this middleware unwinds, so error responses **don't** carry the `x-request-id` header — correlate via the access log / error reporter (they do see it).

## accessLog

```ts
accessLog({ writer? })
```

Emits one entry per request via the writer (default: single-line `console.log`):

```ts
interface AccessLogEntry {
  method: string;
  path: string;
  status: number | undefined; // undefined when the handler threw
  durationMs: number;
  requestId: string | undefined;
  timestamp: number;          // epoch ms
  error?: unknown;            // set when the handler threw
}
```

```ts
app.use(accessLog({ writer: (entry) => sink.write(JSON.stringify(entry)) }));
```

- Errors are recorded on the entry and **rethrown unchanged** — core still converts them to Problem+Json.
- A throwing writer never breaks the request (swallowed and logged).

## errorReporter

```ts
errorReporter((error, req, info) => void)
```

Runs inside `next()`, so it observes thrown errors **before** core's error middleware converts them to Problem+Json. The error is always rethrown unchanged, and a throwing reporter never masks it:

```ts
app.use(errorReporter((error, req, info) => {
  sentry.captureException(error, { extra: info }); // { method, path, requestId }
}));
```

`info = { method, path, requestId }` (`requestId` may be `undefined` — needs the `requestId` middleware registered before).

## metrics

```ts
metrics({ onSample?, maxLatencySamples? })
```

Counters: total requests, errors (thrown or status ≥ 500), in-flight concurrency (with its peak), plus a fixed latency histogram and a bounded sample window (p50/p95). The middleware doubles as a handle:

```ts
const m = metrics({ onSample: (s) => pushToPrometheus(s) });
app.use(m);

const snapshot = m.snapshot();
// {
//   totalRequests, errors, inFlight, peakInFlight,
//   latency: { bucketBoundsMs, buckets },
//   latencySamples, latencyP50, latencyP95
// }
```

- Histogram buckets (ms): `[5, 10, 25, 50, 100, 250, 500, 1000, 2500, 5000, ∞]`.
- Latency samples are capped at `maxLatencySamples` (default 1000), so memory stays bounded; percentiles are nearest-rank over that window.
- `onSample` fires once per request; a throwing callback never breaks the request.

## health

```ts
health({ path?, readinessPath?, liveness?, readiness? })
```

- Liveness `GET /healthz` (default `path`), readiness `GET /readyz` (default `readinessPath`).
- Healthy → `{"status":"ok"}` / 200; unhealthy → `{"status":"unavailable"}` / 503.
- Probes are user callbacks (default always healthy); a throwing probe counts as unhealthy (and is logged) — **health endpoints always answer**, so load balancers always get a decision.
- All other paths pass through.

```ts
app.use(health({
  readiness: async () => (await db.ping()) === "OK",
  liveness: () => true,
}));
```

## Production composition example

```ts
app.use(requestId());
app.use(accessLog());
app.use(errorReporter((err, req, info) => log.error(err, info)));
const metricsHandle = metrics();
app.use(metricsHandle);
app.use(health({ readiness: () => dbHealthy() }));

// push metrics periodically to Prometheus / expose a pull endpoint
setInterval(() => push(metricsHandle.snapshot()), 10_000);
```
