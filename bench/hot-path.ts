import { cpus, freemem, hostname, loadavg, release, totalmem } from "node:os";
import {
  type HttpFixture,
  type Operation,
  SUITES,
  type Suite,
  consumeResponse,
  fetchInit,
  invariant,
  withFixtures,
} from "./hot-path-fixtures.ts";
import { harnessIdentity, loadSource, sourceIdentity } from "./hot-path-source.ts";
import { JSON_PAYLOAD } from "./scenarios.ts";

export interface Options {
  sourceRoot: string;
  suite: Suite | "all";
  check: boolean;
  rounds: number;
  iterations: number;
  warmup: number;
  durationMs: number;
  warmupMs: number;
  concurrency: number;
}

const numeric = {
  "--rounds": ["rounds", 5, 100],
  "--iterations": ["iterations", 100000, 10000000],
  "--warmup": ["warmup", 20000, 10000000],
  "--duration-ms": ["durationMs", 1000, 60000],
  "--warmup-ms": ["warmupMs", 500, 60000],
  "--concurrency": ["concurrency", 32, 256],
} as const;

export function parseOptions(args: string[]): Options {
  const options: Options = {
    sourceRoot: "",
    suite: "all",
    check: false,
    rounds: 5,
    iterations: 100000,
    warmup: 20000,
    durationMs: 1000,
    warmupMs: 500,
    concurrency: 32,
  };
  const seen = new Set<string>();
  for (let i = 0; i < args.length; i++) {
    const arg = args[i]!;
    if (seen.has(arg)) throw new Error(`Duplicate option: ${arg}`);
    seen.add(arg);
    if (arg === "--check") {
      options.check = true;
      continue;
    }
    if (arg !== "--source-root" && arg !== "--suite" && !(arg in numeric))
      throw new Error(`Unknown option: ${arg}`);
    const value = args[++i];
    if (!value || value.startsWith("--")) throw new Error(`Missing value for ${arg}`);
    if (arg === "--source-root") options.sourceRoot = value;
    else if (arg === "--suite") {
      if (value !== "all" && !SUITES.includes(value as Suite))
        throw new Error(`Invalid --suite: ${value}`);
      options.suite = value as Options["suite"];
    } else {
      const [key, , max] = numeric[arg as keyof typeof numeric];
      const number = Number(value);
      if (!/^\d+$/.test(value) || !Number.isSafeInteger(number) || number < 1 || number > max) {
        throw new Error(`${arg} must be an integer in [1, ${max}]`);
      }
      options[key] = number;
    }
  }
  if (!options.sourceRoot) throw new Error("Required option: --source-root <absolute-checkout>");
  return options;
}

export async function runOperation(operation: Operation, count: number): Promise<number> {
  let checksum = 0;
  if (operation.kind === "sync") {
    for (let i = 0; i < count; i++) checksum += operation.run(i);
  } else {
    for (let i = 0; i < count; i++) checksum += await operation.run(i);
  }
  invariant(Number.isFinite(checksum) && checksum > 0, `${operation.name} output consumption`);
  return checksum;
}

function percentile(sorted: number[], quantile: number) {
  return sorted[Math.min(sorted.length - 1, Math.floor(sorted.length * quantile))]!;
}

export async function hammer(fixture: HttpFixture, durationMs: number, concurrency: number) {
  const abort = new AbortController();
  const init = { ...fetchInit(fixture.scenario), signal: abort.signal };
  const latencies: number[] = [];
  let checksum = 0;
  let running = true;
  let failure: unknown;
  const start = performance.now();
  const stop = setTimeout(() => {
    running = false;
  }, durationMs);
  const timeout = setTimeout(
    () => abort.abort(new Error("HTTP body/fetch timed out")),
    durationMs + 10000,
  );
  const workers = Array.from({ length: concurrency }, async () => {
    try {
      while (running) {
        const began = performance.now();
        const consumed = await consumeResponse(await fetch(fixture.url, init), fixture.scenario);
        checksum += consumed;
        latencies.push(performance.now() - began);
      }
    } catch (error) {
      failure ??= error;
      running = false;
      abort.abort(error);
    }
  });
  try {
    await Promise.allSettled(workers);
    if (failure) throw failure;
    invariant(latencies.length > 0 && checksum > 0, `${fixture.name} HTTP output consumption`);
    const elapsedMs = performance.now() - start;
    latencies.sort((a, b) => a - b);
    return {
      requests: latencies.length,
      elapsedMs,
      rps: (latencies.length * 1000) / elapsedMs,
      p50: percentile(latencies, 0.5),
      p95: percentile(latencies, 0.95),
      p99: percentile(latencies, 0.99),
      latencyUnit: "ms",
      throughputUnit: "requests/s",
      checksum,
    };
  } finally {
    running = false;
    clearTimeout(stop);
    clearTimeout(timeout);
    abort.abort();
    await Promise.allSettled(workers);
  }
}

