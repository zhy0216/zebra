import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import vm from "node:vm";

// Verification harness only: emitted package modules receive Web globals, no Bun/Node globals.
const context = vm.createContext({
  URL,
  URLSearchParams,
  Headers,
  Request,
  Response,
  FormData,
  Blob,
  AbortController,
  TextEncoder,
  TextDecoder,
});
const modules = {};
for (const name of ["client", "contract"]) {
  const path = join(process.argv[2], `${name}.mjs`);
  const source = readFileSync(path, "utf8");
  assert.doesNotMatch(source, /\bBun\b|["'](?:bun|node):|\b(?:require|process|Buffer)\b/);
  const module = new vm.SourceTextModule(source, { context, identifier: path });
  await module.link((specifier) => {
    throw new Error(`Unexpected external import: ${specifier}`);
  });
  await module.evaluate();
  modules[name] = module.namespace;
  console.log(
    JSON.stringify({
      package: name,
      bytes: Buffer.byteLength(source),
      sha256: createHash("sha256").update(source).digest("hex"),
      exports: Object.keys(module.namespace),
      externalImports: 0,
      forbiddenRuntimeReferences: 0,
    }),
  );
}
const router = modules.contract.prefix("/api", { item: modules.contract.zc.get("/items/:id") });
const client = modules.client.createClient(router, {
  baseUrl: "https://browser.invalid",
  fetch: async (url, init) => {
    assert.equal(url, "https://browser.invalid/api/items/a%20b");
    assert.equal(init.method, "GET");
    return new Response('{"id":"a b"}', { headers: { "content-type": "application/json" } });
  },
});
assert.equal((await client.item({ params: { id: "a b" } })).id, "a b");
assert.equal(
  vm.runInContext("typeof Bun + ':' + typeof process + ':' + typeof Buffer", context),
  "undefined:undefined:undefined",
);
console.log(
  `Browser target bundles: Web-only VM import and client/contract call passed; host ${process.version}`,
);
