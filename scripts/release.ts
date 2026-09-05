#!/usr/bin/env bun
import { spawnSync } from "node:child_process";
import { existsSync, readFileSync, readdirSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";

const ROOT = resolve(import.meta.dir, "..");

const NUMERIC_IDENTIFIER = "(?:0|[1-9]\\d*)";
const PRERELEASE_IDENTIFIER = "(?:0|[1-9]\\d*|\\d*[A-Za-z-][0-9A-Za-z-]*)";
const SEMVER_RE = new RegExp(
  `^${NUMERIC_IDENTIFIER}\\.${NUMERIC_IDENTIFIER}\\.${NUMERIC_IDENTIFIER}(?:-${PRERELEASE_IDENTIFIER}(?:\\.${PRERELEASE_IDENTIFIER})*)?(?:\\+[0-9A-Za-z-]+(?:\\.[0-9A-Za-z-]+)*)?$`,
);
const TYPE_RE =
  /^(feat|fix|docs|chore|test|refactor|perf|build|ci|style|revert)(?:\(([^)]*)\))?:\s*(.+)$/;
const CATEGORY_HEADERS = ["Features", "Bug fixes", "Docs", "Chores", "Tests", "Other"] as const;
const CATEGORY_MAP: Record<string, (typeof CATEGORY_HEADERS)[number]> = {
  feat: "Features",
  fix: "Bug fixes",
  docs: "Docs",
  chore: "Chores",
  test: "Tests",
};

type Pkg = {
  dir: string;
  name: string;
  version: string;
  path: string;
  data: Record<string, unknown> & {
    name?: string;
    version?: string;
    private?: boolean;
    dependencies?: Record<string, string>;
  };
};

function readJson(path: string): Record<string, any> {
  return JSON.parse(readFileSync(path, "utf8"));
}

function writeJson(path: string, data: unknown): void {
  // Keep the repository's compact one-item `files` arrays stable after a
  // release write; this also keeps the generated release commit Biome-clean.
  const content = JSON.stringify(data, null, 2).replace(
    /"files": \[\n\s+"src"\n\s+\]/g,
    '"files": ["src"]',
  );
  writeFileSync(path, `${content}\n`);
}

function run(cmd: string, args: string[], cwd: string) {
  const res = spawnSync(cmd, args, { cwd, encoding: "utf8" });
  return { ...res, ok: res.status === 0, stdout: res.stdout ?? "", stderr: res.stderr ?? "" };
}

function runChecked(cmd: string, args: string[], cwd: string, failure: string) {
  const res = run(cmd, args, cwd);
  if (!res.ok) {
    if (res.stdout) console.error(res.stdout.trimEnd());
    if (res.stderr) console.error(res.stderr.trimEnd());
    if (res.error) console.error(res.error.message);
    const reason = res.signal ? `signal ${res.signal}` : `exit ${res.status ?? "unknown"}`;
    console.error(`error: ${failure} (${reason})`);
    process.exit(1);
  }
  return res;
}

