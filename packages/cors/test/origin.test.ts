import { expect, test } from "bun:test";

import {
  DEFAULT_ORIGIN,
  matchOrigin,
  reflectOrigin,
  resolveAllowOrigin,
} from "../src/origin.ts";

test("string config matches exactly", () => {
  expect(matchOrigin("https://example.com", "https://example.com", false)).toBe(true);
  expect(matchOrigin("https://example.com", "https://example.com", true)).toBe(true);
  expect(matchOrigin("https://other.com", "https://example.com", false)).toBe(false);
  expect(matchOrigin("https://example.com.evil.com", "https://example.com", false)).toBe(false);
});

test("string[] config matches on membership", () => {
  const config = ["https://a.com", "https://b.com"];
  expect(matchOrigin("https://a.com", config, false)).toBe(true);
  expect(matchOrigin("https://b.com", config, false)).toBe(true);
  expect(matchOrigin("https://c.com", config, false)).toBe(false);
});

test("RegExp config tests the origin", () => {
  expect(matchOrigin("https://app.example.com", /^https:\/\/.+\.example\.com$/, false)).toBe(true);
  expect(matchOrigin("https://example.com", /^https:\/\/.+\.example\.com$/, false)).toBe(false);
});

test("global-flag RegExp config does not flip verdicts across calls (lastIndex reset)", () => {
  const re = /^https:\/\/.+\.example\.com$/g;
  expect(matchOrigin("https://app.example.com", re, false)).toBe(true);
  expect(matchOrigin("https://example.org", re, false)).toBe(false);
  expect(matchOrigin("https://api.example.com", re, false)).toBe(true);
  expect(matchOrigin("https://example.org", re, false)).toBe(false);
});

test("function config is used as predicate", () => {
  const allowSubdomains = (origin: string) => origin.endsWith(".example.com");
  expect(matchOrigin("https://api.example.com", allowSubdomains, false)).toBe(true);
  expect(matchOrigin("https://example.org", allowSubdomains, false)).toBe(false);
});

test("undefined or '*' config matches any origin", () => {
  expect(matchOrigin("https://anything.dev", undefined, false)).toBe(true);
  expect(matchOrigin("https://anything.dev", DEFAULT_ORIGIN, false)).toBe(true);
  expect(matchOrigin("http://localhost:3000", undefined, true)).toBe(true);
});

test("null origin never matches", () => {
  expect(matchOrigin(null, undefined, false)).toBe(false);
  expect(matchOrigin(null, "https://example.com", false)).toBe(false);
  expect(matchOrigin(null, ["https://example.com"], false)).toBe(false);
});

test("wildcard without credentials resolves to '*'", () => {
  expect(resolveAllowOrigin("https://a.com", undefined, false)).toBe("*");
  expect(resolveAllowOrigin("https://a.com", DEFAULT_ORIGIN, false)).toBe("*");
});

test("wildcard with credentials echoes the request origin", () => {
  expect(resolveAllowOrigin("https://a.com", undefined, true)).toBe("https://a.com");
  expect(resolveAllowOrigin("https://b.com", DEFAULT_ORIGIN, true)).toBe("https://b.com");
});

test("specific config always echoes the matching origin, never '*'", () => {
  expect(resolveAllowOrigin("https://a.com", ["https://a.com", "https://b.com"], false)).toBe(
    "https://a.com",
  );
  expect(resolveAllowOrigin("https://a.com", "https://a.com", true)).toBe("https://a.com");
  expect(resolveAllowOrigin("https://a.com", /^https:\/\/a\.com$/, true)).toBe("https://a.com");
  expect(resolveAllowOrigin("https://a.com", DEFAULT_ORIGIN, true)).toBe("https://a.com");
});

test("disallowed origin resolves to null", () => {
  expect(resolveAllowOrigin("https://nope.com", "https://a.com", false)).toBeNull();
  expect(resolveAllowOrigin("https://nope.com", ["https://a.com"], true)).toBeNull();
  expect(resolveAllowOrigin("https://nope.com", () => false, false)).toBeNull();
});

test("null origin resolves to null (no CORS header injected)", () => {
  expect(resolveAllowOrigin(null, undefined, false)).toBeNull();
  expect(resolveAllowOrigin(null, undefined, true)).toBeNull();
  expect(resolveAllowOrigin(null, "https://a.com", false)).toBeNull();
});

test("reflectOrigin is an alias for resolveAllowOrigin", () => {
  expect(reflectOrigin("https://a.com", undefined, true)).toBe("https://a.com");
  expect(reflectOrigin("https://a.com", undefined, false)).toBe("*");
  expect(reflectOrigin("https://nope.com", ["https://a.com"], false)).toBeNull();
  expect(reflectOrigin(null, undefined, false)).toBeNull();
});
