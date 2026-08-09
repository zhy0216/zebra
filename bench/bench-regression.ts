// Performance regression gate: runs zebra-only benchmarks against
// bench/baseline.json and fails when a scenario drops below 80% of the
// baseline rps or exceeds 125% of the baseline p95. Keep durations short
// (default 1000ms per scenario) so CI can run it:
//
//   bun run bench:check
//
// Rebaseline after intentional performance changes with
// BENCH_DURATION_MS=3000 bun run bench/bench-regression.ts --update
process.env.NODE_ENV = "production";

import { readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { runScenario } from "./runner.ts";
import { SCENARIOS } from "./scenarios.ts";
import { start } from "./zebra-bench.ts";

const RPS_THRESHOLD = 0.8;
const P95_THRESHOLD = 1.25;

interface BaselineEntry {
  rps: number;
  p95: number;
}

type Baseline = Record<string, BaselineEntry>;

const baselinePath = resolve(import.meta.dir, "baseline.json");

function readBaseline(): { zebra: Baseline } {
  return JSON.parse(readFileSync(baselinePath, "utf8")) as { zebra: Baseline };
}

async function main(): Promise<void> {
  const durationMs = Number(process.env.BENCH_DURATION_MS ?? 1000);
  const concurrency = Number(process.env.BENCH_CONCURRENCY ?? 64);
  const opts = { durationMs, concurrency };
  const update = process.argv.includes("--update");
  const baseline = update ? { zebra: {} as Baseline } : readBaseline();

  console.log(`# Zebra bench:check (Bun ${Bun.version})`);
  console.log(`duration: ${durationMs}ms × concurrency ${concurrency}\n`);

  const server = await start();
  const failures: string[] = [];
  try {
    for (const scenario of SCENARIOS) {
      const r = await runScenario(server.baseUrl, opts, scenario.name, scenario.path);
      const b = baseline.zebra[scenario.name];
      if (update || b === undefined) {
        baseline.zebra[scenario.name] = { rps: r.rps, p95: r.p95 };
        console.log(
          `${scenario.name.padEnd(12)} ${String(r.rps.toFixed(0)).padStart(8)} req/s  p95 ${r.p95.toFixed(2)}ms  (baseline)`,
        );
        continue;
      }
      const rpsRatio = r.rps / b.rps;
      const p95Ratio = r.p95 / b.p95;
      const ok = rpsRatio >= RPS_THRESHOLD && p95Ratio <= P95_THRESHOLD;
      console.log(
        `${scenario.name.padEnd(12)} ${String(r.rps.toFixed(0)).padStart(8)} req/s (${(rpsRatio * 100).toFixed(0)}%)  ` +
          `p95 ${r.p95.toFixed(2)}ms (${(p95Ratio * 100).toFixed(0)}%)  ${ok ? "OK" : "FAIL"}`,
      );
      if (!ok) failures.push(scenario.name);
    }
  } finally {
    await server.stop();
  }

  if (update) {
    writeFileSync(baselinePath, `${JSON.stringify(baseline, null, 2)}\n`);
    console.log("\nbaseline.json updated");
    return;
  }
  if (failures.length > 0) {
    console.error(`\nFAIL: regression detected in ${failures.join(", ")}`);
    process.exit(1);
  }
  console.log("\nOK: all zebra scenarios within thresholds");
}

await main();
