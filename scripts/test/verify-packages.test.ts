import { afterEach, describe, expect, test } from "bun:test";
import { spawnSync } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";

const source = readFileSync(resolve(import.meta.dir, "../verify-packages.ts"), "utf8");
const directories: string[] = [];
const stub = `#!${process.execPath}
import { appendFileSync, mkdirSync, writeFileSync } from "node:fs";
import { basename, join } from "node:path";
const tool = basename(process.argv[1]);
const args = process.argv.slice(2);
const stage = tool === "tar" ? (args[0] === "-tzf" ? "tar-list" : "tar-read")
  : ({ pm: "pack", install: "install", "verify.ts": "import", add: "types-install", x: "typecheck" })[args[0]];
if (!stage) throw new Error("unexpected command: " + tool + " " + args.join(" "));
appendFileSync(process.env.VERIFY_TEST_LOG, JSON.stringify({ stage, args, cwd: process.cwd() }) + "\\n");
if (stage === process.env.VERIFY_TEST_FAIL) {
  console.error("fixture failure at " + stage);
  process.exit(23);
}
if (stage === process.env.VERIFY_TEST_SIGNAL) process.kill(process.pid, "SIGTERM");
if (stage === "pack") {
  const destination = args[args.indexOf("--destination") + 1];
  mkdirSync(destination, { recursive: true });
  const path = join(destination, "fixture.tgz");
  writeFileSync(path, "fixture tarball");
  console.log(path);
} else if (stage === "tar-list") {
  console.log("package/package.json\\npackage/src/index.ts");
} else if (stage === "tar-read") {
  console.log(JSON.stringify({ name: "@fixture/core", version: "1.0.0", exports: "./src/index.ts" }));
}
`;

interface Command {
  stage: string;
  args: string[];
  cwd: string;
}

function fixture() {
  const directory = mkdtempSync(join(tmpdir(), "zebra-verify-test-"));
  directories.push(directory);
  const root = join(directory, "repo");
  const bin = join(directory, "bin");
  const log = join(directory, "commands.jsonl");
  for (const path of [join(root, "scripts"), join(root, "packages/core"), bin]) {
    mkdirSync(path, { recursive: true });
  }
  writeFileSync(join(root, "scripts/verify-packages.ts"), source);
  writeFileSync(join(root, "package.json"), JSON.stringify({ workspaces: ["packages/*"] }));
  writeFileSync(
    join(root, "packages/core/package.json"),
    JSON.stringify({ name: "@fixture/core", version: "1.0.0" }),
  );
  for (const tool of ["bun", "tar"]) writeFileSync(join(bin, tool), stub, { mode: 0o755 });
  return {
    bin,
    run: (overrides: Record<string, string> = {}) =>
      spawnSync(process.execPath, [join(root, "scripts/verify-packages.ts")], {
        cwd: root,
        env: {
          ...process.env,
          PATH: bin,
          VERIFY_TEST_LOG: log,
          VERIFY_TEST_FAIL: "",
          VERIFY_TEST_SIGNAL: "",
          ...overrides,
        },
        encoding: "utf8",
      }),
    commands: (): Command[] =>
      readFileSync(log, "utf8")
        .trim()
        .split("\n")
        .map((line) => JSON.parse(line)),
  };
}

afterEach(() => {
  for (const directory of directories.splice(0))
    rmSync(directory, { recursive: true, force: true });
});

function expectClean(commands: Command[]) {
  const pack = commands.find((command) => command.stage === "pack")!;
  const destination = pack.args[pack.args.indexOf("--destination") + 1]!;
  expect(existsSync(dirname(destination))).toBe(false);
}

describe("verify:packages cleanup", () => {
  test.each(["pack", "tar-list", "tar-read", "install", "import", "types-install", "typecheck"])(
    "preserves %s failure diagnostics and removes the temporary project",
    (stage) => {
      const project = fixture();
      const result = project.run({ VERIFY_TEST_FAIL: stage });
      expect(result.status).toBe(1);
      expect(result.stderr).toContain(`fixture failure at ${stage}`);
      expect(project.commands().at(-1)?.stage).toBe(stage);
      expectClean(project.commands());
    },
  );

  test("cleans up after successful package verification", () => {
    const project = fixture();
    const result = project.run();
    expect(result.status).toBe(0);
    expect(result.stdout).toContain("[verify:packages] all packages verified");
    expect(project.commands().at(-1)?.stage).toBe("typecheck");
    expectClean(project.commands());
  });

  test("reports subprocess startup errors and still cleans up", () => {
    const project = fixture();
    rmSync(join(project.bin, "tar"));
    const result = project.run();
    expect(result.status).toBe(1);
    expect(result.stderr).toMatch(/ENOENT|Executable not found/);
    expectClean(project.commands());
  });

  test("reports subprocess signals and still cleans up", () => {
    const project = fixture();
    const result = project.run({ VERIFY_TEST_SIGNAL: "install" });
    expect(result.status).toBe(1);
    expect(result.stderr).toContain("SIGTERM");
    expectClean(project.commands());
  });
});
