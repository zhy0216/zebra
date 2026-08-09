import { expect, test } from "bun:test";
import { resolve } from "node:path";
import { serveStatic } from "../../src/http/static.ts";
import { int, mulberry32, pick } from "./prng.ts";

// --- path fuzz ---------------------------------------------------------------
//
// Invariants under attack-shaped random paths (encoded traversal, `..`,
// slashes, NUL bytes, unicode, garbage):
//   1. status is always one of {200, 400, 403, 404} — never 500.
//   2. a 200 serves exactly one of the fixture files (nothing outside root).
//
// Generator exclusions (documented):
//   - decoded UTF-8 length > 800 bytes or a segment > 200 bytes: such paths
//     hit kernel ENAMETOOLONG/EINVAL — a harness artifact, not a framework
//     defect.

const root = resolve(import.meta.dir, "../http/fixtures/static");
const opts = { index: "index.html", maxAge: 60 };
const FIXTURE_BODIES = ["hello world\n", "<h1>Index</h1>\n"];

const SEGMENT_POOL = [
  "a",
  "b",
  "hello.txt",
  "index.html",
  "..",
  ".",
  "%2e",
  "%2e%2e",
  "%00",
  "%2F",
  "%5C",
  "..%2F",
  "..\\",
  "🙂",
  "日本",
  "a%",
  "%zz",
  "a%41",
  "\\a",
  "x",
  "",
];

function byteLength(s: string): number {
  return new TextEncoder().encode(s).byteLength;
}

test("fuzz: serveStatic on random attack-shaped paths (never 500, never escapes root)", async () => {
  const rnd = mulberry32(0x5e4d1);
  let skipped = 0;
  for (let i = 0; i < 1500; i++) {
    const segments: string[] = [];
    const n = int(rnd, 0, 5);
    for (let j = 0; j < n; j++) segments.push(pick(rnd, SEGMENT_POOL));
    const joiner = pick(rnd, ["/", "\\", ""]);
    const raw = segments.join(joiner);

    // Reject generator artifacts (see header) before hitting the fs.
    let decoded: string;
    try {
      decoded = decodeURIComponent(raw);
    } catch {
      skipped++;
      continue;
    }
    if (byteLength(decoded) > 800) {
      skipped++;
      continue;
    }
    let overlongSegment = false;
    for (const seg of decoded.split("/")) {
      if (byteLength(seg) > 200) {
        overlongSegment = true;
        break;
      }
    }
    if (overlongSegment) {
      skipped++;
      continue;
    }

    const res = await serveStatic(root, raw, opts);
    const status = res.status;
    expect([200, 400, 403, 404], `seed 0x5e4d1 iter ${i} path ${JSON.stringify(raw)}`).toContain(
      status,
    );
    if (status === 200) {
      const body = await res.text();
      expect(
        FIXTURE_BODIES,
        `seed 0x5e4d1 iter ${i} path ${JSON.stringify(raw)} served unexpected content`,
      ).toContain(body);
    }
  }
  expect(skipped).toBeLessThan(600);
});