function today(): string {
  const d = new Date();
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

const args = process.argv.slice(2);

function flag(name: string): boolean {
  return args.includes(name);
}

function value(name: string): string | undefined {
  const i = args.indexOf(name);
  return i >= 0 ? args[i + 1] : undefined;
}

if (flag("--help") || flag("-h")) {
  console.log(`Usage: bun scripts/release.ts --version X.Y.Z [--prepare | --publish] [options]

  --version X.Y.Z  bump all publishable packages to this version (required)
  --prepare        write the version/changelog, commit, and tag; do not publish
  --publish        publish locally, then commit and tag (default is dry-run: print only)
  --publish-only   publish the already-prepared version (CI mode; requires --publish)
  --tolerate-republish
                   skip an already-published package version (useful for CI retries)
  --no-verify      skip the typecheck + test verification step (default: verify)
  --registry URL   registry passed explicitly to bun publish (required with --publish)
`);
  process.exit(0);
}

const valueFlags = new Set(["--version", "--registry"]);
const booleanFlags = new Set([
  "--prepare",
  "--publish",
  "--publish-only",
  "--tolerate-republish",
  "--no-verify",
]);
const seen = new Set<string>();
for (let i = 0; i < args.length; i++) {
  const arg = args[i]!;
  if (!valueFlags.has(arg) && !booleanFlags.has(arg)) {
    console.error(`error: unknown argument ${JSON.stringify(arg)}`);
    process.exit(1);
  }
  if (seen.has(arg)) {
    console.error(`error: duplicate argument ${arg}`);
    process.exit(1);
  }
  seen.add(arg);
  if (valueFlags.has(arg)) {
    const next = args[++i];
    if (!next || next.startsWith("--")) {
      console.error(`error: ${arg} requires a value`);
      process.exit(1);
    }
  }
}

const requestedVersion = value("--version");
if (
  !requestedVersion ||
  requestedVersion.trim() !== requestedVersion ||
  !SEMVER_RE.test(requestedVersion)
) {
  console.error(`error: --version X.Y.Z required (got ${JSON.stringify(requestedVersion)})`);
  process.exit(1);
}
const version = requestedVersion;

const prepare = flag("--prepare");
const publish = flag("--publish");
const publishOnly = flag("--publish-only");
const tolerateRepublish = flag("--tolerate-republish");
const dryRun = !prepare && !publish;
const verify = !flag("--no-verify");
const registry = value("--registry");

if (prepare && publish) {
  console.error("error: --prepare cannot be combined with --publish");
  process.exit(1);
}

if (publishOnly && !publish) {
  console.error("error: --publish-only requires --publish");
  process.exit(1);
}

if (publish && !registry) {
  console.error("error: --registry URL is required with --publish");
  process.exit(1);
}

const mode = dryRun ? "dry-run" : prepare ? "prepare" : publishOnly ? "publish-only" : "publish";
console.log(`[release] version ${version} (${mode})`);

const tag = `v${version}`;
if (!dryRun && !publishOnly) {
  const status = runChecked(
    "git",
    ["status", "--porcelain", "--untracked-files=all"],
    ROOT,
    "could not inspect the working tree",
  );
  if (status.stdout.trim() !== "") {
    console.error("error: working tree must be clean before preparing or publishing a release");
    console.error(status.stdout.trimEnd());
    process.exit(1);
  }
  const existingTag = runChecked(
    "git",
    ["tag", "--list", tag],
    ROOT,
    "could not inspect the release tag",
  );
  if (existingTag.stdout.trim() !== "") {
    console.error(
      `error: release tag ${tag} already exists; use --publish --publish-only to publish a prepared release`,
    );
    process.exit(1);
  }
}

// --- collect publishable packages from root workspaces ---------------------
const rootPkg = readJson(join(ROOT, "package.json"));
const workspaceDirs: string[] = [];
for (const ws of (rootPkg.workspaces as string[]) ?? []) {
  if (!ws.startsWith("packages/")) continue;
  if (ws.includes("*")) {
    const prefix = ws.slice(0, ws.indexOf("*"));
    const base = join(ROOT, prefix);
    if (existsSync(base)) {
      for (const entry of readdirSync(base)) workspaceDirs.push(prefix + entry);
    }
  } else {
    workspaceDirs.push(ws);
  }
}

const packages: Pkg[] = [];
for (const dir of workspaceDirs) {
  const path = join(ROOT, dir, "package.json");
  if (!existsSync(path)) continue;
  const data = readJson(path);
  if (!data.name || !data.version || data.private === true) continue;
  packages.push({ dir, name: data.name, version: data.version, path, data });
}
packages.sort((a, b) => a.name.localeCompare(b.name));

if (packages.length === 0) {
  console.error("error: no publishable packages found under packages/");
  process.exit(1);
}

const byName = new Map(packages.map((p) => [p.name, p]));

// --- version bump + @zebra-web/* dependency sync -------------------------------
if (!publishOnly) {
  for (const pkg of packages) {
    pkg.data.version = version;
    for (const [dep, spec] of Object.entries(
      (pkg.data.dependencies as Record<string, string>) ?? {},
    )) {
      if (byName.has(dep) && spec !== "workspace:*") pkg.data.dependencies![dep] = version;
    }
  }
}

// --- keep core's VERSION constant in lockstep -------------------------------
// The freeze doc declares VERSION's *value* unstable (it tracks the package
// version); the release script rewrites it so the runtime constant never
// drifts from the published version.
const CORE_INDEX = join(ROOT, "packages/core/src/index.ts");
const versionSource = readFileSync(CORE_INDEX, "utf8");
const versionPattern = /export const VERSION = "[^"]*";/;
if (!versionPattern.test(versionSource)) {
  console.error("error: VERSION constant not found in packages/core/src/index.ts");
  process.exit(1);
}
const currentCoreVersion = versionSource.match(versionPattern)?.[0].match(/"([^"]+)"/)?.[1];
if (publishOnly) {
  for (const pkg of packages) {
    if (pkg.version !== version) {
      console.error(
        `error: ${pkg.name} is ${pkg.version}, but release tag requests ${version}; run --prepare first`,
      );
      process.exit(1);
    }
  }
  if (currentCoreVersion !== version) {
    console.error(
      `error: packages/core VERSION is ${currentCoreVersion ?? "unknown"}, but release tag requests ${version}; run --prepare first`,
    );
    process.exit(1);
  }
}
const versionedSource = versionSource.replace(
  versionPattern,
  `export const VERSION = "${version}";`,
);

