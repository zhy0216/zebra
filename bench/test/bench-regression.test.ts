import { afterEach, expect, spyOn, test } from "bun:test";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { compareResult, parseOptions, runRegression } from "../bench-regression.ts";
import { SCENARIOS } from "../scenarios.ts";

const temporary: string[] = [];
afterEach(() => {
  for (const path of temporary.splice(0)) rmSync(path, { recursive: true, force: true });
});
function fixture(
  zebra: unknown = Object.fromEntries(SCENARIOS.map((s) => [s.name, { rps: 100, p95: 10 }])),
) {
  const dir = mkdtempSync(join(tmpdir(), "zebra-bench-gate-"));
  temporary.push(dir);
  const path = join(dir, "baseline.json");
  writeFileSync(path, JSON.stringify({ zebra }));
  return path;
}
const options = { durationMs: 1, concurrency: 1 };
const result = { rps: 100, p95: 10, p50: 5, p99: 15, requests: 100 };
function server() {
  let starts = 0;
  let stops = 0;
  return {
    start: async () => {
      starts++;
      return {
        baseUrl: "http://unused.local",
        stop: async () => {
          stops++;
        },
      };
    },
    counts: () => [starts, stops],
  };
}

test("benchmark options reject non-finite, non-positive and fractional concurrency", () => {
  expect(parseOptions({})).toEqual({ durationMs: 1000, concurrency: 64 });
  for (const value of ["NaN", "Infinity", "-Infinity", "0", "-1", ""]) {
    expect(() => parseOptions({ BENCH_DURATION_MS: value })).toThrow();
    expect(() => parseOptions({ BENCH_CONCURRENCY: value })).toThrow();
  }
  expect(() => parseOptions({ BENCH_CONCURRENCY: "1.5" })).toThrow();
});

test("comparison preserves exact threshold boundaries and rejects invalid data", () => {
  expect(compareResult({ rps: 80, p95: 12.5 }, { rps: 100, p95: 10 }).ok).toBe(true);
  expect(compareResult({ rps: 79.9, p95: 12.5 }, { rps: 100, p95: 10 }).ok).toBe(false);
  expect(compareResult({ rps: 80, p95: 12.51 }, { rps: 100, p95: 10 }).ok).toBe(false);
  for (const number of [Number.NaN, Number.POSITIVE_INFINITY, 0, -1]) {
    expect(() => compareResult(result, { rps: number, p95: 10 })).toThrow();
    expect(() => compareResult(result, { rps: 100, p95: number })).toThrow();
  }
});

test("invalid or missing baselines fail before starting a server and are never rewritten", async () => {
  for (const zebra of [
    {},
    null,
    { static: { rps: 100, p95: 10 } },
    Object.fromEntries(SCENARIOS.map((s) => [s.name, { rps: 0, p95: 10 }])),
  ]) {
    const path = fixture(zebra);
    const before = readFileSync(path, "utf8");
    const fake = server();
    await expect(
      runRegression(options, false, path, fake.start, async () => result),
    ).rejects.toThrow();
    expect(fake.counts()).toEqual([0, 0]);
    expect(readFileSync(path, "utf8")).toBe(before);
  }
});

test("check reads without writing; update writes measured results only to the supplied path", async () => {
  const log = spyOn(console, "log").mockImplementation(() => {});
  try {
    const path = fixture();
    const before = readFileSync(path, "utf8");
    const fake = server();
    await runRegression(options, false, path, fake.start, async () => result);
    expect(readFileSync(path, "utf8")).toBe(before);
    expect(fake.counts()).toEqual([1, 1]);
    await runRegression(options, true, path, fake.start, async () => ({ ...result, rps: 120 }));
    expect(JSON.parse(readFileSync(path, "utf8")).zebra.static.rps).toBe(120);
    expect(fake.counts()).toEqual([2, 2]);
  } finally {
    log.mockRestore();
  }
});

test("measurement errors and regressions close the server without updating baseline", async () => {
  const log = spyOn(console, "log").mockImplementation(() => {});
  try {
    const path = fixture();
    const before = readFileSync(path, "utf8");
    const fake = server();
    await expect(
      runRegression(options, true, path, fake.start, async () => {
        throw new Error("measure failed");
      }),
    ).rejects.toThrow("measure failed");
    await expect(
      runRegression(options, false, path, fake.start, async () => ({ ...result, rps: 1 })),
    ).rejects.toThrow("regression");
    expect(fake.counts()).toEqual([2, 2]);
    expect(readFileSync(path, "utf8")).toBe(before);
  } finally {
    log.mockRestore();
  }
});
