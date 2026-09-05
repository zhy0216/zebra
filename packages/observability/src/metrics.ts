import type { Middleware } from "@zebra-web/core";

export interface MetricsOptions {
  /** Called once per completed request with the current snapshot. */
  onSample?: (snapshot: MetricsSnapshot) => void;
  /**
   * Non-negative finite integer capacity for percentile samples. Default 1000.
   * Zero disables sample retention; counters and histogram buckets still update.
   */
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
  const idx = Math.min(sorted.length - 1, Math.max(0, Math.ceil((p / 100) * sorted.length) - 1));
  return sorted[idx]!;
}

function sampleIndex(sorted: number[], value: number): number {
  let low = 0;
  let high = sorted.length;
  while (low < high) {
    const mid = Math.floor((low + high) / 2);
    if (sorted[mid]! < value) low = mid + 1;
    else high = mid;
  }
  return low;
}

/**
 * Metrics middleware: counts requests, errors (thrown or status >= 500) and
 * in-flight concurrency (with its peak), and keeps a bounded latency sample
 * window plus a fixed histogram. The returned middleware doubles as a handle
 * whose `.snapshot()` returns the current counters.
 */
export function metrics(options: MetricsOptions = {}): MetricsMiddleware {
  const maxSamples = options.maxLatencySamples === undefined ? 1000 : options.maxLatencySamples;
  if (!Number.isInteger(maxSamples) || maxSamples < 0) {
    throw new TypeError("metrics: maxLatencySamples must be a non-negative finite integer");
  }
  const onSample = options.onSample;

  let totalRequests = 0;
  let errors = 0;
  let inFlight = 0;
  let peakInFlight = 0;
  const buckets = new Array<number>(BUCKET_BOUNDS_MS.length).fill(0);
  const samples: number[] = [];
  let nextSample = 0;
  let evictedSample: number | undefined;
  let sorted: number[] = [];
  // Only distinguish no writes, one write and multiple writes since the last read.
  // Defer ordered updates to snapshot() so sampling alone always stays O(1).
  let samplesSinceSnapshot = 0;

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
      if (maxSamples > 0) {
        evictedSample = samples[nextSample];
        samples[nextSample] = ms;
        nextSample = (nextSample + 1) % maxSamples;
        if (samplesSinceSnapshot < 2) samplesSinceSnapshot++;
      }
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
    const latencySamples =
      nextSample === 0 || nextSample === samples.length
        ? samples.slice()
        : samples.slice(nextSample).concat(samples.slice(0, nextSample));
    if (samplesSinceSnapshot > 1) {
      sorted = latencySamples.slice().sort((a, b) => a - b);
    } else if (samplesSinceSnapshot === 1) {
      if (evictedSample !== undefined) sorted.splice(sampleIndex(sorted, evictedSample), 1);
      const latest = latencySamples[latencySamples.length - 1]!;
      sorted.splice(sampleIndex(sorted, latest), 0, latest);
    }
    samplesSinceSnapshot = 0;
    return {
      totalRequests,
      errors,
      inFlight,
      peakInFlight,
      latency: { bucketBoundsMs: [...BUCKET_BOUNDS_MS], buckets: [...buckets] },
      latencySamples,
      latencyP50: percentile(sorted, 50),
      latencyP95: percentile(sorted, 95),
    };
  }

  return Object.assign(mw, { snapshot }) as MetricsMiddleware;
}
