import { verify } from "./sign.ts";

/**
 * Parses a `Cookie` request header into a map of cookie name -> value.
 * Splits on `;`, splits each pair on the first `=`, trims whitespace, and
 * URL-decodes values (falling back to the raw value on malformed encoding).
 */
export function parseCookies(header: string | null): Record<string, string> {
  const cookies: Record<string, string> = {};
  if (!header) return cookies;
  for (const part of header.split(";")) {
    const eq = part.indexOf("=");
    if (eq === -1) continue;
    const name = part.slice(0, eq).trim();
    if (!name) continue;
    const value = part.slice(eq + 1).trim();
    cookies[name] = safeDecode(value);
  }
  return cookies;
}

function safeDecode(value: string): string {
  try {
    return decodeURIComponent(value);
  } catch {
    return value;
  }
}

export interface CookieSerializeOptions {
  maxAge?: number;
  secure?: boolean;
  httpOnly?: boolean;
  sameSite?: "strict" | "lax" | "none";
  path?: string;
  domain?: string;
}

const SAME_SITE: Record<NonNullable<CookieSerializeOptions["sameSite"]>, string> = {
  strict: "Strict",
  lax: "Lax",
  none: "None",
};

/**
 * Serializes a Set-Cookie attribute string, e.g.
 * `sid=abc; Max-Age=86400; Expires=...; Path=/; HttpOnly; Secure; SameSite=Lax`.
 */
export function serializeCookie(
  name: string,
  value: string,
  options: CookieSerializeOptions = {},
): string {
  let cookie = `${name}=${encodeURIComponent(value)}`;
  if (options.maxAge !== undefined) {
    // RFC 6265 requires a non-negative integer; negative values are clamped
    // so the "delete" semantics stay well-formed (Max-Age=0 + past Expires).
    const maxAge = options.maxAge < 0 ? 0 : options.maxAge;
    cookie += `; Max-Age=${maxAge}`;
    // maxAge 0 means "delete now": the Expires must be in the past (epoch).
    const expires = maxAge <= 0 ? new Date(0) : new Date(Date.now() + maxAge * 1000);
    cookie += `; Expires=${expires.toUTCString()}`;
  }
  if (options.domain !== undefined) cookie += `; Domain=${options.domain}`;
  if (options.path !== undefined) cookie += `; Path=${options.path}`;
  if (options.secure) cookie += "; Secure";
  if (options.httpOnly) cookie += "; HttpOnly";
  if (options.sameSite !== undefined) cookie += `; SameSite=${SAME_SITE[options.sameSite]}`;
  return cookie;
}

/**
 * Convenience: parse the `Cookie` header, look up the named cookie, and
 * verify its HMAC signature. Returns the raw sid, or null when the cookie
 * is missing or fails verification.
 */
export function parseSignedCookie(
  header: string | null,
  name: string,
  secret: string,
): string | null {
  const signed = parseCookies(header)[name];
  if (signed === undefined) return null;
  return verify(signed, secret);
}
