# @zebra-web/observability

Zero-dependency observability middleware for zebra apps: request id, access
logs, error reporting, metrics and health endpoints. Pure middleware — nothing
here touches `@zebra-web/core` or ships its own logger; you bring the sinks.

## Install

```bash
bun add @zebra-web/observability
```

## Quick start

```ts
import { Zebra } from "@zebra-web/core";
import { accessLog, errorReporter, health, metrics, requestId } from "@zebra-web/observability";

const app = new Zebra();

app.use(requestId()); // first: everything below can correlate on the id
app.use(accessLog()); // console.log per request
app.use(errorReporter((error, req, info) => {
  console.error("handler failed", error, info.requestId);
}));
const metricsHandle = metrics({ onSample: (s) => console.log(s) });
app.use(metricsHandle);
app.use(health({ readiness: () => db.ping() }));

app.get("/", () => Response.json({ ok: true }));
```

Middleware order matters: `requestId` must be registered before `accessLog`,
`errorReporter` and `metrics` so they can read the id from `req.ctx`. Health
probes are ordinary requests, so registering `health` inside the observability
stack logs and counts them too.

## requestId

`requestId({ headerName?, generator?, propagate? })` keeps a client-provided
`x-request-id` (or the configured header) or generates one
(`crypto.randomUUID` by default), stores it on `req.ctx` and echoes it on the
response header (`propagate`, default `true`).

```ts
import { getRequestId, requestId } from "@zebra-web/observability";

app.use(requestId({ headerName: "x-trace-id" }));
app.get("/", (req) => Response.json({ id: getRequestId(req) }));
```

`getRequestId(req)` returns the id for the current request, or `undefined` if
the middleware did not run (e.g. inside raw `dispatch` paths). Note: responses
produced by core's error middleware (thrown handlers) are built after this
middleware unwinds, so the error response does not carry the `x-request-id`
header — correlate via the access log / error reporter, which do see it.

## accessLog

`accessLog({ writer? })` emits one entry per request via the writer (default:
a single-line `console.log`):

```ts
export interface AccessLogEntry {
  method: string;
  path: string;
  status: number | undefined; // undefined when the handler threw
  durationMs: number;
  requestId: string | undefined;
  timestamp: number;
  error?: unknown;            // set when the handler threw
}

app.use(accessLog({
  writer: (entry) => sink.write(JSON.stringify(entry)),
}));
```

Errors are recorded on the entry and rethrown unchanged — core still converts
them into the Problem+Json response, and a throwing writer never breaks the
request.

## errorReporter

`errorReporter(reporter)` wraps `next()` so it observes thrown errors before
core's error middleware converts them to Problem+Json. The error is always
rethrown unchanged and a throwing reporter never masks it.

```ts
app.use(errorReporter((error, req, info) => {
  sentry.captureException(error, { extra: info }); // { method, path, requestId }
}));
```

## metrics

`metrics({ onSample?, maxLatencySamples? })` counts requests, errors (thrown
or status >= 500) and in-flight concurrency (with its peak), and keeps a fixed
latency histogram plus a bounded sample window for p50/p95. The middleware
doubles as a handle:

```ts
const m = metrics({ onSample: (s) => pushToPrometheus(s) });
app.use(m);

const snapshot = m.snapshot();
// { totalRequests, errors, inFlight, peakInFlight,
//   latency: { bucketBoundsMs, buckets }, latencySamples, latencyP50, latencyP95 }
```

Histogram buckets (ms): `[5, 10, 25, 50, 100, 250, 500, 1000, 2500, 5000, ∞]`.
Latency samples are capped at `maxLatencySamples` (default 1000), so memory
stays bounded; percentiles are nearest-rank over that window. A throwing
`onSample` never breaks the request.

## health

`health({ path?, readinessPath?, liveness?, readiness? })` answers liveness
on `/healthz` (default `path`) and readiness on `/readyz` (default
`readinessPath`) with `{"status":"ok"}` / 200 or `{"status":"unavailable"}`
/ 503. All other paths pass through. Probes are user callbacks — no business
logic lives here; default probes are always healthy. A throwing probe is
treated as unavailable (and logged), so health endpoints always answer.

```ts
app.use(health({
  readiness: async () => (await db.ping()) === "OK",
}));
```
