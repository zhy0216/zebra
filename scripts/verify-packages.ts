#!/usr/bin/env bun
/**
 * Tarball smoke test (`bun run verify:packages`).
 *
 * For every publishable package (anything under packages/ that is not
 * `private`): packs it with `bun pm pack`, checks the tarball actually
 * contains the published surface (`src/index.ts` + every path referenced by
 * `main`/`types`/`exports`), then installs all tarballs into a fresh temp
 * project and verifies each package resolves, imports and typechecks from the
 * installed tarball.
 *
 * This guards the src-direct publishing strategy: the tarball ships `src/`
 * only (no `dist/`), and the exports map must work from a clean install.
 *
 * Cross-package install: `bun pm pack` rewrites `workspace:*` deps to the
 * concrete version, and since @zebra/* is not on the registry yet, every
 * tarball is installed as a `file:` dependency and `overrides` force the
 * transitive deps to the same tarballs (bun does not otherwise match a
 * semver dep to a `file:` tarball).
 */
import { spawnSync } from "node:child_process";
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";

const ROOT = resolve(import.meta.dir, "..");

function readJson(path: string): Record<string, any> {
  return JSON.parse(readFileSync(path, "utf8"));
}

function run(
  cmd: string,
  args: string[],
  cwd: string,
): { ok: boolean; stdout: string; stderr: string } {
  const res = spawnSync(cmd, args, { cwd, encoding: "utf8", env: { ...process.env } });
  return { ok: res.status === 0, stdout: res.stdout ?? "", stderr: res.stderr ?? "" };
}

function fail(message: string): never {
  console.error(`error: ${message}`);
  process.exit(1);
}

// --- collect publishable packages (mirrors scripts/release.ts) --------------

const rootPkg = readJson(join(ROOT, "package.json"));
const packageDirs: string[] = [];
for (const ws of (rootPkg.workspaces as string[]) ?? []) {
  if (!ws.startsWith("packages/")) continue;
  if (ws.includes("*")) {
    const prefix = ws.slice(0, ws.indexOf("*"));
    const base = join(ROOT, prefix);
    if (existsSync(base)) {
      for (const entry of readdirSync(base)) packageDirs.push(prefix + entry);
    }
  } else {
    packageDirs.push(ws);
  }
}

interface Pkg {
  dir: string;
  name: string;
  version: string;
  tarball: string;
}

const packages: Pkg[] = [];
for (const dir of packageDirs) {
  const path = join(ROOT, dir, "package.json");
  if (!existsSync(path)) continue;
  const data = readJson(path);
  if (!data.name || !data.version || data.private === true) continue;
  packages.push({ dir, name: data.name, version: data.version, tarball: "" });
}
packages.sort((a, b) => a.name.localeCompare(b.name));

if (packages.length === 0) fail("no publishable packages found under packages/");

const tempBase = mkdtempSync(join(tmpdir(), "zebra-verify-"));
const tarballDir = join(tempBase, "tarballs");
const projectDir = join(tempBase, "project");