// --- publish order: topological sort by dependencies (deps first) ----------
const state = new Map<string, "visiting" | "done">();
const order: Pkg[] = [];
function visit(pkg: Pkg): void {
  const st = state.get(pkg.name);
  if (st === "done") return;
  if (st === "visiting") {
    console.error(`error: dependency cycle involving ${pkg.name}`);
    process.exit(1);
  }
  state.set(pkg.name, "visiting");
  for (const dep of Object.keys((pkg.data.dependencies as Record<string, string>) ?? {})) {
    const depPkg = byName.get(dep);
    if (depPkg) visit(depPkg);
  }
  state.set(pkg.name, "done");
  order.push(pkg);
}
for (const pkg of packages) visit(pkg);

// --- changelog from conventional commits since the last semver tag ----------
// Only `v<semver>` tags bound the changelog range. The repo once carried a
// non-semver tag (`v1-archive`); `git describe` would pick it and recompute
// the same range on every release, duplicating the changelog.
function lastTag(): string | null {
  const res = runChecked(
    "git",
    ["tag", "--list", "v*", "--sort=-version:refname"],
    ROOT,
    "could not read release tags",
  );
  const semverTag = res.stdout
    .split("\n")
    .map((t) => t.trim())
    .find((t) => /^v\d+\.\d+\.\d+$/.test(t));
  return semverTag ?? null;
}

function commitSubjects(): string[] {
  const tag = lastTag();
  const args = ["log", "--format=%s"];
  if (tag) args.push(`${tag}..HEAD`);
  const res = runChecked("git", args, ROOT, "could not read changelog commits");
  return res.stdout
    .split("\n")
    .map((s) => s.trim())
    .filter((s) => s.length > 0 && !/^(?:chore\(release\)|release):/i.test(s));
}

function buildChangelogSection(): string {
  const grouped = new Map<(typeof CATEGORY_HEADERS)[number], string[]>();
  for (const header of CATEGORY_HEADERS) grouped.set(header, []);
  for (const subject of commitSubjects()) {
    const m = subject.match(TYPE_RE);
    if (!m) {
      grouped.get("Other")!.push(subject);
      continue;
    }
    const type = m[1]!;
    const scope = m[2];
    const rest = m[3]!;
    const header = CATEGORY_MAP[type] ?? "Other";
    const item = (scope ? `${scope}: ${rest}` : rest).replaceAll("@zebra/", "@zebra-web/");
    grouped.get(header)!.push(item);
  }
  const lines = [`## v${version} (${today()})`, ""];
  for (const header of CATEGORY_HEADERS) {
    const items = grouped.get(header)!;
    if (items.length === 0) continue;
    lines.push(`### ${header}`);
    for (const item of items) lines.push(`- ${item}`);
    lines.push("");
  }
  return `${lines.join("\n").trimEnd()}\n`;
}

const changelogPath = join(ROOT, "CHANGELOG.md");
function hasChangelogVersion(): boolean {
  if (!existsSync(changelogPath)) return false;
  const existing = readFileSync(changelogPath, "utf8");
  const escapedVersion = version.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  return new RegExp(`^##\\s+v${escapedVersion}(?:\\s|$)`, "m").test(existing);
}

