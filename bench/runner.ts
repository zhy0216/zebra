import { type BenchOptions, SCENARIOS, type ScenarioResult } from "./scenarios.ts";

function pctile(sorted: number[], q: number): number {
  if (sorted.length === 0) return 0;
  const idx = Math.min(sorted.length - 1, Math.floor(sorted.length * q));
  return sorted[idx]!;
}

export async function hammer(
  url: string,
  opts: BenchOptions,
  record: boolean,
): Promise<ScenarioResult | null> {
  const latencies: number[] = [];
  let count = 0;
  const startTime = performance.now();
  let running = true;

  const worker = async () => {
    while (running) {
      const t0 = performance.now();
      const res = await fetch(url);
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

export async function runScenario(
  baseUrl: string,
  opts: BenchOptions,
  name: string,
  path: string,
): Promise<ScenarioResult> {
  const url = baseUrl + path;
  const probe = await fetch(url);
  const body = await probe.text();
  const scenario = SCENARIOS.find((s) => s.name === name)!;
  if (probe.status !== 200 || !scenario.verify(body)) {
    throw new Error(`${name}: unexpected response (${probe.status}) ${body.slice(0, 100)}`);
  }
  await hammer(url, opts, false);
  return (await hammer(url, opts, true))!;
}
