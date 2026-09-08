import { expect, test } from "bun:test";
import {
  cpSync,
  existsSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { SUITES, consumeResponse, withFixtures } from "../hot-path-fixtures.ts";
import { loadSource, productionFiles, sourceIdentity } from "../hot-path-source.ts";
import { hammer, parseOptions, run, runOperation } from "../hot-path.ts";
import { SCENARIOS } from "../scenarios.ts";

const root = resolve(import.meta.dir, "../..");
const harness = join(root, "bench/hot-path.ts");

async function cli(args: string[]) {
  const child = Bun.spawn([process.execPath, harness, ...args], {
    cwd: root,
    stdout: "pipe",
    stderr: "pipe",
    env: process.env,
  });
  const timer = setTimeout(() => child.kill("SIGKILL"), 15000);
  try {
    const [stdout, stderr, code] = await Promise.all([
      new Response(child.stdout).text(),
      new Response(child.stderr).text(),
      child.exited,
    ]);
    return {
      stdout,
      stderr,
      code,
      records: stdout
        .trim()
        .split("\n")
        .map((line) => JSON.parse(line)),
    };
  } finally {
    clearTimeout(timer);
    if (child.exitCode === null) child.kill("SIGKILL");
    await child.exited;
  }
}

test("strict options reject missing, unknown, duplicate and invalid numeric controls", () => {
  expect(parseOptions(["--source-root", root, "--check"]).check).toBe(true);
  expect(parseOptions(["--source-root", root, "--suite", "router"]).suite).toBe("router");
  for (const args of [
    [],
    ["--wat"],
    ["--source-root"],
    ["--source-root", root, "--suite", "unknown"],
    ["--source-root", root, "--check", "--check"],
  ])
    expect(() => parseOptions(args)).toThrow();
  for (const flag of [
    "--rounds",
    "--iterations",
    "--warmup",
    "--duration-ms",
    "--warmup-ms",
    "--concurrency",
  ]) {
    for (const value of ["0", "-1", "1.5", "NaN", "Infinity", "9007199254740992", "1e3", ""]) {
      expect(() => parseOptions(["--source-root", root, flag, value])).toThrow();
    }
  }
});

test("bad source roots fail with useful CLI diagnostics", async () => {
  for (const source of [".", "/does-not-exist-hot-path", tmpdir()]) {
    const result = await cli(["--source-root", source, "--check"]);
    expect(result.code).toBe(1);
    expect(result.stdout).toContain("source-root");
  }
});

test("all suites check workload correctness without emitting timed rounds", async () => {
  const result = await cli(["--source-root", root, "--suite", "all", "--check"]);
  expect(result.code).toBe(0);
  expect(result.records.some((record) => record.type === "round")).toBe(false);
  for (const suite of SUITES)
    expect(result.records.some((record) => record.type === "check" && record.suite === suite)).toBe(
      true,
    );
  const http = result.records
    .filter((record) => record.type === "check" && record.suite === "http")
    .map((record) => record.name);
  for (const scenario of SCENARIOS) expect(http).toContain(scenario.name);
  for (const name of [
    "class-warm",
    "factory-warm",
    "metadata",
    "middleware-20",
    "static-listeners",
    "middleware-listeners",
  ])
    expect(http).toContain(name);
  expect(result.records.at(-1).ok).toBe(true);
}, 20000);

test("an altered archived source executes in a distinct process and records the production diff", async () => {
  const dir = mkdtempSync(join(tmpdir(), "zebra-hot-path-source-"));
  let evidence: object | undefined;
  try {
    cpSync(join(root, "packages"), join(dir, "packages"), {
      recursive: true,
      filter: (path) =>
        !path.includes("node_modules") && !path.includes("/dist") && !path.includes("/test"),
    });
    cpSync(join(root, "bun.lock"), join(dir, "bun.lock"));
    symlinkSync(join(root, "node_modules"), join(dir, "node_modules"), "dir");
    writeFileSync(
      join(dir, ".hot-path-source.json"),
      JSON.stringify({ revision: sourceIdentity(root).revision, files: productionFiles(dir) }),
    );
    const good = await cli(["--source-root", dir, "--suite", "router", "--check"]);
    expect(good.code).toBe(0);
    const file = join(dir, "packages/core/src/router/radix.ts");
    const original = readFileSync(file, "utf8");
    const altered = original.replace(
      /(find\(method: string, path: string\): MatchResult<T> \| null \{)/,
      '$1\n    throw new Error("controlled alternate router executed");',
    );
    expect(altered).not.toBe(original);
    writeFileSync(file, altered);
    const bad = await cli(["--source-root", dir, "--suite", "router", "--check"]);
    expect(bad.code).toBe(1);
    expect(bad.stderr).toContain("controlled alternate router executed");
    expect(bad.records[0].source.paths.router).toBe(file);
    expect(bad.records[0].source.productionDiff.changes[0].file).toBe(
      "packages/core/src/router/radix.ts",
    );
    expect(bad.records[0].source.productionSha256).not.toBe(
      good.records[0].source.productionSha256,
    );
    expect(bad.records[0].harness.sha256).toBe(good.records[0].harness.sha256);
    expect(bad.records[0].pid).not.toBe(good.records[0].pid);
    const current = await cli(["--source-root", root, "--suite", "router", "--check"]);
    expect(current.code).toBe(0);
    evidence = {
      before: good.records[0],
      altered: bad.records[0],
      current: current.records[0],
      exits: [good.code, bad.code, current.code],
      failure: bad.stderr,
    };
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
  expect(existsSync(dir)).toBe(false);
  if (process.env.HOT_PATH_TEST_EVIDENCE) {
    writeFileSync(
      process.env.HOT_PATH_TEST_EVIDENCE,
      `${JSON.stringify({ evidence, temporaryArchiveRemoved: !existsSync(dir) }, null, 2)}\n`,
    );
  }
}, 20000);

test("source and output errors propagate while booted fixtures release servers and listeners", async () => {
  const source = await loadSource(sourceIdentity(root));
  const stopped: number[] = [];
  const ports: number[] = [];
  class TrackedZebra extends source.Zebra {
    override async listen(options: Parameters<SourceZebra["listen"]>[0]) {
      const result = await super.listen(options);
      ports.push(result.port);
      return result;
    }
    override async stop() {
      await super.stop();
      stopped.push(1);
    }
  }
  type SourceZebra = InstanceType<typeof source.Zebra>;
  const signals = process.listenerCount("SIGTERM");
  await expect(
    withFixtures({ ...source, Zebra: TrackedZebra }, "http", async (fixtures) => {
      const fixture = fixtures.http[0]!;
      await hammer({ ...fixture, scenario: { ...fixture.scenario, verify: () => false } }, 10, 4);
    }),
  ).rejects.toThrow("workload mismatch");
  expect(stopped).toHaveLength(2);
  expect(process.listenerCount("SIGTERM")).toBe(signals);
  for (const port of ports) {
    const server = Bun.serve({
      hostname: "127.0.0.1",
      port,
      fetch: () => new Response("released"),
    });
    await server.stop(true);
  }
});

test("a setup probe failure closes the partially prepared app", async () => {
  const source = await loadSource(sourceIdentity(root));
  let stops = 0;
  class BadZebra extends source.Zebra {
    override async dispatch() {
      return new Response("wrong");
    }
    override async stop() {
      await super.stop();
      stops++;
    }
  }
  await expect(
    withFixtures({ ...source, Zebra: BadZebra }, "dispatch", async () => {}),
  ).rejects.toThrow("workload mismatch");
  expect(stops).toBe(1);
});

test("HTTP failure cancels competing body readers and settles its workers", async () => {
  let requests = 0;
  let cancelled = 0;
  const server = Bun.serve({
    port: 0,
    hostname: "127.0.0.1",
    fetch() {
      requests++;
      if (requests === 1) return new Response("incorrect");
      return new Response(
        new ReadableStream({
          start(controller) {
            controller.enqueue(new TextEncoder().encode("pending"));
          },
          cancel() {
            cancelled++;
          },
        }),
      );
    },
  });
  try {
    await expect(
      hammer(
        { name: "reader-failure", url: `http://127.0.0.1:${server.port}`, scenario: SCENARIOS[0]! },
        10,
        4,
      ),
    ).rejects.toThrow("workload mismatch");
  } finally {
    await server.stop(true);
  }
  // Bun may reject a queued fetch before it reaches the server; every started stream must close.
  await Bun.sleep(10);
  expect(cancelled).toBe(requests - 1);
});

test("concurrent HTTP output accounting includes every consumed body", async () => {
  const server = Bun.serve({
    port: 0,
    hostname: "127.0.0.1",
    fetch: () => new Response("hello world"),
  });
  try {
    const result = await hammer(
      { name: "accounting", url: `http://127.0.0.1:${server.port}`, scenario: SCENARIOS[0]! },
      10,
      4,
    );
    expect(result.checksum).toBe(result.requests * "hello world".length);
  } finally {
    await server.stop(true);
  }
});

test("status/body mismatch is never accepted and operation checks consume outputs", async () => {
  await expect(
    consumeResponse(new Response("hello world", { status: 500 }), SCENARIOS[0]!),
  ).rejects.toThrow("status=500");
  await expect(consumeResponse(new Response("wrong"), SCENARIOS[0]!)).rejects.toThrow("body=");
  await expect(
    runOperation({ kind: "sync", name: "bad", run: () => Number.NaN }, 3),
  ).rejects.toThrow("output consumption");
});

test("exceptions from a result consumer still close fixture servers", async () => {
  const signals = process.listenerCount("SIGTERM");
  await expect(
    run(parseOptions(["--source-root", root, "--suite", "dispatch", "--check"]), (record) => {
      if ("checks" in record) throw new Error("result writer failed");
    }),
  ).rejects.toThrow("result writer failed");
  expect(process.listenerCount("SIGTERM")).toBe(signals);
});
