export type CorsOrigin = string | string[] | RegExp | ((origin: string) => boolean);

/** Default `origin` option value: allow any origin. */
export const DEFAULT_ORIGIN = "*";

/**
 * Whether `origin` is allowed by `config` (or by the default wildcard when
 * `config` is `undefined`).
 *
 * A `null` origin (same-origin or non-browser request) never matches — such
 * requests are not cross-origin and need no CORS handling.
 *
 * `credentials` does not change the verdict: when the config is `*` and
 * credentials are requested, the request is still allowed and the response
 * merely echoes the concrete origin instead of `*`.
 */
export function matchOrigin(
  origin: string | null,
  config: CorsOrigin | undefined,
  _credentials: boolean,
): boolean {
  if (origin === null) return false;
  if (config === undefined || config === DEFAULT_ORIGIN) return true;
  if (typeof config === "string") return config === origin;
  if (Array.isArray(config)) return config.includes(origin);
  if (config instanceof RegExp) {
    // A /g or /y regex carries mutable state (lastIndex) across test() calls,
    // which would make the verdict flip between requests. Reset it first.
    config.lastIndex = 0;
    return config.test(origin);
  }
  return config(origin);
}

/**
 * The value to write into `Access-Control-Allow-Origin`, or `null` when no
 * CORS header should be attached at all (no `Origin` header, or the origin is
 * not allowed).
 *
 * With `credentials: true` the wildcard is forbidden: the request origin is
 * echoed verbatim instead (Vary: Origin is C3's responsibility).
 */
export function resolveAllowOrigin(
  origin: string | null,
  config: CorsOrigin | undefined,
  credentials: boolean,
): string | null {
  if (origin === null) return null;
  if (config === undefined || config === DEFAULT_ORIGIN) {
    return credentials ? origin : DEFAULT_ORIGIN;
  }
  if (!matchOrigin(origin, config, credentials)) return null;
  return origin;
}

/**
 * Alias for `resolveAllowOrigin`, the name the preflight path (C2) imports.
 */
export function reflectOrigin(
  origin: string | null,
  config: CorsOrigin | undefined,
  credentials: boolean,
): string | null {
  return resolveAllowOrigin(origin, config, credentials);
}
