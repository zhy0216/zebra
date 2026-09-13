#!/usr/bin/env bun
/**
 * Git install smoke test (`bun run verify:git-install`).
 *
 * Verifies the consumer-facing Git entry points documented in the README: a
 * fresh project installs this repository as a git dependency and imports
 * `@zebra-web/source/core`, `/contract` and `/client` without links, source
 * deep paths or lifecycle builds. The committed HEAD is cloned into a
 * temporary repository, a synthetic git URL is redirected to it with
 * `url.*.insteadOf`, and a real `bun install` runs in the consumer, so runtime
 * dependencies (`reflect-metadata`) must come from the package manifest. Only
 * the committed revision is verified; a dirty working tree is reported.
 *
 * `github:` installs resolve through the GitHub API, which cannot be redirected
 * locally; the equivalent `git+https://` form exercises the same git-clone
 * installation path. The pushed-SHA check against GitHub runs separately.
 */
import { spawnSync } from "node:child_process";
import {
  existsSync,
  lstatSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve, sep } from "node:path";

const ROOT = resolve(import.meta.dir, "..");
const ENTRY_POINTS: Record<string, string> = {
  "./core": "./packages/core/src/index.ts",
  "./contract": "./packages/contract/src/index.ts",
  "./client": "./packages/client/src/index.ts",
  "./mcp": "./packages/mcp/src/index.ts",
  "./schema-zod": "./packages/schema-zod/src/index.ts",
};
const LIFECYCLE_SCRIPTS = ["preinstall", "install", "postinstall", "prepare"];

function readJson(path: string): Record<string, any> {
  return JSON.parse(readFileSync(path, "utf8"));
}

function run(
  cmd: string,
  args: string[],
  cwd: string,
  env: Record<string, string | undefined> = process.env,
): { ok: boolean; stdout: string; stderr: string } {
  const res = spawnSync(cmd, args, { cwd, encoding: "utf8", env });
  const stderr = [res.stderr, res.error?.message, res.signal ? `terminated by ${res.signal}` : ""]
    .filter(Boolean)
    .join("\n");
  return { ok: res.status === 0 && !res.error, stdout: res.stdout ?? "", stderr };
}

function fail(message: string): never {
  throw new Error(message);
}

