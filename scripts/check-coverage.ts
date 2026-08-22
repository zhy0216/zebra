#!/usr/bin/env bun
/**
 * Global coverage gate (`bun run check:coverage`).
 *
 * Bun 1.4's `test.coverageThreshold` is enforced per file: one small file
 * below the threshold fails the run even when the suite overall is well
 * covered. This script restores the intended semantics — gate on the
 * *global* line coverage of the lcov report produced by the coverage CI job
 * (`bun test --coverage --coverage-reporter=lcov packages/core`).
 *
 * Fails when total line coverage drops below COVERAGE_THRESHOLD (default
 * 0.9, i.e. 90%).
 */
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const ROOT = resolve(import.meta.dir, "..");
const THRESHOLD = Number(process.env.COVERAGE_THRESHOLD ?? 0.9);

function fail(message: string): never {
  console.error(`[check:coverage] ${message}`);
  process.exit(1);
}

let source: string;
try {
  source = readFileSync(resolve(ROOT, "coverage", "lcov.info"), "utf8");
} catch {
  fail(
    "coverage/lcov.info not found — run `bun test --coverage --coverage-reporter=lcov packages/core` first",
  );
}

let found = 0;
let hit = 0;
for (const record of source.split("end_of_record")) {
  const lf = record.match(/^LF:(\d+)/m);
  const lh = record.match(/^LH:(\d+)/m);
  if (lf) found += Number(lf[1]);
  if (lh) hit += Number(lh[1]);
}

if (found === 0) fail("no line coverage data in coverage/lcov.info");

const ratio = hit / found;
console.log(
  `[check:coverage] ${hit}/${found} lines covered (${(ratio * 100).toFixed(2)}%), ` +
    `threshold ${(THRESHOLD * 100).toFixed(0)}%`,
);
if (ratio < THRESHOLD) {
  fail(
    `global line coverage ${(ratio * 100).toFixed(2)}% is below ${(THRESHOLD * 100).toFixed(0)}%`,
  );
}
console.log("[check:coverage] OK");
