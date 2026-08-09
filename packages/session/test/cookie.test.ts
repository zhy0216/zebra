import { expect, test } from "bun:test";

import { parseCookies, parseSignedCookie, serializeCookie } from "../src/cookie.ts";
import { sign } from "../src/sign.ts";

const SECRET = "top-secret";

test("null or empty header yields empty map", () => {
  expect(parseCookies(null)).toEqual({});
  expect(parseCookies("")).toEqual({});
});

test("parses multiple cookies separated by semicolons", () => {
  expect(parseCookies("a=1; b=2; c=3")).toEqual({ a: "1", b: "2", c: "3" });
});

test("trims whitespace around names and values", () => {
  expect(parseCookies("  a = 1 ; b = 2  ")).toEqual({ a: "1", b: "2" });
});

test("value may contain '=' (split on first equals only)", () => {
  expect(parseCookies("a=1=2=3")).toEqual({ a: "1=2=3" });
  expect(parseCookies("sig=abc.def=ghi")).toEqual({ sig: "abc.def=ghi" });
});

test("segments without '=' are ignored", () => {
  expect(parseCookies("a=1; malformed; b=2")).toEqual({ a: "1", b: "2" });
});

test("empty name is ignored", () => {
  expect(parseCookies("=value")).toEqual({});
});

test("later duplicate name wins", () => {
  expect(parseCookies("a=1; a=2")).toEqual({ a: "2" });
});

test("URL-decodes values", () => {
  expect(parseCookies("name=%E4%BD%A0%E5%A5%BD")).toEqual({ name: "你好" });
  expect(parseCookies("space=a%20b")).toEqual({ space: "a b" });
});

test("malformed percent-encoding falls back to raw value", () => {
  expect(parseCookies("a=%zz")).toEqual({ a: "%zz" });
});

test("serializeCookie defaults to name=value only", () => {
  expect(serializeCookie("sid", "abc")).toBe("sid=abc");
});

test("serializeCookie encodes the value", () => {
  expect(serializeCookie("sid", "a b/=")).toBe("sid=a%20b%2F%3D");
});

test("maxAge emits Max-Age seconds and a valid Expires", () => {
  const before = Date.now();
  const cookie = serializeCookie("sid", "abc", { maxAge: 86400 });
  const after = Date.now();
  expect(cookie).toContain("Max-Age=86400");
  const expires = /Expires=([^;]+)/.exec(cookie)?.[1];
  expect(expires).toBeDefined();
  const at = Date.parse(expires!);
  expect(Number.isNaN(at)).toBe(false);
  expect(at).toBeGreaterThanOrEqual(before + 86400_000 - 1000);
  expect(at).toBeLessThanOrEqual(after + 86400_000 + 1000);
});

test("negative maxAge is clamped to 0 (delete semantics stay well-formed)", () => {
  const cookie = serializeCookie("sid", "abc", { maxAge: -5 });
  expect(cookie).toContain("Max-Age=0");
  expect(cookie).toContain(`Expires=${new Date(0).toUTCString()}`);
  expect(cookie).not.toContain("Max-Age=-5");
});

test("boolean flags and sameSite variants render correctly", () => {
  expect(serializeCookie("sid", "abc", { secure: true, httpOnly: true })).toContain(
    "; Secure; HttpOnly",
  );
  expect(serializeCookie("sid", "abc", { sameSite: "lax" })).toContain("SameSite=Lax");
  expect(serializeCookie("sid", "abc", { sameSite: "strict" })).toContain("SameSite=Strict");
  expect(serializeCookie("sid", "abc", { sameSite: "none" })).toContain("SameSite=None");
});

test("path and domain render correctly", () => {
  expect(serializeCookie("sid", "abc", { path: "/app", domain: "example.com" })).toContain(
    "; Domain=example.com; Path=/app",
  );
});

test("parseSignedCookie roundtrip", () => {
  const signed = sign("sess-123", SECRET);
  expect(parseSignedCookie(`sid=${signed}; other=1`, "sid", SECRET)).toBe("sess-123");
});

test("parseSignedCookie rejects tampered signature", () => {
  const signed = sign("sess-123", SECRET);
  expect(parseSignedCookie(`sid=${signed.slice(0, -1)}x`, "sid", SECRET)).toBeNull();
});

test("parseSignedCookie returns null when cookie is missing", () => {
  expect(parseSignedCookie("other=1", "sid", SECRET)).toBeNull();
  expect(parseSignedCookie(null, "sid", SECRET)).toBeNull();
});
