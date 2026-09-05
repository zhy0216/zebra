// Performance regression gate: runs zebra-only benchmarks against
// bench/baseline.json and fails when a scenario drops below 80% of the
// baseline rps or exceeds 125% of the baseline p95. Keep durations short
// (default 1000ms per scenario) so CI can run it:
//
//   bun run bench:check
//
// Each scenario is measured RUNS times and the median (by rps) is compared —
// single measurements are too noisy for a gate. Rebaseline after intentional
// performance changes with
// BENCH_DURATION_MS=3000 bun run bench/bench-regression.ts --update

import { readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { runScenario } from "./runner.ts";
import { type BenchOptions, SCENARIOS, type Scenario, type ScenarioResult } from "./scenarios.ts";
import { start } from "./zebra-bench.ts";

const RPS_THRESHOLD = 0.8;
const P95_THRESHOLD = 1.25;
const RUNS = 3;

async function measureMedian(
  baseUrl: string,
  opts: BenchOptions,
  scenario: Scenario,
): Promise<ScenarioResult> {
  const results: ScenarioResult[] = [];
  for (let i = 0; i < RUNS; i++) {
    results.push(await runScenario(baseUrl, opts, scenario));
  }
  results.sort((a, b) => a.rps - b.rps);
  return results[Math.floor(results.length / 2)]!;
}

interface BaselineEntry {
  rps: number;
  p95: number;
}

type Baseline = Record<string, BaselineEntry>;

function validateEntry(value: unknown, label: string): asserts value is BaselineEntry {
  if (typeof value !== "object" || value === null) throw new Error(`${label}: missing result`);
  const entry = value as Record<string, unknown>;
  for (const key of ["rps", "p95"] as const) {
    const number = entry[key];
    if (typeof number !== "number" || !Number.isFinite(number) || number <= 0) {
      throw new Error(`${label}: ${key} must be a finite positive number`);
    }
  }
}

export function parseOptions(env: Record<string, string | undefined>): BenchOptions {
  const durationMs = Number(env.BENCH_DURATION_MS ?? 1000);
  const concurrency = Number(env.BENCH_CONCURRENCY ?? 64);
  if (!Number.isFinite(durationMs) || durationMs <= 0) {
    throw new Error("BENCH_DURATION_MS must be a finite positive number");
  }
  if (!Number.isSafeInteger(concurrency) || concurrency <= 0) {
    throw new Error("BENCH_CONCURRENCY must be a positive safe integer");
  }
  return { durationMs, concurrency };
}

export function compareResult(result: BaselineEntry, baseline: BaselineEntry) {
  validateEntry(result, "measurement");
  validateEntry(baseline, "baseline");
  const rpsRatio = result.rps / baseline.rps;
  const p95Ratio = result.p95 / baseline.p95;
  return { rpsRatio, p95Ratio, ok: rpsRatio >= RPS_THRESHOLD && p95Ratio <= P95_THRESHOLD };
}

const baselinePath = resolve(import.meta.dir, "baseline.json");

function readBaseline(path: string): { zebra: Baseline } {
  const data: unknown = JSON.parse(readFileSync(path, "utf8"));
  if (typeof data !== "object" || data === null || !("zebra" in data)) {
    throw new Error("baseline must contain zebra results");
  }
  const zebra = data.zebra;
  if (typeof zebra !== "object" || zebra === null) throw new Error("invalid zebra baseline");
  for (const scenario of SCENARIOS) {
    if (!Object.hasOwn(zebra, scenario.name)) throw new Error(`missing baseline: ${scenario.name}`);
    validateEntry((zebra as Record<string, unknown>)[scenario.name], scenario.name);
  }
  return { zebra: zebra as Baseline };
}

export async function runRegression(
  opts: BenchOptions,
  update: boolean,
  path = baselinePath,
  startServer = start,
  measure = measureMedian,
): Promise<void> {
  parseOptions({
    BENCH_DURATION_MS: String(opts.durationMs),
    BENCH_CONCURRENCY: String(opts.concurrency),
  });
  const { durationMs, concurrency } = opts;
  const baseline = update ? { zebra: {} as Baseline } : readBaseline(path);

  console.log(`# Zebra bench:check (Bun ${Bun.version})`);
  console.log(`duration: ${durationMs}ms × concurrency ${concurrency}\n`);

  const server = await startServer();
  const failures: string[] = [];
  try {
    for (const scenario of SCENARIOS) {
      const r = await measure(server.baseUrl, opts, scenario);
      validateEntry(r, scenario.name);
      const b = baseline.zebra[scenario.name];
      if (update) {
        baseline.zebra[scenario.name] = { rps: r.rps, p95: r.p95 };
        console.log(
          `${scenario.name.padEnd(12)} ${String(r.rps.toFixed(0)).padStart(8)} req/s  p95 ${r.p95.toFixed(2)}ms  (baseline)`,
        );
        continue;
      }
      const { rpsRatio, p95Ratio, ok } = compareResult(r, b!);
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
    writeFileSync(path, `${JSON.stringify(baseline, null, 2)}\n`);
    console.log("\nbaseline.json updated");
    return;
  }
  if (failures.length > 0) {
    throw new Error(`FAIL: regression detected in ${failures.join(", ")}`);
  }
  console.log("\nOK: all zebra scenarios within thresholds");
}

if (import.meta.main) {
  process.env.NODE_ENV = "production";
  try {
    await runRegression(parseOptions(process.env), process.argv.includes("--update"));
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  }
}
