import type { Middleware } from "@zebra/core";

export interface MetricsOptions {
  /** Called once per completed request with the current snapshot. */
  onSample?: (snapshot: MetricsSnapshot) => void;
  /** Bounded latency-sampling window used for percentile estimates. Default 1000. */
  maxLatencySamples?: number;
}

/** Histogram bucket bounds (ms); bucket `i` covers `(bounds[i-1], bounds[i]]`. */
export interface LatencyHistogram {
  bucketBoundsMs: number[];
  buckets: number[];
}

export interface MetricsSnapshot {
  totalRequests: number;
  /** Thrown handler errors plus responses with status >= 500. */
  errors: number;
  inFlight: number;
  peakInFlight: number;
  latency: LatencyHistogram;
  /** Bounded window of the most recent latency samples (ms), capped at `maxLatencySamples`. */
  latencySamples: number[];
  /** Nearest-rank percentile over the bounded sample window; `undefined` before any sample. */
  latencyP50: number | undefined;
  latencyP95: number | undefined;
}

export interface MetricsHandle {
  snapshot(): MetricsSnapshot;
}

export type MetricsMiddleware = Middleware & MetricsHandle;

const BUCKET_BOUNDS_MS = [5, 10, 25, 50, 100, 250, 500, 1000, 2500, 5000, Number.POSITIVE_INFINITY];

function percentile(sorted: number[], p: number): number | undefined {
  if (sorted.length === 0) return undefined;
  const idx = Math.min(sorted.length - 1, Math.max(0, Math.round((p / 100) * sorted.length) - 1));
  return sorted[idx]!;
}

/**
 * Metrics middleware: counts requests, errors (thrown or status >= 500) and
 * in-flight concurrency (with its peak), and keeps a bounded latency sample
 * window plus a fixed histogram. The returned middleware doubles as a handle
 * whose `.snapshot()` returns the current counters.
 */
export function metrics(options: MetricsOptions = {}): MetricsMiddleware {
  const maxSamples = options.maxLatencySamples ?? 1000;
  const onSample = options.onSample;

  let totalRequests = 0;
  let errors = 0;
  let inFlight = 0;
  let peakInFlight = 0;
  const buckets = new Array<number>(BUCKET_BOUNDS_MS.length).fill(0);
  const samples: number[] = [];

  const mw: Middleware = async (_req, next) => {
    const start = performance.now();
    totalRequests++;
    inFlight++;
    if (inFlight > peakInFlight) peakInFlight = inFlight;
    try {
      const res = await next();
      if (res.status >= 500) errors++;
      return res;
    } catch (error) {
      errors++;
      throw error;
    } finally {
      inFlight--;
      const ms = performance.now() - start;
      let idx = BUCKET_BOUNDS_MS.findIndex((bound) => ms <= bound);
      if (idx === -1) idx = BUCKET_BOUNDS_MS.length - 1;
      buckets[idx]!++;
      samples.push(ms);
      if (samples.length > maxSamples) samples.shift();
      if (onSample !== undefined) {
        try {
          onSample(snapshot());
        } catch (callbackError) {
          console.error("[zebra/metrics] onSample threw:", callbackError);
        }
      }
    }
  };

  function snapshot(): MetricsSnapshot {
    const sorted = [...samples].sort((a, b) => a - b);
    return {
      totalRequests,
      errors,
      inFlight,
      peakInFlight,
      latency: { bucketBoundsMs: [...BUCKET_BOUNDS_MS], buckets: [...buckets] },
      latencySamples: [...samples],
      latencyP50: percentile(sorted, 50),
      latencyP95: percentile(sorted, 95),
    };
  }

  return Object.assign(mw, { snapshot }) as MetricsMiddleware;
}
