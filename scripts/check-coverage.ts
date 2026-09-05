#!/usr/bin/env bun
import { readFileSync } from "node:fs";
import { relative, resolve } from "node:path";

const ROOT = resolve(import.meta.dir, "..");

export function parseThreshold(value: string | undefined): number {
  const threshold = value === undefined ? 0.9 : Number(value);
  if (value?.trim() === "" || !Number.isFinite(threshold) || threshold < 0 || threshold > 1) {
    throw new Error("COVERAGE_THRESHOLD must be a finite number between 0 and 1");
  }
  return threshold;
}

export function summarizeCoverage(source: string, root = ROOT) {
  let found = 0;
  let hit = 0;
  let record: string[] = [];
  const seen = new Set<string>();

  function finishRecord() {
    const files = record.filter((line) => line.startsWith("SF:"));
    if (files.length !== 1 || files[0]!.slice(3).trim() === "") {
      throw new Error("each LCOV record must have exactly one non-empty SF field");
    }
    const file = relative(root, resolve(root, files[0]!.slice(3).replaceAll("\\", "/"))).replaceAll(
      "\\",
      "/",
    );
    if (!file.startsWith("packages/core/src/")) return;
    if (seen.has(file)) throw new Error(`duplicate LCOV file: ${file}`);
    seen.add(file);

    function count(field: "LF" | "LH") {
      const lines = record.filter((line) => line.startsWith(`${field}:`));
      const value = lines[0]?.slice(3);
      if (lines.length !== 1 || value === undefined || !/^\d+$/.test(value)) {
        throw new Error(`${file}: expected one non-negative integer ${field}`);
      }
      const number = Number(value);
      if (!Number.isSafeInteger(number)) throw new Error(`${file}: unsafe ${field} count`);
      return number;
    }

    const linesFound = count("LF");
    const linesHit = count("LH");
    if (linesHit > linesFound) throw new Error(`${file}: LH exceeds LF`);
    found += linesFound;
    hit += linesHit;
    if (!Number.isSafeInteger(found) || !Number.isSafeInteger(hit)) {
      throw new Error("LCOV totals exceed safe integer limits");
    }
  }

  for (const line of source.split(/\r?\n/)) {
    if (line === "end_of_record") {
      finishRecord();
      record = [];
    } else if (line !== "" && !line.startsWith("TN:")) {
      record.push(line);
    }
  }
  if (record.length > 0) throw new Error("unterminated LCOV record");
  if (found === 0) throw new Error("no core source line coverage data in coverage/lcov.info");
  return { found, hit, ratio: hit / found };
}

export function checkCoverage(source: string, threshold: number, root = ROOT) {
  parseThreshold(String(threshold));
  const coverage = summarizeCoverage(source, root);
  if (coverage.ratio < threshold) {
    throw new Error(
      `core source line coverage ${(coverage.ratio * 100).toFixed(2)}% is below ${(threshold * 100).toFixed(0)}%`,
    );
  }
  return coverage;
}

if (import.meta.main) {
  try {
    const threshold = parseThreshold(process.env.COVERAGE_THRESHOLD);
    let source: string;
    try {
      source = readFileSync(resolve(ROOT, "coverage", "lcov.info"), "utf8");
    } catch {
      throw new Error(
        "coverage/lcov.info not found — run `bun test --coverage --coverage-reporter=lcov packages/core` first",
      );
    }
    const { found, hit, ratio } = checkCoverage(source, threshold);
    console.log(
      `[check:coverage] ${hit}/${found} core source lines covered (${(ratio * 100).toFixed(2)}%), ` +
        `threshold ${(threshold * 100).toFixed(0)}%`,
    );
    console.log("[check:coverage] OK");
  } catch (error) {
    console.error(`[check:coverage] ${error instanceof Error ? error.message : String(error)}`);
    process.exitCode = 1;
  }
}
