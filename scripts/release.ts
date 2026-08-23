#!/usr/bin/env bun
import { spawnSync } from "node:child_process";
import { existsSync, readFileSync, readdirSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";

const ROOT = resolve(import.meta.dir, "..");

const SEMVER_RE = /^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?(?:\+[0-9A-Za-z.-]+)?$/;
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
  data: Record<string, unknown> & { name?: string; version?: string; private?: boolean };
};

function readJson(path: string): Record<string, any> {
  return JSON.parse(readFileSync(path, "utf8"));
}

function writeJson(path: string, data: unknown): void {
  writeFileSync(path, `${JSON.stringify(data, null, 2)}\n`);
}

function run(
  cmd: string,
  args: string[],
  cwd: string,
): { ok: boolean; stdout: string; stderr: string } {
  const res = spawnSync(cmd, args, { cwd, encoding: "utf8" });
  return { ok: res.status === 0, stdout: res.stdout ?? "", stderr: res.stderr ?? "" };
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
  console.log(`Usage: bun scripts/release.ts --version X.Y.Z [--publish] [--no-verify] [--registry URL]

  --version X.Y.Z  bump all publishable packages to this version (required)
  --publish        actually run the release (default is dry-run: print only)
  --no-verify      skip the typecheck + test verification step (default: verify)
  --registry URL   registry passed explicitly to bun publish (required with --publish)
`);
  process.exit(0);
}

const version = value("--version");
if (!version || !SEMVER_RE.test(version)) {
  console.error(`error: --version X.Y.Z required (got ${JSON.stringify(version)})`);
  process.exit(1);
}

const dryRun = !flag("--publish");
const verify = !flag("--no-verify");
const registry = value("--registry");

if (!dryRun && !registry) {
  console.error("error: --registry URL is required with --publish");
  process.exit(1);
}

console.log(`[release] version ${version} (${dryRun ? "dry-run" : "publish"})`);

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
for (const pkg of packages) {
  pkg.data.version = version;
  for (const [dep, spec] of Object.entries(
    (pkg.data.dependencies as Record<string, string>) ?? {},
  )) {
    if (byName.has(dep) && spec !== "workspace:*") pkg.data.dependencies![dep] = version;
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
  const res = run("git", ["tag", "--list", "v*", "--sort=-version:refname"], ROOT);
  if (!res.ok) return null;
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
  const res = run("git", args, ROOT);
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
    const [, type, scope, rest] = m;
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
  if (!run("bun", ["run", "typecheck"], ROOT).ok) {
    console.error("error: typecheck failed — aborting");
    process.exit(1);
  }
  console.log("[release] verifying: bun run test");
  if (!run("bun", ["run", "test"], ROOT).ok) {
    console.error("error: tests failed — aborting");
    process.exit(1);
  }
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
    steps.push(`bun publish --access public${registryFlag}  (cwd: ${pkg.dir})`);
  }
  steps.forEach((s, i) => console.log(`  ${i + 1}. ${s}`));
  console.log("\n[release] done (dry-run, nothing written).");
  process.exit(0);
}

if (verify) verifyStep();

for (const pkg of packages) writeJson(pkg.path, pkg.data);
writeFileSync(CORE_INDEX, versionedSource);
writeChangelog(changelogSection);
console.log("[release] wrote version bumps + core VERSION + CHANGELOG.md");

for (const pkg of order) {
  console.log(`[release] publish ${pkg.name} (${pkg.dir})`);
  const publishArgs = ["publish", "--access", "public"];
  if (registry) publishArgs.push("--registry", registry);
  const res = run("bun", publishArgs, join(ROOT, pkg.dir));
  if (!res.ok) {
    console.error(res.stderr);
    console.error(`error: publish of ${pkg.name} failed — aborting`);
    process.exit(1);
  }
}

// Tag the release so the next changelog range starts here (lastTag() only
// matches semver tags). Commit the bump + changelog first, then tag.
const tag = `v${version}`;
console.log(`[release] committing release (${tag})`);
const addRes = run("git", ["add", "-A"], ROOT);
const commitRes = run("git", ["commit", "-m", `chore(release): ${tag}`], ROOT);
if (!addRes.ok || !commitRes.ok) {
  console.error("error: release commit failed — aborting before tagging");
  process.exit(1);
}
const tagRes = run("git", ["tag", tag], ROOT);
if (!tagRes.ok) {
  console.error(tagRes.stderr);
  console.error(`error: tagging ${tag} failed`);
  process.exit(1);
}

console.log(`[release] done. tagged ${tag}`);
