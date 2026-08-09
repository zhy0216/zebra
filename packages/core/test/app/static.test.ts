import "reflect-metadata";
import { expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { Zebra } from "../../src/app/app.ts";
import { Container } from "../../src/di/container.ts";

const fixtures = resolve(import.meta.dir, "fixtures/public");

test("app.static serves a file", async () => {
  const app = new Zebra({ container: new Container() });
  app.static("/assets", fixtures, { index: "index.html", maxAge: 60 });

  const res = await app.dispatch(new Request("http://x/assets/hello.txt"));
  expect(res.status).toBe(200);
  expect(await res.text()).toBe("static hello\n");
});

test("app.static blocks traversal", async () => {
  const app = new Zebra({ container: new Container() });
  app.static("/assets", fixtures, { index: "index.html", maxAge: 60 });
  const res = await app.dispatch(new Request("http://x/assets/..%2Fpackage.json"));
  expect(res.status).toBe(403);
});

test("app.static serves the configured index at the mount path", async () => {
  const app = new Zebra({ container: new Container() });
  app.static("/assets", fixtures, { index: "hello.txt" });
  const res = await app.dispatch(new Request("http://x/assets"));
  expect(res.status).toBe(200);
  expect(await res.text()).toBe("static hello\n");
});

test("app.static rejects a symlink inside root pointing outside root (403)", async () => {
  const dir = mkdtempSync(join(tmpdir(), "zebra-app-static-"));
  try {
    const outside = join(dir, "secret.txt");
    writeFileSync(outside, "secret");
    const publicRoot = join(dir, "public");
    mkdirSync(publicRoot);
    writeFileSync(join(publicRoot, "ok.txt"), "ok");
    symlinkSync(outside, join(publicRoot, "leak.txt"));

    const app = new Zebra({ container: new Container() });
    app.static("/assets", publicRoot, { index: "index.html", maxAge: 60 });
    const leak = await app.dispatch(new Request("http://x/assets/leak.txt"));
    expect(leak.status).toBe(403);
    const ok = await app.dispatch(new Request("http://x/assets/ok.txt"));
    expect(ok.status).toBe(200);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
