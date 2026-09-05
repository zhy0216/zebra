import { afterEach, describe, expect, test } from "bun:test";
import { spawnSync } from "node:child_process";
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  realpathSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";

const releaseSource = readFileSync(resolve(import.meta.dir, "../release.ts"), "utf8");
const realGit = Bun.which("git")!;
const temporaryDirectories: string[] = [];
const releaseFiles = [
  "packages/core/package.json",
  "packages/feature/package.json",
  "packages/core/src/index.ts",
  "CHANGELOG.md",
];

// Each invocation runs a copy of the production entry point in an isolated
// repository. All Bun subprocesses, including publish, terminate in this stub.
// Only Git is real, and its inherited repository/config overrides are removed.
const commandStub = `#!${process.execPath}
import { spawnSync } from "node:child_process";
import { appendFileSync, writeFileSync } from "node:fs";
import { basename, join } from "node:path";
const tool = basename(process.argv[1]);
const args = process.argv.slice(2);
const command = [tool, ...args].join(" ");
appendFileSync(process.env.RELEASE_TEST_LOG, JSON.stringify({ tool, args, cwd: process.cwd() }) + "\\n");
if (command.startsWith(process.env.RELEASE_TEST_FAIL_COMMAND || "\\0")) {
  console.log("fixture stdout: " + command);
  console.error("fixture stderr: " + command);
  process.exit(23);
}
if (command === process.env.RELEASE_TEST_SIGNAL_COMMAND) {
  process.kill(process.pid, "SIGTERM");
}
if (command === "bun run typecheck" && process.env.RELEASE_TEST_UNRELATED === "1") {
  writeFileSync(join(process.cwd(), "notes.txt"), "verification changed this unrelated file\\n");
  writeFileSync(join(process.cwd(), "generated.txt"), "unrelated generated output\\n");
  const staged = spawnSync(process.env.RELEASE_TEST_REAL_GIT, ["add", "--", "notes.txt"], { encoding: "utf8" });
  if (staged.status !== 0) throw new Error(staged.stderr);
}
if (tool === "git") {
  const result = spawnSync(process.env.RELEASE_TEST_REAL_GIT, args, { encoding: "utf8" });
  if (result.stdout) process.stdout.write(result.stdout);
  if (result.stderr) process.stderr.write(result.stderr);
  if (result.error) console.error(result.error.message);
  process.exit(result.status ?? 1);
}
if (tool !== "bun" || !(args[0] === "publish" || (args[0] === "run" && ["typecheck", "test"].includes(args[1])))) {
  throw new Error("unexpected subprocess: " + command);
}
`;

interface Command {
  tool: string;
  args: string[];
  cwd: string;
}

function fixture() {
  const directory = realpathSync(mkdtempSync(join(tmpdir(), "zebra-release-test-")));
  temporaryDirectories.push(directory);
  const root = join(directory, "repo");
  const bin = join(directory, "bin");
  const log = join(directory, "commands.jsonl");
  const env = Object.fromEntries(
    Object.entries(process.env).filter(
      ([key]) => !key.startsWith("GIT_") && !key.startsWith("RELEASE_TEST_"),
    ),
  );
  Object.assign(env, {
    PATH: `${bin}:${process.env.PATH ?? ""}`,
    GIT_CONFIG_NOSYSTEM: "1",
    GIT_CONFIG_GLOBAL: "/dev/null",
    RELEASE_TEST_REAL_GIT: realGit,
    RELEASE_TEST_LOG: log,
  });
  for (const dir of ["scripts", "packages/core/src", "packages/feature"]) {
    mkdirSync(join(root, dir), { recursive: true });
  }
  mkdirSync(bin);
  for (const command of ["bun", "git"]) {
    writeFileSync(join(bin, command), commandStub, { mode: 0o755 });
  }
  const write = (path: string, content: string) => writeFileSync(join(root, path), content);
  write("scripts/release.ts", releaseSource);
  write("package.json", JSON.stringify({ private: true, workspaces: ["packages/*"] }));
  write("packages/core/package.json", JSON.stringify({ name: "@fixture/core", version: "1.0.0" }));
  write(
    "packages/feature/package.json",
    JSON.stringify({
      name: "@fixture/feature",
      version: "1.0.0",
      dependencies: { "@fixture/core": "1.0.0" },
    }),
  );
  write("packages/core/src/index.ts", 'export const VERSION = "1.0.0";\n');
  write("CHANGELOG.md", "# Changelog\n");
  write("notes.txt", "unrelated tracked file\n");
  const git = (...args: string[]) => {
    const result = spawnSync(realGit, args, { cwd: root, env, encoding: "utf8" });
    if (result.status !== 0) throw new Error(result.stderr || result.error?.message);
    return result.stdout.trim();
  };
  git("init", "--quiet");
  git("config", "user.name", "Release fixture");
  git("config", "user.email", "release-fixture@example.invalid");
  git("config", "commit.gpgsign", "false");
  git("config", "tag.gpgsign", "false");
  git("config", "core.hooksPath", join(directory, "no-hooks"));
  git("add", ".");
  git("commit", "--quiet", "-m", "feat: fixture baseline");
  const head = git("rev-parse", "HEAD");
  return {
    root,
    bin,
    head,
    git,
    write,
    contents: () => releaseFiles.map((path) => readFileSync(join(root, path), "utf8")),
    commands: (): Command[] =>
      existsSync(log)
        ? readFileSync(log, "utf8")
            .trim()
            .split("\n")
            .map((line) => JSON.parse(line))
        : [],
    run: (args: string[], overrides: Record<string, string> = {}) =>
      spawnSync(process.execPath, [join(root, "scripts/release.ts"), ...args], {
        cwd: root,
        env: { ...env, ...overrides },
        encoding: "utf8",
      }),
  };
}

