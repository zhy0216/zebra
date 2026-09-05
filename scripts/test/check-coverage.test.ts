import { expect, test } from "bun:test";
import { join } from "node:path";
import { checkCoverage, parseThreshold, summarizeCoverage } from "../check-coverage.ts";

const root = "/tmp/zebra-coverage-fixture";
function record(file: string, found: number, hit: number) {
  return `SF:${file}\nLF:${found}\nLH:${hit}\nend_of_record\n`;
}

test("threshold defaults to 90% and allows finite endpoints", () => {
  expect(parseThreshold(undefined)).toBe(0.9);
  expect(parseThreshold("0")).toBe(0);
  expect(parseThreshold("1")).toBe(1);
  expect(parseThreshold("0.95")).toBe(0.95);
});

test("invalid thresholds fail closed", () => {
  for (const value of ["banana", "NaN", "Infinity", "-Infinity", "-0.1", "1.1", "", " "]) {
    expect(() => parseThreshold(value)).toThrow("COVERAGE_THRESHOLD");
  }
});

test("only core source contributes, including its contract module", () => {
  const source =
    record("packages/core/src/app/app.ts", 10, 9) +
    record(join(root, "packages/core/src/contract/implement.ts"), 10, 9) +
    record("packages/contract/src/builder.ts", 1000, 1000) +
    record("packages/core/test/fuzz/prng.ts", 1000, 1000) +
    record("packages/core/src-other/file.ts", 1000, 1000) +
    record("../elsewhere/packages/core/src/file.ts", 1000, 1000);
  expect(summarizeCoverage(source, root)).toEqual({ found: 20, hit: 18, ratio: 0.9 });
  expect(checkCoverage(source, 0.9, root).ratio).toBe(0.9);
  expect(() => checkCoverage(source, 0.91, root)).toThrow("below 91%");
});

test("normalizes relative paths and CRLF records", () => {
  const source = record("./packages/core/src/http/../http/body.ts", 2, 1).replaceAll("\n", "\r\n");
  expect(summarizeCoverage(source, root)).toEqual({ found: 2, hit: 1, ratio: 0.5 });
});

test("no eligible coverage cannot pass, even at a zero threshold", () => {
  for (const source of [
    "",
    record("packages/core/test/test.ts", 1, 1),
    record("packages/core/src/a.ts", 0, 0),
  ]) {
    expect(() => checkCoverage(source, 0, root)).toThrow("no core source");
  }
});

test("rejects invalid or missing line counters", () => {
  for (const counts of [
    "LF:10",
    "LH:10",
    "LF:10\nLH:11",
    "LF:10oops\nLH:10",
    "LF:10\nLH:-1",
    "LF:1.5\nLH:1",
    "LF:10\nLF:10\nLH:10",
    "LF:10\nLH:10\nLH:10",
    "LF:9007199254740992\nLH:0",
  ]) {
    expect(() =>
      summarizeCoverage(`SF:packages/core/src/a.ts\n${counts}\nend_of_record\n`, root),
    ).toThrow();
  }
});

test("duplicate paths cannot inflate the gate after normalization", () => {
  const source =
    record("packages/core/src/a.ts", 10, 10) + record(join(root, "packages/core/src/a.ts"), 10, 10);
  expect(() => summarizeCoverage(source, root)).toThrow("duplicate LCOV file");
});

test("rejects malformed record boundaries and source fields", () => {
  for (const source of [
    "SF:packages/core/src/a.ts\nLF:1\nLH:1\n",
    "LF:1\nLH:1\nend_of_record\n",
    "SF:\nLF:1\nLH:1\nend_of_record\n",
    "SF:packages/core/src/a.ts\nSF:packages/core/src/b.ts\nLF:1\nLH:1\nend_of_record\n",
  ]) {
    expect(() => summarizeCoverage(source, root)).toThrow();
  }
});

test("check rejects invalid programmatic thresholds too", () => {
  expect(() => checkCoverage(record("packages/core/src/a.ts", 1, 1), Number.NaN, root)).toThrow();
});
