import { expect, test } from "bun:test";
import { createHmac } from "node:crypto";

import { sign, verify } from "../src/sign.ts";

const SECRET = "top-secret";

test.each([
  ["UUID", "8f3a1c9e-2b4d-4a0f-9c6e-1d2b3c4d5e6f", SECRET],
  ["Unicode", "用户.你好.🦓", "密钥🔑"],
  ["embedded NUL", "user\u0000id", "secret\u0000key"],
  ["unpaired surrogates", "user\ud800", "secret\udc00"],
  ["one-byte key", "sid", "a"],
  ["SHA-256 block-size key", "sid", "a".repeat(64)],
  ["key over SHA-256 block size", "sid", "a".repeat(65)],
  ["long key and message", "user.".repeat(1024), "密钥".repeat(1024)],
])("HMAC matches existing node:crypto cookies: %s", (_label, sid, secret) => {
  const legacy = `${sid}.${createHmac("sha256", secret).update(sid).digest("base64url")}`;
  expect(sign(sid, secret)).toBe(legacy);
  expect(verify(legacy, secret)).toBe(sid);
});

test("known HMAC-SHA256 signature stays stable", () => {
  expect(sign("8f3a1c9e-2b4d-4a0f-9c6e-1d2b3c4d5e6f", SECRET)).toBe(
    "8f3a1c9e-2b4d-4a0f-9c6e-1d2b3c4d5e6f.DRu099EZJkqVRwfrjUCL739NPddkSikpz5knJucGgu0",
  );
});

test("interleaved secrets do not share or reuse finalized HMAC state", () => {
  const oldToken = sign("sid", "old-secret");
  const newToken = sign("sid", "new-secret");
  for (let i = 0; i < 3; i++) {
    expect(verify(oldToken, "new-secret")).toBeNull();
    expect(verify(newToken, "old-secret")).toBeNull();
    expect(verify(oldToken, "old-secret")).toBe("sid");
    expect(verify(newToken, "new-secret")).toBe("sid");
    expect(sign("sid", "old-secret")).toBe(oldToken);
    expect(sign("sid", "new-secret")).toBe(newToken);
  }
});

test("roundtrip: verify(sign(sid, secret), secret) returns the sid", () => {
  const sid = "8f3a1c9e-2b4d-4a0f-9c6e-1d2b3c4d5e6f";
  expect(verify(sign(sid, SECRET), SECRET)).toBe(sid);
});

test("sid containing dots survives signing (split on last dot)", () => {
  const sid = "user.123.abc";
  expect(verify(sign(sid, SECRET), SECRET)).toBe(sid);
});

test("output format is sid.hmac and parts differ from the sid", () => {
  const sid = "abc123";
  const signed = sign(sid, SECRET);
  expect(signed.startsWith(`${sid}.`)).toBe(true);
  expect(signed.length).toBeGreaterThan(sid.length);
});

test("different sids produce different signatures", () => {
  expect(sign("a", SECRET)).not.toBe(sign("b", SECRET));
});

test("same input with same secret is deterministic", () => {
  expect(sign("abc", SECRET)).toBe(sign("abc", SECRET));
});

test("tampered sid is rejected", () => {
  const signed = sign("abc123", SECRET);
  const tampered = signed.replace("abc123", "abc124");
  expect(verify(tampered, SECRET)).toBeNull();
});

test("tampered hmac is rejected", () => {
  const signed = sign("abc123", SECRET);
  const flipped = signed.slice(0, -1) + (signed.endsWith("A") ? "B" : "A");
  expect(verify(flipped, SECRET)).toBeNull();
});

test("wrong secret is rejected", () => {
  expect(verify(sign("abc123", SECRET), "other-secret")).toBeNull();
});

test("empty secret throws for sign and verify", () => {
  expect(() => sign("abc123", "")).toThrow();
  expect(() => verify("abc123.xyz", "")).toThrow();
});

test("malformed tokens return null", () => {
  expect(verify("no-dot", SECRET)).toBeNull();
  expect(verify("onlydot.", SECRET)).toBeNull();
  expect(verify(".onlyhmac", SECRET)).toBeNull();
  expect(verify("", SECRET)).toBeNull();
});
