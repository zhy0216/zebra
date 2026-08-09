import { createHmac, timingSafeEqual } from "node:crypto";

const encoder = new TextEncoder();

function requireSecret(secret: string): void {
  if (!secret) {
    throw new Error("sign: secret is required");
  }
}

function hmac(value: string, secret: string): string {
  return createHmac("sha256", secret).update(value).digest("base64url");
}

/**
 * Signs a session id as `sid.hmac` (HMAC-SHA256 over the sid, keyed by `secret`).
 */
export function sign(value: string, secret: string): string {
  requireSecret(secret);
  return `${value}.${hmac(value, secret)}`;
}

/**
 * Verifies a `sid.hmac` token. Returns the original sid, or null if the
 * signature is missing, malformed, or does not match (constant-time compare).
 */
export function verify(value: string, secret: string): string | null {
  requireSecret(secret);
  const lastDot = value.lastIndexOf(".");
  if (lastDot === -1) return null;
  const sid = value.slice(0, lastDot);
  const sig = value.slice(lastDot + 1);
  if (!sid || !sig) return null;

  const expected = hmac(sid, secret);
  const a = encoder.encode(expected);
  const b = encoder.encode(sig);
  if (a.length !== b.length) return null;
  return timingSafeEqual(a, b) ? sid : null;
}
