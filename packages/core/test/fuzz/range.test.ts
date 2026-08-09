import { expect, test } from "bun:test";
import { resolve } from "node:path";
import { serveStatic } from "../../src/http/static.ts";
import { int, mulberry32, pick } from "./prng.ts";

// --- range fuzz --------------------------------------------------------------
//
// Random `Range` values (plus occasional valid-style ranges and a matching
// ETag) against the fixed 11-byte fixture `hello.txt\n`:
//   1. status is always one of {200, 206, 304, 416}.
//   2. a 206's content-range is self-consistent: 0 <= start <= end < size and
//      content-length matches the range length.
//   3. a 416 carries `content-range: bytes */<size>`.

const root = resolve(import.meta.dir, "../http/fixtures/static");
const opts = { index: "index.html", maxAge: 60 };
const SIZE = 11; // "hello world\n"

const RANGE_ALPHABET = "bytes=0123456789- ,*abxy";

test("fuzz: Range/If-None-Match handling is self-consistent", async () => {
  const rnd = mulberry32(0x7a4e9);
  const etag = (await serveStatic(root, "hello.txt", opts)).headers.get("etag");
  expect(etag).not.toBeNull();

  for (let i = 0; i < 2500; i++) {
    let value: string;
    const style = int(rnd, 0, 9);
    if (style < 3) {
      // Structured-but-arbitrary ranges: exercises the valid path too.
      const start = int(rnd, 0, 15);
      const end = int(rnd, 0, 20);
      value = pick(rnd, ["bytes=", `bytes=${start}-${end}`, `bytes=${start}-`, `bytes=-${end}`]);
    } else {
      const len = int(rnd, 0, 20);
      let s = "";
      for (let j = 0; j < len; j++) s += pick(rnd, [...RANGE_ALPHABET]);
      value = s;
    }

    const headers = new Headers();
    if (rnd() < 0.15) headers.set("if-none-match", etag ?? "");
    const res = await serveStatic(root, "hello.txt", opts, headers);
    const status = res.status;
    const headerDesc = JSON.stringify(Object.fromEntries(headers.entries()));
    expect(
      [200, 206, 304, 416],
      `seed 0x7a4e9 iter ${i} range ${JSON.stringify(value)} headers ${headerDesc}`,
    ).toContain(status);

    if (status === 206) {
      const cr = res.headers.get("content-range") ?? "";
      const m = /^bytes (\d+)-(\d+)\/(\d+)$/.exec(cr);
      expect(
        m,
        `seed 0x7a4e9 iter ${i} range ${JSON.stringify(value)}: unparseable 206 content-range ${JSON.stringify(cr)}`,
      ).not.toBeNull();
      const [, startText, endText, totalText] = m!;
      const start = Number(startText);
      const end = Number(endText);
      const total = Number(totalText);
      expect(total).toBe(SIZE);
      expect(start).toBeGreaterThanOrEqual(0);
      expect(start).toBeLessThanOrEqual(end);
      expect(end).toBeLessThan(SIZE);
      expect(Number(res.headers.get("content-length"))).toBe(end - start + 1);
    }
    if (status === 416) {
      expect(res.headers.get("content-range")).toBe(`bytes */${SIZE}`);
    }
  }
});
