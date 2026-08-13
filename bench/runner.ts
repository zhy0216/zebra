import { type BenchOptions, type Scenario, type ScenarioResult } from "./scenarios.ts";

function pctile(sorted: number[], q: number): number {
  if (sorted.length === 0) return 0;
  const idx = Math.min(sorted.length - 1, Math.floor(sorted.length * q));
  return sorted[idx]!;
}

/** Precomputed fetch init for a scenario (POST + JSON body, or a plain GET). */
function fetchInit(scenario: Scenario): RequestInit | undefined {
  if (scenario.method === "POST") {
    return {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: scenario.body,
    };
  }
  return undefined;
}

export async function hammer(
  url: string,
  opts: BenchOptions,
  record: boolean,
  init?: RequestInit,
): Promise<ScenarioResult | null> {
  const latencies: number[] = [];
  let count = 0;
  const startTime = performance.now();
  let running = true;

  const worker = async () => {
    while (running) {
      const t0 = performance.now();
      const res = await fetch(url, init);
      await res.arrayBuffer();
      if (res.status !== 200) throw new Error(`non-200 response: ${res.status}`);
      if (record) {
        latencies.push(performance.now() - t0);
        count++;
      }
    }
  };

  const workers = Array.from({ length: opts.concurrency }, () => worker());
  await Bun.sleep(opts.durationMs);
  running = false;
  await Promise.all(workers);

  const elapsed = (performance.now() - startTime) / 1000;
  if (!record) return null;

  latencies.sort((a, b) => a - b);
  return {
    rps: count / elapsed,
    p50: pctile(latencies, 0.5),
    p95: pctile(latencies, 0.95),
    p99: pctile(latencies, 0.99),
    requests: count,
  };
}

/**
 * Probes the scenario endpoint, warms it up, then measures. The warmup is a
 * fixed 500ms (never longer than the measurement window) so the measured
 * phase excludes JIT/connection setup.
 */
export async function runScenario(
  baseUrl: string,
  opts: BenchOptions,
  scenario: Scenario,
): Promise<ScenarioResult> {
  const url = baseUrl + scenario.path;
  const init = fetchInit(scenario);
  const probe = await fetch(url, init);
  const body = await probe.text();
  if (probe.status !== 200 || !scenario.verify(body)) {
    throw new Error(
      `${scenario.name}: unexpected response (${probe.status}) ${body.slice(0, 100)}`,
    );
  }
  const warmupMs = Math.min(500, opts.durationMs);
  await hammer(url, { ...opts, durationMs: warmupMs }, false, init);
  return (await hammer(url, opts, true, init))!;
}
