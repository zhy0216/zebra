process.env.NODE_ENV = "production";

import { hammer, runScenario } from "./runner.ts";
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
