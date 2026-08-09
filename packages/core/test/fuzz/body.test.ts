import { expect, test } from "bun:test";
import { parseBody } from "../../src/http/body.ts";
import { HttpError } from "../../src/http/errors.ts";
import { int, mulberry32, pick } from "./prng.ts";

// --- body parser fuzz --------------------------------------------------------
//
// Random byte payloads across json / form / multipart / binary content types
// (plus crafted deep-nesting and boundary cases):
//   1. parseBody never throws a NON-HttpError (400/413 are the only legal
//      failures) and never hangs.
//
// Generator exclusions (documented): payloads are capped at 2 KiB (well under
// the app's 64 KiB test limits) so pathological inputs stay bounded — the
// multipart path buffers through Bun's formData() and a hang would be a
// harness artifact, not a parser defect.

const opts = {
  maxSize: 64 * 1024,
  json: { limit: 64 * 1024 },
  form: { limit: 64 * 1024 },
  multipart: { limit: 64 * 1024, maxFiles: 10, maxFileSize: 64 * 1024 },
};

const CONTENT_TYPES = [
  "application/json",
  "application/json; charset=utf-8",
  "APPLICATION/JSON",
  "application/json;charset=bogus",
  "application/x-www-form-urlencoded",
  "multipart/form-data; boundary=----fuzzBoundary42",
  "multipart/form-data; boundary=----fuzzBoundary43",
  "text/plain",
  "application/octet-stream",
  "application/garbage",
  "",
  "multipart/form-data",
];

function randomBytes(rnd: () => number, maxLen: number): Uint8Array {
  const length = int(rnd, 0, maxLen);
  const bytes = new Uint8Array(length);
  for (let i = 0; i < length; i++) bytes[i] = int(rnd, 0, 255);
  return bytes;
}

function makeRequest(bytes: Uint8Array, contentType: string, rnd: () => number): Request {
  const headers: Record<string, string> = { "content-type": contentType };
  const declared = int(rnd, 0, 9);
  if (declared < 4) headers["content-length"] = String(bytes.byteLength);
  else if (declared < 6) headers["content-length"] = "-1";
  else if (declared < 8) headers["content-length"] = "99999999";
  else headers["content-length"] = "abc";
  return new Request("http://x/upload", { method: "POST", headers, body: bytes });
}

test("fuzz: parseBody never throws a non-HttpError on random payloads", async () => {
  const rnd = mulberry32(0xb0d7);
  for (let i = 0; i < 700; i++) {
    let bytes = randomBytes(rnd, 2048);
    let contentType = pick(rnd, CONTENT_TYPES);
    if (int(rnd, 0, 19) === 0) {
      // A plausible multipart body that exercises checkForm (maxFiles).
      const boundary = "----fuzzBoundary42";
      const field = `--${boundary}\r\nContent-Disposition: form-data; name="a"\r\n\r\nvalue\r\n`;
      const file = `--${boundary}\r\nContent-Disposition: form-data; name="f"; filename="x.bin"\r\nContent-Type: application/octet-stream\r\n\r\n`;
      const tail = `\r\n--${boundary}--\r\n`;
      bytes = new TextEncoder().encode(field + file + "data".repeat(int(rnd, 0, 40)) + tail);
      contentType = `multipart/form-data; boundary=${boundary}`;
    }
    const req = makeRequest(bytes, contentType, rnd);
    try {
      await parseBody(req, opts);
    } catch (error) {
      expect(
        error instanceof HttpError,
        `seed 0xb0d7 iter ${i} ct ${JSON.stringify(contentType)} threw non-HttpError: ${String(error)}`,
      ).toBe(true);
    }
  }
});

test("fuzz: deep JSON nesting and pathological multipart never escape as non-HttpError", async () => {
  const rnd = mulberry32(0x9e51);
  const cases: Array<[Uint8Array, string]> = [
    [new TextEncoder().encode("[".repeat(30_000) + "]".repeat(30_000)), "application/json"],
    [new TextEncoder().encode('{"a":'.repeat(10_000) + "1" + "}".repeat(10_000)), "application/json"],
    [new TextEncoder().encode("%00".repeat(1000)), "application/x-www-form-urlencoded"],
    [randomBytes(rnd, 2048), "multipart/form-data; boundary=----fuzzBoundary42"],
    [randomBytes(rnd, 2048), "multipart/form-data"],
  ];
  for (let i = 0; i < cases.length; i++) {
    const [bytes, contentType] = cases[i]!;
    const req = makeRequest(bytes, contentType, rnd);
    try {
      await parseBody(req, opts);
    } catch (error) {
      expect(error instanceof HttpError, `case ${i} ct ${contentType} threw non-HttpError`).toBe(true);
    }
  }
});
