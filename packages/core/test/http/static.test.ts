import { afterAll, expect, spyOn, test } from "bun:test";
import { mkdirSync, mkdtempSync, rmSync, symlinkSync, utimesSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { serveStatic } from "../../src/http/static.ts";

const root = resolve(import.meta.dir, "fixtures/static");
const opts = { index: "index.html", maxAge: 60 };

test("serves a file inside root", async () => {
  const res = await serveStatic(root, "hello.txt", opts);
  expect(res.status).toBe(200);
  expect(await res.text()).toBe("hello world\n");
});

test("serves index when path is empty", async () => {
  const res = await serveStatic(root, "", opts);
  expect(res.status).toBe(200);
  expect(await res.text()).toContain("<h1>Index</h1>");
});

test("dotfiles are denied by default (403), even when the file exists", async () => {
  const res = await serveStatic(root, ".env", opts);
  expect(res.status).toBe(403);
});

test("dotfile segments nested in the path are denied", async () => {
  const res = await serveStatic(root, ".git/config", opts);
  expect(res.status).toBe(403);
});

test("dotfiles: allow serves them", async () => {
  const res = await serveStatic(root, ".env", { ...opts, dotfiles: "allow" });
  expect(res.status).toBe(200);
  expect(await res.text()).toBe("SECRET=1\n");
});

test("blocks path traversal via ..", async () => {
  const res = await serveStatic(root, "../package.json", opts);
  expect(res.status).toBe(403);
});

test("blocks absolute paths", async () => {
  const res = await serveStatic(root, "/etc/passwd", opts);
  expect(res.status).toBe(403);
});

test("missing file returns 404", async () => {
  const res = await serveStatic(root, "nope.txt", opts);
  expect(res.status).toBe(404);
});

test("null byte in the decoded path is rejected (400), not a 500", async () => {
  const res = await serveStatic(root, "ok%00.txt", opts);
  expect(res.status).toBe(400);
});

test("a path continuing past an existing file is a 404, not a 500", async () => {
  const res = await serveStatic(root, "hello.txt/x", opts);
  expect(res.status).toBe(404);
});

test("emits a weak ETag and honors If-None-Match", async () => {
  const first = await serveStatic(root, "hello.txt", opts);
  const etag = first.headers.get("etag");
  expect(etag).toMatch(/^W\//);

  const cached = await serveStatic(
    root,
    "hello.txt",
    opts,
    new Headers({ "if-none-match": etag ?? "" }),
  );
  expect(cached.status).toBe(304);

  const amongMany = await serveStatic(
    root,
    "hello.txt",
    opts,
    new Headers({ "if-none-match": `"other", ${etag}` }),
  );
  expect(amongMany.status).toBe(304);
});

test("If-None-Match weakly compares strong and weak tags in lists", async () => {
  const first = await serveStatic(root, "hello.txt", opts);
  const etag = first.headers.get("etag")!;
  const strong = etag.slice(2);
  for (const value of [strong, etag, `"other", ${strong}`, `W/"other", ${etag}`, "*"]) {
    const res = await serveStatic(root, "hello.txt", opts, new Headers({ "if-none-match": value }));
    expect(res.status).toBe(304);
    expect(res.headers.get("etag")).toBe(etag);
    expect(await res.text()).toBe("");
  }
  const mismatch = await serveStatic(
    root,
    "hello.txt",
    opts,
    new Headers({ "if-none-match": 'W/"different", "other"' }),
  );
  expect(mismatch.status).toBe(200);
  expect(await mismatch.text()).toBe("hello world\n");
});

test("serves a single byte range", async () => {
  const res = await serveStatic(root, "hello.txt", opts, new Headers({ range: "bytes=0-4" }));
  expect(res.status).toBe(206);
  expect(res.headers.get("content-range")).toMatch(/^bytes 0-4\//);
  expect(await res.text()).toBe("hello");
});

test("If-Range mismatches and weak validators ignore valid and unsatisfiable ranges", async () => {
  const first = await serveStatic(root, "hello.txt", opts);
  const etag = first.headers.get("etag")!;
  for (const condition of ['"stale"', etag, etag.slice(2), "not-a-date", "*"]) {
    for (const range of ["bytes=0-1", "bytes=999-1000"]) {
      const res = await serveStatic(
        root,
        "hello.txt",
        opts,
        new Headers({ range, "if-range": condition }),
      );
      expect(res.status).toBe(200);
      expect(res.headers.get("content-range")).toBeNull();
      expect(res.headers.get("content-length")).toBe("12");
      expect(await res.text()).toBe("hello world\n");
    }
  }
});

test("If-Range accepts only an exact, sufficiently old HTTP date", async () => {
  const dir = mkdtempSync(join(tmpdir(), "zebra-static-if-range-"));
  const modified = new Date("Sat, 01 Jan 2000 00:00:00 GMT");
  const clock = spyOn(Date, "now").mockReturnValue(modified.getTime() + 60_000);
  try {
    const path = join(dir, "file.txt");
    writeFileSync(path, "abcdef");
    utimesSync(path, modified, modified);
    const noCache = { ...opts, cacheTtl: 0 };
    const first = await serveStatic(dir, "file.txt", noCache);
    expect(first.headers.get("last-modified")).toBe(modified.toUTCString());

    for (const condition of [
      modified.toUTCString(),
      "Saturday, 01-Jan-00 00:00:00 GMT",
      "Sat Jan  1 00:00:00 2000",
    ]) {
      const res = await serveStatic(
        dir,
        "file.txt",
        noCache,
        new Headers({ range: "bytes=0-1", "if-range": condition }),
      );
      expect(res.status).toBe(206);
      expect(res.headers.get("content-range")).toBe("bytes 0-1/6");
      expect(res.headers.get("content-length")).toBe("2");
      expect(await res.text()).toBe("ab");
    }

    for (const condition of [
      "Fri, 31 Dec 1999 23:59:59 GMT",
      "Sat, 01 Jan 2000 00:00:01 GMT",
      "Sat, 01 Jan 2100 00:00:00 GMT",
      modified.toISOString(),
      "Fri, 01 Jan 2000 00:00:00 GMT",
      "Sat, 32 Dec 1999 00:00:00 GMT",
    ]) {
      const res = await serveStatic(
        dir,
        "file.txt",
        noCache,
        new Headers({ range: "bytes=0-1", "if-range": condition }),
      );
      expect(res.status).toBe(200);
      expect(res.headers.get("content-range")).toBeNull();
      expect(await res.text()).toBe("abcdef");
    }

    clock.mockReturnValue(modified.getTime() + 59_999);
    const recent = await serveStatic(
      dir,
      "file.txt",
      noCache,
      new Headers({ range: "bytes=0-1", "if-range": modified.toUTCString() }),
    );
    expect(recent.status).toBe(200);
    expect(await recent.text()).toBe("abcdef");
  } finally {
    clock.mockRestore();
    rmSync(dir, { recursive: true, force: true });
  }
});

test("If-Range without Range has no effect and If-None-Match takes precedence", async () => {
  const initial = await serveStatic(root, "hello.txt", opts);
  const ordinary = await serveStatic(
    root,
    "hello.txt",
    opts,
    new Headers({ "if-range": '"stale"' }),
  );
  expect(ordinary.status).toBe(200);
  const conditional = await serveStatic(
    root,
    "hello.txt",
    opts,
    new Headers({
      range: "bytes=0-1",
      "if-range": '"stale"',
      "if-none-match": initial.headers.get("etag")!,
    }),
  );
  expect(conditional.status).toBe(304);
  expect(conditional.headers.get("content-range")).toBeNull();
});

test("a multi-range request is answered with the full 200, not a 416", async () => {
  const res = await serveStatic(root, "hello.txt", opts, new Headers({ range: "bytes=0-1,4-5" }));
  expect(res.status).toBe(200);
  expect(await res.text()).toBe("hello world\n");
});

test("If-Modified-Since after the mtime yields 304", async () => {
  const res = await serveStatic(
    root,
    "hello.txt",
    opts,
    new Headers({ "if-modified-since": "Wed, 31 Dec 2099 23:59:59 GMT" }),
  );
  expect(res.status).toBe(304);
});

test("If-Modified-Since before the mtime yields 200", async () => {
  const res = await serveStatic(
    root,
    "hello.txt",
    opts,
    new Headers({ "if-modified-since": "Thu, 01 Jan 1970 00:00:00 GMT" }),
  );
  expect(res.status).toBe(200);
});

test("If-Modified-Since is ignored when If-None-Match is present", async () => {
  const res = await serveStatic(
    root,
    "hello.txt",
    opts,
    new Headers({
      "if-none-match": '"stale-etag"',
      "if-modified-since": "Wed, 31 Dec 2099 23:59:59 GMT",
    }),
  );
  // INM does not match and IMS must be ignored (RFC 9110 §13.1.3) → 200.
  expect(res.status).toBe(200);
});

test("returns 416 for an unsatisfiable range", async () => {
  const res = await serveStatic(root, "hello.txt", opts, new Headers({ range: "bytes=999-1000" }));
  expect(res.status).toBe(416);
  expect(res.headers.get("content-range")).toMatch(/^bytes \*\//);
});

// --- metadata cache ---------------------------------------------------------
//
// Hot-path hits serve from a bounded metadata cache (default TTL 1000ms):
// headers (etag / content-length / last-modified) come from the cached stat,
// the body is always streamed from the live file. A file replaced within the
// TTL window may be served with stale metadata for at most `cacheTtl` ms —
// that trade-off is exercised in the TTL test below.

test("repeated requests hit the cache with identical headers and correct bodies", async () => {
  const first = await serveStatic(root, "hello.txt", opts);
  const etag = first.headers.get("etag");

  const again = await serveStatic(root, "hello.txt", opts);
  expect(again.status).toBe(200);
  expect(again.headers.get("etag")).toBe(etag);
  expect(await again.text()).toBe("hello world\n");

  const ranged = await serveStatic(root, "hello.txt", opts, new Headers({ range: "bytes=0-4" }));
  expect(ranged.status).toBe(206);
  expect(await ranged.text()).toBe("hello");

  const notModified = await serveStatic(
    root,
    "hello.txt",
    opts,
    new Headers({ "if-none-match": etag ?? "" }),
  );
  expect(notModified.status).toBe(304);
});

test("directory cache entries distinguish index options in both request orders", async () => {
  const fixturesRoot = resolve(root, "..");
  for (const index of ["index.html", "hello.txt", "hello.txt", "index.html"]) {
    const configured = { ...opts, index };
    const cold = await serveStatic(fixturesRoot, "static", { ...configured, cacheTtl: 0 });
    const warm = await serveStatic(fixturesRoot, "static", configured);
    const repeated = await serveStatic(fixturesRoot, "static", configured);
    const expected = index === "index.html" ? "<h1>Index</h1>\n" : "hello world\n";
    const mime = index === "index.html" ? "text/html" : "text/plain";
    for (const res of [cold, warm, repeated]) {
      expect(res.status).toBe(200);
      expect(res.headers.get("content-type")).toContain(mime);
      expect(await res.text()).toBe(expected);
    }
  }
});

test("cache TTL: stale metadata within TTL, refreshed after expiry", async () => {
  const dir = mkdtempSync(join(tmpdir(), "zebra-static-ttl-"));
  try {
    const file = join(dir, "f.txt");
    writeFileSync(file, "one");
    const o = { index: "index.html", maxAge: 60, cacheTtl: 50 };

    const first = await serveStatic(dir, "f.txt", o);
    const etag1 = first.headers.get("etag");
    expect(await first.text()).toBe("one");

    await Bun.sleep(10);
    writeFileSync(file, "two-three");
    // Within the TTL window the cached metadata is served (documented trade-off).
    const stale = await serveStatic(dir, "f.txt", o);
    expect(stale.headers.get("etag")).toBe(etag1);

    await Bun.sleep(70);
    const fresh = await serveStatic(dir, "f.txt", o);
    expect(fresh.headers.get("etag")).not.toBe(etag1);
    expect(await fresh.text()).toBe("two-three");
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("cacheTtl 0 disables the cache: file changes are served immediately", async () => {
  const dir = mkdtempSync(join(tmpdir(), "zebra-static-nocache-"));
  try {
    const file = join(dir, "f.txt");
    writeFileSync(file, "one");
    const o = { index: "index.html", maxAge: 60, cacheTtl: 0 };

    const first = await serveStatic(dir, "f.txt", o);
    expect(await first.text()).toBe("one");
    const etag1 = first.headers.get("etag");

    writeFileSync(file, "two-three");
    const second = await serveStatic(dir, "f.txt", o);
    expect(second.headers.get("etag")).not.toBe(etag1);
    expect(await second.text()).toBe("two-three");
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("missing files are never cached: a file created after a 404 is served", async () => {
  const dir = mkdtempSync(join(tmpdir(), "zebra-static-miss-"));
  try {
    const o = { index: "index.html", maxAge: 60, cacheTtl: 5000 };
    const missing = await serveStatic(dir, "later.txt", o);
    expect(missing.status).toBe(404);

    writeFileSync(join(dir, "later.txt"), "now here");
    const hit = await serveStatic(dir, "later.txt", o);
    expect(hit.status).toBe(200);
    expect(await hit.text()).toBe("now here");
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

// --- symlink containment ---------------------------------------------------
//
// A symlink inside root pointing outside root must not be served: the lexical
// boundary check (resolve + prefix) cannot see it, so serveStatic resolves
// the realpath of the final target and requires it to stay inside the
// realpath of root. Fixtures are built in a temp dir; symlink creation is
// platform-dependent, so tests skip gracefully when it fails.

const symlinkDir = mkdtempSync(join(tmpdir(), "zebra-static-symlink-"));
const symlinkOutside = join(symlinkDir, "outside.txt");
const symlinkRoot = join(symlinkDir, "root");
let symlinksWork = true;
try {
  writeFileSync(symlinkOutside, "secret");
  mkdirSync(symlinkRoot);
  writeFileSync(join(symlinkRoot, "ok.txt"), "ok");
  symlinkSync(symlinkOutside, join(symlinkRoot, "leak.txt"));
  symlinkSync(join(symlinkRoot, "ok.txt"), join(symlinkRoot, "alias.txt"));
  symlinkSync(symlinkRoot, join(symlinkDir, "root-link"));
} catch {
  symlinksWork = false;
}

afterAll(() => {
  rmSync(symlinkDir, { recursive: true, force: true });
});

test("symlink inside root pointing outside root is rejected (403)", async () => {
  if (!symlinksWork) return;
  const res = await serveStatic(symlinkRoot, "leak.txt", opts);
  expect(res.status).toBe(403);
});

test("symlink inside root pointing inside root is served", async () => {
  if (!symlinksWork) return;
  const res = await serveStatic(symlinkRoot, "alias.txt", opts);
  expect(res.status).toBe(200);
  expect(await res.text()).toBe("ok");
});

test("root that is itself a symlink serves normally", async () => {
  if (!symlinksWork) return;
  const res = await serveStatic(join(symlinkDir, "root-link"), "ok.txt", opts);
  expect(res.status).toBe(200);
  expect(await res.text()).toBe("ok");
});

test("a symlinked directory resolving outside root is rejected (403)", async () => {
  if (!symlinksWork) return;
  const escapeDir = join(symlinkDir, "escape-dir");
  mkdirSync(escapeDir);
  writeFileSync(join(escapeDir, "index.html"), "outside");
  symlinkSync(escapeDir, join(symlinkRoot, "dir-link"));
  const res = await serveStatic(symlinkRoot, "dir-link", opts);
  expect(res.status).toBe(403);
});