function main(): void {
  const rootPkg = readJson(join(ROOT, "package.json"));

  // --- public surface must exist before touching the network ------------------

  for (const [subpath, target] of Object.entries(ENTRY_POINTS)) {
    if (rootPkg.exports?.[subpath] !== target) {
      fail(`root package.json exports["${subpath}"] must be "${target}"`);
    }
    if (!existsSync(join(ROOT, target))) {
      fail(`root package.json exports["${subpath}"] points at missing ${target}`);
    }
  }
  if (typeof rootPkg.dependencies?.["reflect-metadata"] !== "string") {
    fail("reflect-metadata must be a root runtime dependency (dependencies, not devDependencies)");
  }
  if (rootPkg.devDependencies?.["reflect-metadata"] !== undefined) {
    fail("reflect-metadata must not remain in devDependencies");
  }
  for (const script of LIFECYCLE_SCRIPTS) {
    if (typeof rootPkg.scripts?.[script] === "string") {
      fail(`root package.json must not rely on a ${script} lifecycle script`);
    }
  }

  const sha = run("git", ["rev-parse", "HEAD"], ROOT).stdout.trim();
  if (!/^[0-9a-f]{40}$/.test(sha)) fail("could not resolve the full HEAD commit SHA");
  const dirty = run("git", ["status", "--porcelain"], ROOT).stdout.trim();
  if (dirty !== "") {
    console.warn(
      "[verify:git-install] warning: working tree is dirty; only committed HEAD is verified",
    );
  }

  const tempBase = mkdtempSync(join(tmpdir(), "zebra-git-install-"));
  try {
    console.log(`[verify:git-install] HEAD ${sha}`);

    // --- temporary remote: committed HEAD only, no node_modules ---------------

    const remote = join(tempBase, "zebra.git");
    const clone = run("git", ["clone", "--no-local", "--quiet", ROOT, remote], tempBase);
    if (!clone.ok) fail(`could not clone committed HEAD into a temp remote:\n${clone.stderr}`);
    if (!run("git", ["cat-file", "-e", `${sha}^{commit}`], remote).ok) {
      fail(`temp remote does not contain HEAD ${sha}`);
    }

    // --- fresh consumer installs the git dependency ---------------------------

    const consumer = join(tempBase, "consumer");
    mkdirSync(consumer);
    const gitUrl = "https://localhost/git/zebra";
    writeFileSync(
      join(consumer, "package.json"),
      JSON.stringify(
        {
          name: "zebra-git-install-smoke",
          private: true,
          type: "module",
          dependencies: { "@zebra-web/source": `git+${gitUrl}#${sha}` },
          devDependencies: { "@types/bun": "^1.4.0" },
        },
        null,
        2,
      ),
    );
    const gitConfig = join(tempBase, "gitconfig");
    writeFileSync(gitConfig, `[url "file://${remote}"]\n\tinsteadOf = ${gitUrl}\n`);

    const install = run("bun", ["install"], consumer, {
      ...process.env,
      GIT_CONFIG_GLOBAL: gitConfig,
    });
    if (!install.ok) fail(`bun install of the git dependency failed:\n${install.stderr}`);

    const installedDir = join(consumer, "node_modules", "@zebra-web", "source");
    if (lstatSync(installedDir).isSymbolicLink()) {
      fail("git dependency was installed as a link to the local checkout");
    }
    const installedPkg = readJson(join(installedDir, "package.json"));
    if (installedPkg.name !== "zebra-monorepo") {
      fail(`installed git dependency is ${installedPkg.name}, expected zebra-monorepo`);
    }
    for (const [subpath, target] of Object.entries(ENTRY_POINTS)) {
      if (installedPkg.exports?.[subpath] !== target) {
        fail(`installed package is missing exports["${subpath}"]`);
      }
    }

    // --- reflect-metadata is a transitive runtime dependency ------------------

    const resolved = Bun.resolveSync(
      "reflect-metadata",
      join(installedDir, "packages", "core", "src"),
    );
    if (!resolved.startsWith(consumer + sep)) {
      fail(`reflect-metadata resolved outside the consumer install: ${resolved}`);
    }
    console.log(`  transitive reflect-metadata: ${resolved.slice(consumer.length + 1)}`);

    // --- runtime imports: core, contract/client round-trip --------------------

    writeFileSync(
      join(consumer, "verify.ts"),
      `import { Container, Zebra } from "@zebra-web/source/core";
import { prefix, zc } from "@zebra-web/source/contract";
import { createClient } from "@zebra-web/source/client";

if (typeof Reflect.getMetadata !== "function") {
  throw new Error("core entry did not load reflect-metadata");
}
const app = new Zebra();
if (typeof app.get !== "function" || typeof app.implement !== "function") {
  throw new Error("core entry is missing the app surface");
}
if (typeof Container !== "function") throw new Error("core entry is missing Container");

const stringOutput = {
  "~standard": {
    version: 1,
    vendor: "verify-git-install",
    validate: (value) =>
      typeof value === "string" ? { value } : { issues: [{ message: "expected string" }] },
  },
};
const router = prefix("/api", { hello: zc.get("/hello/:name").output(stringOutput) });
if (typeof prefix !== "function") throw new Error("contract entry is missing prefix");
const api = createClient(router, {
  baseUrl: "http://local",
  fetch: async (url, init) => {
    if (url !== "http://local/api/hello/world") throw new Error("unexpected url: " + url);
    if (init.method !== "GET") throw new Error("unexpected method: " + init.method);
    return new Response(JSON.stringify("hello world"), {
      headers: { "content-type": "application/json" },
    });
  },
});
const value = await api.hello({ params: { name: "world" } });
if (value !== "hello world") {
  throw new Error("contract round-trip returned " + JSON.stringify(value));
}
console.log("git entry imports + contract round-trip: OK");
`,
    );
    const verify = run("bun", ["verify.ts"], consumer);
    if (!verify.ok) fail(`runtime entry checks failed:\n${verify.stderr}`);
    process.stdout.write(verify.stdout);

    writeFileSync(join(consumer, "mcp-verify.ts"), "import { Zebra, HttpError } from '@zebra-web/source/core';\nimport { zc } from '@zebra-web/source/contract';\nimport { createMcpServer } from '@zebra-web/source/mcp';\nimport { zodSchemaAdapter } from '@zebra-web/source/schema-zod';\nimport { Client } from '@modelcontextprotocol/sdk/client/index.js';\nimport { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';\nimport { LATEST_PROTOCOL_VERSION } from '@modelcontextprotocol/sdk/types.js';\nimport { z } from 'zod';\nimport { strict as assert } from 'node:assert';\nconst contract = {\n  read: zc.get('/value').output(z.object({ value: z.string() })).mcp('read_value', 'Read value', { readOnly: true }),\n  write: zc.post('/value').body(z.object({ value: z.string().min(1) })).output(z.object({ value: z.string() })).mcp('write_value', 'Write value'),\n  internal: zc.get('/internal'),\n};\nlet value = 'initial';\nconst app = new Zebra();\nlet calls = 0;\napp.use(async (req, next) => {\n  calls++;\n  if (req.headers.get('authorization') !== 'Bearer test') throw new HttpError(401, 'unauthorized', 'Authentication required');\n  return next();\n});\napp.implement(contract, {\n  read: async () => value === 'bad-output' ? ({ value: 1 } as any) : ({ value }),\n  write: async req => { value = (await req.body()).value; return { value }; },\n  internal: async () => ({ secret: true }),\n});\nconst mcp = createMcpServer({ app, contract, schema: zodSchemaAdapter(), headers: { authorization: 'Bearer test' } });\nconst client = new Client({ name: 'git-consumer', version: '1.0.0' });\nconst [ct, st] = InMemoryTransport.createLinkedPair();\nawait mcp.connect(st);\nawait client.connect(ct);\ntry {\n  assert.deepEqual((await client.listTools()).tools.map(t => t.name), ['read_value', 'write_value']);\n  assert.deepEqual((await client.callTool({ name: 'read_value' })).structuredContent, { value: 'initial' });\n  assert.deepEqual((await client.callTool({ name: 'write_value', arguments: { body: { value: 'changed' } } })).structuredContent, { value: 'changed' });\n  assert.equal((await client.callTool({ name: 'write_value', arguments: { body: { value: '' } } })).isError, true);\n  await client.callTool({ name: 'write_value', arguments: { body: { value: 'bad-output' } } });\n  assert.equal((await client.callTool({ name: 'read_value' })).isError, true);\n  const denied = createMcpServer({ app, contract, schema: zodSchemaAdapter() });\n  assert.equal((await denied.callTool({ name: 'read_value' })).isError, true);\n  await denied.close();\n  assert.ok(calls >= 6);\n  console.log('Native MCP SDK transport discovery/read/write/auth/input/output validation: OK; protocol ' + LATEST_PROTOCOL_VERSION);\n} finally { await client.close(); await mcp.close(); }\n");
    const mcpVerify = run("bun", ["mcp-verify.ts"], consumer);
    if (!mcpVerify.ok) fail(`MCP consumer checks failed:\n${mcpVerify.stderr}`);
    process.stdout.write(mcpVerify.stdout);
    const typecheck = run(join(ROOT, "node_modules", ".bin", "tsgo"), ["--noEmit", "--target", "ESNext", "--module", "ESNext", "--moduleResolution", "bundler", "--allowImportingTsExtensions", "--skipLibCheck", "--lib", "ESNext", "--types", "bun", "mcp-verify.ts"], consumer);
    if (!typecheck.ok) fail(`MCP consumer typecheck failed:\n${typecheck.stdout}\n${typecheck.stderr}`);

    // --- contract/client stay browser-safe (no core / reflect-metadata) -------

    const browserEntries: Record<string, string> = {
      contract: `import { zc } from "@zebra-web/source/contract";\nif (typeof zc.get !== "function") throw new Error("zc missing");\n`,
      client: `import { createClient } from "@zebra-web/source/client";\nimport { zc } from "@zebra-web/source/contract";\nif (typeof createClient !== "function" || typeof zc.get !== "function") throw new Error("client surface missing");\n`,
    };
    const forbidden = ["Bun.serve", "Reflect.defineMetadata", "bun:sqlite", "McpError", "createMcpServer"];
    for (const [name, source] of Object.entries(browserEntries)) {
      const entryFile = join(consumer, `browser-${name}.ts`);
      const outDir = join(consumer, "browser-bundles", name);
      writeFileSync(entryFile, source);
      const build = run(
        "bun",
        ["build", entryFile, "--target", "browser", "--outdir", outDir],
        consumer,
      );
      if (!build.ok) fail(`${name} browser build failed:\n${build.stderr}`);
      const files = readdirSync(outDir).filter((file) => file.endsWith(".js"));
      if (files.length === 0) fail(`${name} browser build emitted no JS`);
      const bundle = files.map((file) => readFileSync(join(outDir, file), "utf8")).join("\n");
      for (const marker of forbidden) {
        if (bundle.includes(marker)) {
          fail(`${name} browser bundle contains server-only marker "${marker}"`);
        }
      }
      console.log(`  browser bundle ${name}: no core/Bun server references`);
    }

    console.log("[verify:git-install] git dependency install + all five entry points verified");
  } finally {
    try {
      rmSync(tempBase, { recursive: true, force: true });
    } catch (error) {
      console.error(
        `error: could not clean ${tempBase}: ${error instanceof Error ? error.message : String(error)}`,
      );
      process.exitCode = 1;
    }
  }
}

if (import.meta.main) {
  try {
    main();
  } catch (error) {
    console.error(`error: ${error instanceof Error ? error.message : String(error)}`);
    process.exitCode = 1;
  }
}