function writeChangelog(section: string): void {
  const existing = existsSync(changelogPath) ? readFileSync(changelogPath, "utf8") : "";
  if (hasChangelogVersion()) {
    console.log(`[release] CHANGELOG.md already contains v${version}; leaving it unchanged`);
    return;
  }
  let content: string;
  if (existing.trim() === "") {
    content = `# Changelog\n\n${section}`;
  } else {
    const titleMatch = existing.match(/^#\s+.+$/m);
    if (titleMatch && titleMatch.index !== undefined) {
      const titleLine = titleMatch[0];
      content = `${existing.slice(0, titleMatch.index) + titleLine}\n\n${section}\n\n${existing.slice(titleMatch.index + titleLine.length).replace(/^\n+/, "")}`;
    } else {
      content = `${section}\n${existing}`;
    }
  }
  writeFileSync(changelogPath, content);
}

// --- verification -----------------------------------------------------------
function verifyStep(): void {
  console.log("[release] verifying: bun run typecheck");
  runChecked("bun", ["run", "typecheck"], ROOT, "typecheck failed — aborting");
  console.log("[release] verifying: bun run test");
  runChecked("bun", ["run", "test"], ROOT, "tests failed — aborting");
}

// --- execute (or print) -----------------------------------------------------
const changelogSection = buildChangelogSection();

console.log("");
console.log("[release] version bumps:");
for (const pkg of packages) console.log(`  ${pkg.name} ${pkg.version} -> ${version}`);
console.log("");
console.log(`[release] publish order (${order.map((p) => p.name).join(" -> ")})`);
console.log("");

if (dryRun) {
  if (verify) verifyStep();
  if (hasChangelogVersion()) {
    console.log(
      `[release] CHANGELOG.md already contains v${version}; no new section would be written`,
    );
  } else {
    console.log("[release] would write CHANGELOG.md (new section):");
    console.log(
      changelogSection
        .split("\n")
        .map((l) => `  | ${l}`)
        .join("\n"),
    );
  }
  console.log(
    `[release] would rewrite ${versionSource.match(/export const VERSION = "[^"]*";/)?.[0] ?? "VERSION"} -> "${version}" in packages/core/src/index.ts`,
  );
  console.log("[release] planned commands (dry-run — not executed):");
  const steps: string[] = [];
  for (const pkg of order) {
    const registryFlag = registry ? ` --registry ${registry}` : "";
    const tolerateFlag = tolerateRepublish ? " --tolerate-republish" : "";
    steps.push(`bun publish --access public${registryFlag}${tolerateFlag}  (cwd: ${pkg.dir})`);
  }
  steps.forEach((s, i) => console.log(`  ${i + 1}. ${s}`));
  console.log("\n[release] done (dry-run, nothing written).");
  process.exit(0);
}

if (verify) verifyStep();

if (!publishOnly) {
  for (const pkg of packages) writeJson(pkg.path, pkg.data);
  writeFileSync(CORE_INDEX, versionedSource);
  writeChangelog(changelogSection);
  console.log("[release] wrote version bumps + core VERSION + CHANGELOG.md");
} else {
  console.log("[release] publish-only mode: no files will be written");
}

if (!prepare) {
  for (const pkg of order) {
    console.log(`[release] publish ${pkg.name} (${pkg.dir})`);
    const publishArgs = ["publish", "--access", "public"];
    if (registry) publishArgs.push("--registry", registry);
    if (tolerateRepublish) publishArgs.push("--tolerate-republish");
    runChecked("bun", publishArgs, join(ROOT, pkg.dir), `publish of ${pkg.name} failed — aborting`);
  }
}

if (publishOnly) {
  console.log("[release] done (publish-only; no commit or tag written)");
  process.exit(0);
}

// Tag the release so the next changelog range starts here (lastTag() only
// matches semver tags). Commit the bump + changelog first, then tag.
console.log(`[release] committing release (${tag})`);
const releaseFiles = [
  ...packages.map((pkg) => join(pkg.dir, "package.json")),
  "packages/core/src/index.ts",
  "CHANGELOG.md",
];
runChecked(
  "git",
  ["add", "--", ...releaseFiles],
  ROOT,
  "staging release files failed — aborting before commit",
);
// Verification/publish hooks can create or stage unrelated files after the
// initial clean-tree check. Commit only the files owned by this release.
runChecked(
  "git",
  ["commit", "--only", "-m", `chore(release): ${tag}`, "--", ...releaseFiles],
  ROOT,
  "release commit failed — aborting before tagging",
);
runChecked("git", ["tag", tag], ROOT, `tagging ${tag} failed`);

console.log(`[release] done. tagged ${tag}`);