afterEach(() => {
  for (const directory of temporaryDirectories.splice(0)) {
    rmSync(directory, { recursive: true, force: true });
  }
});

const prepareArgs = ["--version", "1.1.0", "--prepare"];
const publishArgs = ["--version", "1.1.0", "--publish", "--registry", "https://registry.invalid"];
const destructive = (command: Command) =>
  (command.tool === "bun" && command.args[0] === "publish") ||
  (command.tool === "git" &&
    (["add", "commit"].includes(command.args[0]!) ||
      (command.args[0] === "tag" && !command.args.includes("--list"))));

describe("release preflight", () => {
  test.each(["tracked", "untracked", "staged"])(
    "rejects %s changes before verify or writes",
    (kind) => {
      const f = fixture();
      f.write(kind === "untracked" ? "untracked.txt" : "notes.txt", "user work\n");
      if (kind === "staged") f.git("add", "notes.txt");
      const contents = f.contents();
      const status = f.git("status", "--porcelain");
      for (const args of [prepareArgs, publishArgs]) {
        const result = f.run(args);
        expect(result.status).toBe(1);
        expect(result.stderr).toContain("working tree must be clean");
        expect(f.contents()).toEqual(contents);
        expect(f.git("status", "--porcelain")).toBe(status);
        expect(f.git("rev-parse", "HEAD")).toBe(f.head);
      }
      expect(f.commands().every((c) => c.tool === "git" && c.args[0] === "status")).toBe(true);
    },
  );

  test("rejects an existing target tag in prepare and local publish before writes", () => {
    const f = fixture();
    f.git("tag", "v1.1.0");
    const contents = f.contents();
    for (const args of [prepareArgs, publishArgs]) {
      const result = f.run(args);
      expect(result.status).toBe(1);
      expect(result.stderr).toContain("release tag v1.1.0 already exists");
      expect(f.contents()).toEqual(contents);
      expect(f.git("status", "--porcelain")).toBe("");
      expect(f.git("rev-parse", "HEAD")).toBe(f.head);
    }
    expect(f.commands().some((c) => c.tool === "bun" || destructive(c))).toBe(false);
  });

  test("publish-only accepts an existing prepared tag without writing or committing", () => {
    const f = fixture();
    f.git("tag", "v1.0.0");
    const contents = f.contents();
    const result = f.run([
      "--version",
      "1.0.0",
      "--publish",
      "--publish-only",
      "--registry",
      "https://registry.invalid",
      "--tolerate-republish",
    ]);
    expect(result.status).toBe(0);
    expect(f.contents()).toEqual(contents);
    expect(f.git("status", "--porcelain")).toBe("");
    expect(f.git("rev-parse", "HEAD")).toBe(f.head);
    expect(f.git("tag", "--list")).toBe("v1.0.0");
    const publications = f.commands().filter((c) => c.tool === "bun" && c.args[0] === "publish");
    expect(publications.map((c) => c.cwd)).toEqual([
      join(f.root, "packages/core"),
      join(f.root, "packages/feature"),
    ]);
    expect(publications.every((c) => c.args.includes("--tolerate-republish"))).toBe(true);
    expect(publications.every((c) => c.args.includes("https://registry.invalid"))).toBe(true);
    expect(f.commands().some((c) => c.tool === "git" && destructive(c))).toBe(false);
  });

  test.each(["package", "core VERSION"])("publish-only still validates %s", (mismatch) => {
    const f = fixture();
    f.git("tag", "v1.0.0");
    if (mismatch === "package") {
      f.write(
        "packages/feature/package.json",
        JSON.stringify({ name: "@fixture/feature", version: "0.9.0" }),
      );
    } else {
      f.write("packages/core/src/index.ts", 'export const VERSION = "0.9.0";\n');
    }
    const contents = f.contents();
    const result = f.run([
      "--version",
      "1.0.0",
      "--publish",
      "--publish-only",
      "--registry",
      "https://registry.invalid",
    ]);
    expect(result.status).toBe(1);
    expect(result.stderr).toContain("run --prepare first");
    expect(f.contents()).toEqual(contents);
    expect(f.commands()).toEqual([]);
  });

  test.each([
    [],
    ["--version"],
    ["--version", "--prepare"],
    ["--version", "1.1.0", "--registry"],
    ["--version", "1.1.0", "--registry", "--publish"],
    ["--version", "1.1.0", "--registry", ""],
    ["--version", "1.1.0", "--publish", "--prepare"],
    ["--version", "1.1.0", "--publish-only"],
    ["--version", "1.1.0", "--publish"],
    ["--version", "1.1.0", "--version", "1.2.0"],
    ["--version", "1.1.0", "--unknown"],
  ])("invalid arguments fail before any subprocess: %j", (...args) => {
    const f = fixture();
    const contents = f.contents();
    const result = f.run(args);
    expect(result.status).toBe(1);
    expect(result.stderr).toContain("error:");
    expect(f.contents()).toEqual(contents);
    expect(f.commands()).toEqual([]);
  });

  test.each([
    "01.2.3",
    "1.02.3",
    "1.2.03",
    "1.2.3-..",
    "1.2.3-alpha..1",
    "1.2.3-01",
    "1.2.3+..",
    "1.2.3\n",
  ])("rejects invalid SemVer %s before commands or writes", (version) => {
    const f = fixture();
    const contents = f.contents();
    const result = f.run(["--version", version, "--prepare"]);
    expect(result.status).toBe(1);
    expect(result.stderr).toContain("--version X.Y.Z required");
    expect(f.contents()).toEqual(contents);
    expect(f.commands()).toEqual([]);
  });

  test.each([
    "0.0.0",
    "1.2.3-alpha.1",
    "1.2.3-0",
    "1.2.3-01a",
    "1.2.3+001",
    "1.2.3-alpha.1+build.001",
  ])("accepts valid SemVer %s in dry-run", (version) => {
    const f = fixture();
    const contents = f.contents();
    const result = f.run(["--version", version, "--no-verify"]);
    expect(result.status).toBe(0);
    expect(result.stdout).toContain("done (dry-run, nothing written)");
    expect(f.contents()).toEqual(contents);
    expect(f.git("status", "--porcelain")).toBe("");
    expect(f.commands().some(destructive)).toBe(false);
  });

  test("dry-run verifies by default but never writes, commits, tags or publishes", () => {
    const f = fixture();
    const contents = f.contents();
    const result = f.run(["--version", "1.1.0"]);
    expect(result.status).toBe(0);
    expect(f.contents()).toEqual(contents);
    expect(f.git("status", "--porcelain")).toBe("");
    expect(f.git("rev-parse", "HEAD")).toBe(f.head);
    expect(f.git("tag", "--list")).toBe("");
    expect(
      f
        .commands()
        .filter((c) => c.tool === "bun")
        .map((c) => c.args),
    ).toEqual([
      ["run", "typecheck"],
      ["run", "test"],
    ]);
    expect(f.commands().some(destructive)).toBe(false);
  });
});

