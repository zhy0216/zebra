import { expect, test } from "bun:test";
import { mulberry32, randomString } from "../../../core/test/fuzz/prng.ts";
import { parseCookies, parseSignedCookie } from "../../src/cookie.ts";

// --- cookie fuzz --------------------------------------------------------------
//
// Random Cookie header strings:
//   1. parseCookies never throws and always returns an object of strings.
//   2. parseSignedCookie never throws and returns a string or null.

const SECRET = "fuzz-secret";

test("fuzz: parseCookies on random headers never throws and yields only strings", () => {
  const rnd = mulberry32(0xc00c);
  for (let i = 0; i < 3000; i++) {
    const header = randomString(rnd, 200);
    const parsed = parseCookies(header);
    expect(parsed, `seed 0xc00c iter ${i} header ${JSON.stringify(header)}`).toBeTypeOf("object");
    for (const [name, value] of Object.entries(parsed)) {
      expect(name, `seed 0xc00c iter ${i}`).toBeTypeOf("string");
      expect(value, `seed 0xc00c iter ${i} header ${JSON.stringify(header)}`).toBeTypeOf("string");
    }
  }
});

test("fuzz: parseSignedCookie on random headers never throws and returns string|null", () => {
  const rnd = mulberry32(0x51f4);
  for (let i = 0; i < 500; i++) {
    const header = randomString(rnd, 200);
    const result = parseSignedCookie(header, "sid", SECRET);
    expect(
      result === null || typeof result === "string",
      `seed 0x51f4 iter ${i} header ${JSON.stringify(header)}`,
    ).toBe(true);
  }
});