try {
  console.log(
    `[verify:packages] ${packages.length} packages (${packages.map((p) => p.name).join(", ")})`,
  );

  // --- pack every package ---------------------------------------------------

  for (const pkg of packages) {
    const res = run(
      "bun",
      ["pm", "pack", "--destination", tarballDir, "--quiet"],
      join(ROOT, pkg.dir),
    );
    if (!res.ok) fail(`bun pm pack failed for ${pkg.name}:\n${res.stderr}`);
    const path = res.stdout.trim();
    if (!path || !existsSync(path)) fail(`bun pm pack for ${pkg.name} did not produce a tarball`);
    pkg.tarball = path;
  }

  // --- tarball contents: src-direct strategy must hold ----------------------

  const tarList = (tgz: string): string[] => {
    const res = run("tar", ["-tzf", tgz], tempBase);
    if (!res.ok) fail(`could not list ${tgz}:\n${res.stderr}`);
    return res.stdout
      .split("\n")
      .map((l) => l.trim())
      .filter(Boolean);
  };

  for (const pkg of packages) {
    const files = tarList(pkg.tarball);
    const packageFile = files.find((f) => f === "package/package.json");
    if (!packageFile) fail(`${pkg.name}: tarball has no package/package.json`);
    const res = run("tar", ["-xzOf", pkg.tarball, "package/package.json"], tempBase);
    if (!res.ok) fail(`${pkg.name}: could not read package.json from tarball`);
    const manifest = JSON.parse(res.stdout);

    const inTarball = new Set(files.map((f) => f.replace(/^package\//, "")));
    const refs = [manifest.main, manifest.types, manifest.exports?.["."] ?? manifest.exports]
      .filter((v: unknown): v is string => typeof v === "string")
      .map((v: string) => v.replace(/^\.\//, ""));
    for (const ref of refs) {
      if (!inTarball.has(ref)) {
        fail(
          `${pkg.name}: published path "${ref}" is not in the tarball (files: ["src"] mismatch?)`,
        );
      }
    }
    if (!inTarball.has("src/index.ts")) {
      fail(`${pkg.name}: tarball is missing src/index.ts — src-direct publishing broken`);
    }
    // Guard: dist/ must NOT leak into the published tarball.
    for (const f of files) {
      if (f.includes("/dist/")) fail(`${pkg.name}: tarball unexpectedly contains ${f}`);
    }
    console.log(`  pack ${pkg.name}@${pkg.version}: ${files.length} files, src-direct OK`);
  }

  // --- fresh project: install tarballs + import checks -----------------------

  mkdirSync(projectDir, { recursive: true });
  const deps: Record<string, string> = {};
  for (const pkg of packages) deps[pkg.name] = `file:${pkg.tarball}`;
  writeFileSync(
    join(projectDir, "package.json"),
    JSON.stringify(
      {
        name: "zebra-verify-smoke",
        private: true,
        type: "module",
        dependencies: deps,
        // bun does not satisfy a semver dep (as rewritten from workspace:* by
        // `bun pm pack`) with a `file:` tarball, so force every @zebra/* name
        // to the packed tarball.
        overrides: deps,
      },
      null,
      2,
    ),
  );

  const install = run("bun", ["install"], projectDir);
  if (!install.ok) fail(`bun install of tarballs failed:\n${install.stderr}`);

  const verifySource = `import { Zebra } from "@zebra/core";
import { sessionMiddleware } from "@zebra/session";
import { rateLimit } from "@zebra/rate-limit";
import { cors } from "@zebra/cors";
import { zc } from "@zebra/contract";
import { createClient } from "@zebra/client";
import { createTestApp } from "@zebra/testing";
import { accessLog, errorReporter, health, metrics, requestId } from "@zebra/observability";
import { RedisRateLimitStore, RedisSessionStore } from "@zebra/redis";
import { Zebra as FacadeZebra } from "zebra";
import { createMcpServer } from "@zebra/mcp";
import { zodSchemaAdapter } from "@zebra/schema-zod";

function expectType(value: unknown, what: string): void {
  if (typeof value !== "function") throw new Error("export " + what + " is not a function");
}
function expectObject(value: unknown, what: string): void {
  if (typeof value !== "object" || value === null) throw new Error("export " + what + " is not an object");
}

expectType(Zebra, "Zebra");
expectType(new Zebra().get, "Zebra().get");
expectType(sessionMiddleware({ secret: "smoke-secret" }), "sessionMiddleware()");
expectType(rateLimit({ windowMs: 60_000, max: 5 }), "rateLimit()");
expectType(cors({ origin: "*" }), "cors()");
expectType(zc.get, "zc.get");
expectObject(zc.get("/smoke"), "zc.get('/smoke')");
expectType(createClient, "createClient");
expectType(createTestApp, "createTestApp");
expectObject(createTestApp(), "createTestApp()");
expectType(requestId(), "requestId()");
expectType(accessLog(), "accessLog()");
expectType(errorReporter(() => {}), "errorReporter()");
expectType(health(), "health()");
expectType(metrics(), "metrics()");
expectType(RedisSessionStore, "RedisSessionStore");
expectType(RedisRateLimitStore, "RedisRateLimitStore");
expectType(FacadeZebra, "facade Zebra");
expectType(new FacadeZebra().get, "facade Zebra().get");
expectType(createMcpServer, "createMcpServer");
expectObject(zodSchemaAdapter(), "zodSchemaAdapter()");

console.log("all exports verified from installed tarballs");
`;
  writeFileSync(join(projectDir, "verify.ts"), verifySource);

  const verify = run("bun", ["verify.ts"], projectDir);
  if (!verify.ok) fail(`import checks failed:\n${verify.stderr}`);

  // --- types resolution: tsgo against the installed tarballs -----------------

  writeFileSync(
    join(projectDir, "tsconfig.json"),
    JSON.stringify(
      {
        compilerOptions: {
          target: "ESNext",
          module: "ESNext",
          moduleResolution: "bundler",
          lib: ["ESNext"],
          types: ["bun"],
          strict: true,
          noEmit: true,
          skipLibCheck: true,
          allowImportingTsExtensions: true,
        },
        include: ["verify.ts"],
      },
      null,
      2,
    ),
  );
  const typesInstall = run(
    "bun",
    ["add", "-d", "@typescript/native-preview@7.0.0-dev.20260707.2", "@types/bun"],
    projectDir,
  );
  if (!typesInstall.ok)
    fail(
      `could not add @typescript/native-preview/@types/bun to smoke project:\n${typesInstall.stderr}`,
    );
  const tsgo = run("bun", ["x", "tsgo", "--noEmit"], projectDir);
  if (!tsgo.ok) {
    fail(
      `typecheck of installed tarballs failed (main/types/exports do not resolve):\n${tsgo.stderr}${tsgo.stdout}`,
    );
  }

  console.log("  install + imports + types: OK (fresh project, all tarballs)");
  console.log("[verify:packages] all packages verified");
} finally {
  rmSync(tempBase, { recursive: true, force: true });
}