describe("release stages", () => {
  test("prepare commits only release files even if verification stages unrelated changes", () => {
    const f = fixture();
    const result = f.run(prepareArgs, { RELEASE_TEST_UNRELATED: "1" });
    expect(result.status).toBe(0);
    expect(f.git("show", "--format=", "--name-only", "HEAD").split("\n").sort()).toEqual(
      [...releaseFiles].sort(),
    );
    expect(f.git("show", "HEAD:notes.txt")).toBe("unrelated tracked file");
    expect(f.git("diff", "--cached", "--name-only")).toBe("notes.txt");
    expect(f.git("status", "--porcelain")).toContain("?? generated.txt");
    expect(f.git("rev-parse", "v1.1.0")).toBe(f.git("rev-parse", "HEAD"));
    const pkg = JSON.parse(readFileSync(join(f.root, "packages/feature/package.json"), "utf8"));
    expect(pkg.version).toBe("1.1.0");
    expect(pkg.dependencies["@fixture/core"]).toBe("1.1.0");
    expect(
      f
        .commands()
        .filter((c) => c.tool === "git" && c.args[0] === "add")
        .map((c) => c.args),
    ).toEqual([["add", "--", ...releaseFiles]]);
    expect(f.commands().some((c) => c.tool === "bun" && c.args[0] === "publish")).toBe(false);
  });

  test("local publish verifies then publishes in dependency order before commit and tag", () => {
    const f = fixture();
    const result = f.run(publishArgs);
    expect(result.status).toBe(0);
    const stages = f.commands().filter((c) => c.tool === "bun" || destructive(c));
    expect(
      stages.map((c) =>
        [c.tool, ...c.args.slice(0, c.tool === "bun" && c.args[0] === "run" ? 2 : 1)].join(" "),
      ),
    ).toEqual([
      "bun run typecheck",
      "bun run test",
      "bun publish",
      "bun publish",
      "git add",
      "git commit",
      "git tag",
    ]);
    expect(stages.filter((c) => c.args[0] === "publish").map((c) => c.cwd)).toEqual([
      join(f.root, "packages/core"),
      join(f.root, "packages/feature"),
    ]);
    expect(f.git("status", "--porcelain")).toBe("");
    expect(f.git("rev-parse", "v1.1.0")).toBe(f.git("rev-parse", "HEAD"));
  });

  test.each(["git status", "git tag --list", "git log", "bun run typecheck", "bun run test"])(
    "%s failure preserves diagnostics and aborts before writes",
    (command) => {
      const f = fixture();
      const contents = f.contents();
      const result = f.run(publishArgs, { RELEASE_TEST_FAIL_COMMAND: command });
      expect(result.status).toBe(1);
      expect(result.stderr).toContain(`fixture stderr: ${command}`);
      expect(result.stderr).toContain(`fixture stdout: ${command}`);
      expect(result.stderr).toContain("exit 23");
      expect(f.contents()).toEqual(contents);
      expect(f.commands().at(-1)!.args.join(" ")).toStartWith(
        command.slice(command.indexOf(" ") + 1),
      );
      expect(f.commands().some(destructive)).toBe(false);
    },
  );

  test.each(["bun publish", "git add", "git commit", "git tag v1.1.0"])(
    "%s failure stops all subsequent release stages",
    (command) => {
      const f = fixture();
      const result = f.run(command === "bun publish" ? publishArgs : prepareArgs, {
        RELEASE_TEST_FAIL_COMMAND: command,
      });
      expect(result.status).toBe(1);
      expect(result.stderr).toContain(`fixture stderr: ${command}`);
      expect(result.stderr).toContain("exit 23");
      const commands = f.commands();
      expect([commands.at(-1)!.tool, ...commands.at(-1)!.args].join(" ")).toStartWith(command);
      expect(f.git("tag", "--list")).toBe("");
      if (command !== "git tag v1.1.0") expect(f.git("rev-parse", "HEAD")).toBe(f.head);
      if (command === "bun publish") {
        expect(commands.filter((c) => c.tool === "bun" && c.args[0] === "publish")).toHaveLength(1);
        expect(commands.some((c) => c.tool === "git" && destructive(c))).toBe(false);
      }
    },
  );

  test("reports subprocess startup errors before writing or publishing", () => {
    const f = fixture();
    rmSync(join(f.bin, "bun"));
    const contents = f.contents();
    const result = f.run(publishArgs, { PATH: f.bin });
    expect(result.status).toBe(1);
    expect(result.stderr).toMatch(/ENOENT|Executable not found/);
    expect(result.stderr).toContain("typecheck failed");
    expect(f.contents()).toEqual(contents);
    expect(f.commands().some(destructive)).toBe(false);
  });

  test("reports termination signals before writing or publishing", () => {
    const f = fixture();
    const contents = f.contents();
    const result = f.run(publishArgs, { RELEASE_TEST_SIGNAL_COMMAND: "bun run typecheck" });
    expect(result.status).toBe(1);
    expect(result.stderr).toContain("signal SIGTERM");
    expect(f.contents()).toEqual(contents);
    expect(f.commands().some(destructive)).toBe(false);
  });
});
