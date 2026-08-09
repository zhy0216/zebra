process.env.NODE_ENV = "production";

import {
  type BenchOptions,
  type BenchServer,
  SCENARIOS,
  type ScenarioResult,
} from "./scenarios.ts";

const DEFAULT_OPTIONS: BenchOptions = {
  durationMs: Number(process.env.BENCH_DURATION_MS ?? 3000),
  concurrency: Number(process.env.BENCH_CONCURRENCY ?? 64),
};

interface Framework {
  name: string;
  start: () => Promise<BenchServer>;
}

const FRAMEWORKS: Framework[] = [
  { name: "zebra", start: () => import("./zebra-bench.ts").then((m) => m.start()) },
  { name: "hono", start: () => import("./hono-bench.ts").then((m) => m.start()) },
  { name: "elysia", start: () => import("./elysia-bench.ts").then((m) => m.start()) },
];

function pctile(sorted: number[], q: number): number {
  if (sorted.length === 0) return 0;
  const idx = Math.min(sorted.length - 1, Math.floor(sorted.length * q));
  return sorted[idx]!;
}

async function hammer(
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

async function runScenario(
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

function fmt(v: number): string {
  return v >= 10000 ? v.toFixed(0) : v.toFixed(1);
}

async function main(): Promise<void> {
  const opts = DEFAULT_OPTIONS;
  console.log(`# Zebra benchmark (Bun ${Bun.version})`);
  console.log(`scenarios: ${SCENARIOS.map((s) => s.name).join(", ")}`);
  console.log(`duration: ${opts.durationMs}ms × concurrency ${opts.concurrency}\n`);

  const results: Record<string, Record<string, ScenarioResult>> = {};

  for (const framework of FRAMEWORKS) {
    const server = await framework.start();
    const resultsFor = (results[framework.name] ??= {});
    try {
      for (const scenario of SCENARIOS) {
        const r = await runScenario(server.baseUrl, opts, scenario.name, scenario.path);
        resultsFor[scenario.name] = r;
        console.log(
          `${framework.name.padEnd(8)} ${scenario.name.padEnd(10)} ${String(r.rps.toFixed(0)).padStart(8)} req/s  ` +
            `p50 ${r.p50.toFixed(2)}ms  p95 ${r.p95.toFixed(2)}ms  p99 ${r.p99.toFixed(2)}ms  (${r.requests} requests)`,
        );
      }
    } finally {
      await server.stop();
    }
    console.log();
  }

  console.log("## Summary (req/s)");
  console.log("| scenario | zebra | hono | elysia |");
  console.log("| --- | ---: | ---: | ---: |");
  for (const scenario of SCENARIOS) {
    const row = [scenario.name];
    for (const f of FRAMEWORKS) {
      const r = results[f.name]?.[scenario.name];
      row.push(r === undefined ? "N/A" : fmt(r.rps));
    }
    console.log(`| ${row.join(" | ")} |`);
  }
}

await main();