export async function run(
  options: Options,
  emit: (record: object) => void = (record) => console.log(JSON.stringify(record)),
) {
  const source = sourceIdentity(options.sourceRoot);
  const harness = harnessIdentity();
  invariant(
    source.lockSha256 === harness.lockSha256,
    "source/harness bun.lock differs; use the same locked dependencies",
  );
  emit({
    type: "environment",
    schema: 1,
    at: new Date().toISOString(),
    pid: process.pid,
    command: [process.execPath, ...process.argv.slice(1)],
    options,
    inputPayloadBytes: new TextEncoder().encode(JSON.stringify(JSON_PAYLOAD)).byteLength,
    source,
    harness,
    runtime: {
      bun: Bun.version,
      revision: Bun.revision,
      executable: process.execPath,
      nodeEnv: process.env.NODE_ENV,
    },
    hardware: {
      hostname: hostname(),
      platform: process.platform,
      arch: process.arch,
      release: release(),
      cpus: cpus().map((cpu) => cpu.model),
      totalmem: totalmem(),
      freemem: freemem(),
      loadavg: loadavg(),
    },
    measurement:
      "Sequential components; HTTP same-process loopback fetch, full text validation/consumption inside timing. Setup/boot/probes/preparation excluded. No explicit GC; memory deltas are observations, not allocation counts.",
  });
  const loaded = await loadSource(source);
  for (const suite of options.suite === "all" ? SUITES : [options.suite]) {
    await withFixtures(loaded, suite, async (fixtures) => {
      emit({ type: "controls", suite, checks: fixtures.controls });
      for (const operation of fixtures.operations) {
        operation.before?.(3);
        try {
          await runOperation(operation, 3);
        } finally {
          operation.after?.();
        }
        if (options.check) {
          emit({ type: "check", suite, name: operation.name, ok: true });
          continue;
        }
        const count = Math.max(1, Math.floor(options.iterations / (operation.divisor ?? 1)));
        const warmup = Math.max(1, Math.floor(options.warmup / (operation.divisor ?? 1)));
        for (let round = 1; round <= options.rounds; round++) {
          operation.before?.(warmup);
          try {
            await runOperation(operation, warmup);
          } finally {
            operation.after?.();
          }
          operation.before?.(count);
          const memoryBefore = process.memoryUsage();
          let checksum: number;
          let elapsedMs: number;
          const start = performance.now();
          try {
            checksum = await runOperation(operation, count);
            elapsedMs = performance.now() - start;
          } finally {
            operation.after?.();
          }
          const memoryAfter = process.memoryUsage();
          emit({
            type: "round",
            suite,
            name: operation.name,
            round,
            count,
            warmup,
            elapsedMs,
            nsPerOp: (elapsedMs * 1e6) / count,
            unit: operation.unit === "table" ? "ns/table" : "ns/op",
            routes: operation.routes,
            checksum,
            rssDelta: memoryAfter.rss - memoryBefore.rss,
            heapUsedDelta: memoryAfter.heapUsed - memoryBefore.heapUsed,
          });
        }
      }
      for (const fixture of fixtures.http) {
        if (options.check) {
          emit({ type: "check", suite, name: fixture.name, ok: true });
          continue;
        }
        for (let round = 1; round <= options.rounds; round++) {
          await hammer(fixture, options.warmupMs, options.concurrency);
          emit({
            type: "round",
            suite,
            name: fixture.name,
            round,
            warmupMs: options.warmupMs,
            durationMs: options.durationMs,
            concurrency: options.concurrency,
            ...(await hammer(fixture, options.durationMs, options.concurrency)),
          });
        }
      }
    });
  }
  invariant(
    sourceIdentity(options.sourceRoot).productionSha256 === source.productionSha256,
    "source changed during run",
  );
  invariant(harnessIdentity().sha256 === harness.sha256, "harness changed during run");
  emit({ type: "complete", ok: true, check: options.check });
}

if (import.meta.main) {
  process.env.NODE_ENV = "production";
  try {
    await run(parseOptions(process.argv.slice(2)));
  } catch (error) {
    console.log(JSON.stringify({ type: "failure", ok: false, error: String(error) }));
    console.error(error);
    process.exitCode = 1;
  }
}
