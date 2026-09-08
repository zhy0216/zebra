import { createHash } from "node:crypto";
import { existsSync, readFileSync, readdirSync, realpathSync } from "node:fs";
import { isAbsolute, join, relative, resolve, sep } from "node:path";
import { pathToFileURL } from "node:url";

export const SOURCE_FILES = {
  core: "packages/core/src/index.ts",
  router: "packages/core/src/router/radix.ts",
} as const;

export function sha256(value: string | Uint8Array): string {
  return createHash("sha256").update(value).digest("hex");
}

function git(root: string, args: string[]): string | null {
  const result = Bun.spawnSync(["git", "-C", root, ...args], { stderr: "pipe" });
  return result.exitCode === 0 ? result.stdout.toString().trim() : null;
}

export function productionFiles(root: string): Record<string, string> {
  const files: Record<string, string> = {};
  const walk = (dir: string) => {
    for (const entry of readdirSync(dir, { withFileTypes: true }).sort((a, b) =>
      a.name.localeCompare(b.name),
    )) {
      const path = join(dir, entry.name);
      if (entry.isDirectory()) walk(path);
      else {
        if (!realpathSync(path).startsWith(`${root}${sep}`)) {
          throw new Error(`Source file escapes --source-root: ${path}`);
        }
        files[relative(root, path)] = sha256(readFileSync(path));
      }
    }
  };
  for (const name of readdirSync(join(root, "packages")).sort()) {
    const src = join(root, "packages", name, "src");
    if (existsSync(src)) walk(src);
  }
  return files;
}

export function sourceIdentity(input: string) {
  if (!isAbsolute(input)) throw new Error("--source-root must be an absolute checkout path");
  if (!existsSync(input)) throw new Error(`Bad --source-root: ${input} does not exist`);
  const root = realpathSync(input);
  const paths = Object.fromEntries(
    Object.entries(SOURCE_FILES).map(([name, path]) => {
      const absolute = join(root, path);
      if (!existsSync(absolute)) throw new Error(`Bad --source-root: missing ${path}`);
      return [name, realpathSync(absolute)];
    }),
  ) as Record<keyof typeof SOURCE_FILES, string>;
  const files = productionFiles(root);
  const productionSha256 = sha256(JSON.stringify(files));
  const isCheckout = git(root, ["rev-parse", "--show-toplevel"]) === root;
  const archivePath = join(root, ".hot-path-source.json");
  const archive = existsSync(archivePath)
    ? (JSON.parse(readFileSync(archivePath, "utf8")) as {
        revision: string;
        files: Record<string, string>;
      })
    : null;
  if (!isCheckout && (!archive?.revision || !archive.files)) {
    throw new Error("Bad --source-root: expected Git checkout or .hot-path-source.json archive");
  }
  const diff = isCheckout
    ? (git(root, ["diff", "--binary", "HEAD", "--", "packages/*/src"]) ?? "")
    : JSON.stringify(
        [...new Set([...Object.keys(files), ...Object.keys(archive!.files)])]
          .sort()
          .filter((file) => files[file] !== archive!.files[file])
          .map((file) => ({ file, before: archive!.files[file], after: files[file] })),
      );
  return {
    root,
    paths,
    kind: isCheckout ? "checkout" : "archive",
    revision: isCheckout ? git(root, ["rev-parse", "HEAD"]) : archive!.revision,
    productionSha256,
    productionFileCount: Object.keys(files).length,
    productionDiff: isCheckout
      ? {
          tracked: git(root, ["diff", "--name-status", "HEAD", "--", "packages/*/src"]),
          untracked: git(root, ["ls-files", "--others", "--exclude-standard", "packages/*/src"]),
          sha256: sha256(diff),
        }
      : { changes: JSON.parse(diff), sha256: sha256(diff) },
    lockSha256: sha256(readFileSync(join(root, "bun.lock"))),
  };
}

export function harnessIdentity() {
  const root = resolve(import.meta.dir, "..");
  const names = [
    ...readdirSync(import.meta.dir)
      .filter((name) => /^hot-path.*\.ts$/.test(name))
      .map((name) => `bench/${name}`),
    "bench/scenarios.ts",
    "bench/fixtures/static/hello.txt",
  ].sort();
  const files = Object.fromEntries(
    names.map((name) => [name, sha256(readFileSync(join(root, name)))]),
  );
  return {
    root,
    revision: git(root, ["rev-parse", "HEAD"]),
    diff: git(root, ["status", "--porcelain", "--", ...names]),
    sha256: sha256(JSON.stringify(files)),
    files,
    lockSha256: sha256(readFileSync(join(root, "bun.lock"))),
  };
}

export async function loadSource(identity: ReturnType<typeof sourceIdentity>) {
  // Runtime imports must stay absolute. Type-only imports below are erased by Bun.
  const core: typeof import("../packages/core/src/index.ts") = await import(
    pathToFileURL(identity.paths.core).href
  );
  const router: typeof import("../packages/core/src/router/radix.ts") = await import(
    pathToFileURL(identity.paths.router).href
  );
  return { ...core, ...router };
}

export type Source = Awaited<ReturnType<typeof loadSource>>;
