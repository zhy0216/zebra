import { realpathSync, statSync } from "node:fs";
import { resolve, sep } from "node:path";

export interface StaticOptions {
  index: string;
  maxAge: number;
  /**
   * Metadata cache TTL in milliseconds (default 1000; `0` disables the cache).
   * Cached entries carry the file's `etag`, `content-length` and
   * `last-modified` from the last stat: a file replaced within the TTL window
   * may be served with stale metadata (and a stale size header) for at most
   * `cacheTtl` ms — the trade-off for skipping the `statSync` syscall on the
   * hot path. The body is always streamed from the live file.
   */
  cacheTtl?: number;
  /**
   * Dotfile policy for path segments (default `"deny"`): with `"deny"`, any
   * decoded segment starting with `.` (`.env`, `.git/...`) is refused with
   * 403 — serving a project root would otherwise expose its hidden files.
   */
  dotfiles?: "allow" | "deny";
}

/** Cached realpath per root — resolved once at first use (symlink-safe). */
const realRootCache = new Map<string, string>();

function realRoot(root: string): string {
  let real = realRootCache.get(root);
  if (real === undefined) {
    real = realpathSync(resolve(root));
    realRootCache.set(root, real);
  }
  return real;
}

// --- bounded metadata cache -------------------------------------------------
//
// Hot-path requests to the same file skip both `statSync` (twice on directory
// paths) and `realpathSync`. Keys include the root, lexical target and index
// option: the same directory can serve different configured index files.
// Bounded by a max entry count; Map insertion order + re-insert on hit
// approximates LRU eviction.
// Misses (404/403) are never cached, so newly created files appear immediately.

interface FileMeta {
  realTarget: string;
  size: number;
  etag: string;
  modifiedAt: number;
  lastModified: string;
  contentType: string;
  fetchedAt: number;
}

const DEFAULT_CACHE_TTL = 1000;
const MAX_CACHE_ENTRIES = 512;
const metaCache = new Map<string, FileMeta>();

function cacheGet(key: string, ttl: number): FileMeta | undefined {
  const meta = metaCache.get(key);
  if (meta === undefined) return undefined;
  if (Date.now() - meta.fetchedAt >= ttl) {
    metaCache.delete(key);
    return undefined;
  }
  metaCache.delete(key);
  metaCache.set(key, meta);
  return meta;
}

function cacheSet(key: string, meta: FileMeta): void {
  if (metaCache.size >= MAX_CACHE_ENTRIES) {
    const oldest = metaCache.keys().next().value as string | undefined;
    if (oldest !== undefined) metaCache.delete(oldest);
  }
  metaCache.set(key, meta);
}

interface ByteRange {
  start: number;
  end: number;
}

function parseRange(value: string, size: number): ByteRange | null {
  if (size <= 0) return null;
  if (!value.startsWith("bytes=") || value.includes(",")) return null;
  const match = /^bytes=(\d*)-(\d*)$/.exec(value);
  if (!match) return null;

  const [, startText = "", endText = ""] = match;
  if (startText === "" && endText === "") return null;

  if (startText === "") {
    const suffixLength = Number(endText);
    if (!Number.isSafeInteger(suffixLength) || suffixLength <= 0) return null;
    return { start: Math.max(0, size - suffixLength), end: size - 1 };
  }

  const start = Number(startText);
  const requestedEnd = endText === "" ? size - 1 : Number(endText);
  if (
    !Number.isSafeInteger(start) ||
    !Number.isSafeInteger(requestedEnd) ||
    start < 0 ||
    requestedEnd < start ||
    start >= size
  ) {
    return null;
  }
  return { start, end: Math.min(requestedEnd, size - 1) };
}

/** Accept the three HTTP-date formats, rejecting Date.parse's loose inputs. */
function parseHttpDate(value: string): number | undefined {
  let normalized = value.endsWith(" GMT") ? value : `${value} GMT`;
  const rfc850 =
    /^(Sunday|Monday|Tuesday|Wednesday|Thursday|Friday|Saturday), (\d{2})-([A-Z][a-z]{2})-(\d{2}) (\d{2}:\d{2}:\d{2}) GMT$/.exec(
      value,
    );
  if (rfc850 !== null) {
    const [, weekday, day, month, shortYear, time] = rfc850;
    const future = new Date(Date.now());
    let year = Math.floor(future.getUTCFullYear() / 100) * 100 + Number(shortYear);
    future.setUTCFullYear(future.getUTCFullYear() + 50);
    const format = () => `${weekday!.slice(0, 3)}, ${day} ${month} ${year} ${time} GMT`;
    if (Date.parse(format()) > future.getTime()) year -= 100;
    normalized = format();
  }
  const timestamp = Date.parse(normalized);
  if (Number.isNaN(timestamp)) return undefined;
  const canonical = new Date(timestamp).toUTCString();
  if (value === canonical || (rfc850 !== null && normalized === canonical)) return timestamp;

  const [weekday, day, month, year, time] = canonical.split(" ");
  const asctime = `${weekday!.slice(0, 3)} ${month} ${String(Number(day)).padStart(2, " ")} ${time} ${year}`;
  return value === asctime ? timestamp : undefined;
}

function matchesIfRange(value: string, meta: FileMeta): boolean {
  // RFC 9110 §13.1.5 requires strong comparison. Our generated weak ETags
  // cannot authorize a partial response, even with the same opaque value.
  if (value.startsWith('"') || value.startsWith("W/")) {
    return !meta.etag.startsWith("W/") && !value.startsWith("W/") && value === meta.etag;
  }
  const timestamp = parseHttpDate(value);
  // Require an exact date match, not the <= comparison used for IMS.
  // Conservatively accept dates only after a 60-second modification window;
  // recent or future mtimes cannot establish a strong date validator here.
  return (
    timestamp !== undefined &&
    timestamp === Date.parse(meta.lastModified) &&
    Date.now() - meta.modifiedAt >= 60_000
  );
}

/** Builds the full response (304 / 416 / 206 / 200) from cached file metadata. */
function respond(meta: FileMeta, requestHeaders: Headers, maxAge: number): Response {
  const headers = new Headers({
    "content-type": meta.contentType,
    "cache-control": `public, max-age=${maxAge}`,
    "accept-ranges": "bytes",
    etag: meta.etag,
    "last-modified": meta.lastModified,
  });

  const ifNoneMatch = requestHeaders.get("if-none-match");
  if (
    ifNoneMatch
      ?.split(",")
      .map((candidate) => candidate.trim())
      .some(
        (candidate) =>
          candidate === "*" || candidate.replace(/^W\//, "") === meta.etag.replace(/^W\//, ""),
      )
  ) {
    return new Response(null, { status: 304, headers });
  }

  // If-Modified-Since: honored only when If-None-Match is absent
  // (RFC 9110 §13.1.3 — IMS is ignored otherwise).
  if (ifNoneMatch === null) {
    const ifModifiedSince = requestHeaders.get("if-modified-since");
    if (ifModifiedSince !== null) {
      const since = Date.parse(ifModifiedSince);
      if (!Number.isNaN(since) && since >= new Date(meta.lastModified).getTime()) {
        return new Response(null, { status: 304, headers });
      }
    }
  }

  const file = Bun.file(meta.realTarget);
  const requestedRange = requestHeaders.get("range");
  const ifRange = requestHeaders.get("if-range");
  // Multi-range requests (bytes=a-b,c-d) are answered with the full 200
  // instead of a 416: RFC 9110 §14.2 allows ignoring a Range header, and a
  // satisfiable multi-range must never be reported unsatisfiable.
  if (
    requestedRange !== null &&
    !requestedRange.includes(",") &&
    (ifRange === null || matchesIfRange(ifRange, meta))
  ) {
    const range = parseRange(requestedRange, meta.size);
    if (!range) {
      headers.set("content-range", `bytes */${meta.size}`);
      return new Response(null, { status: 416, headers });
    }
    const length = range.end - range.start + 1;
    headers.set("content-range", `bytes ${range.start}-${range.end}/${meta.size}`);
    headers.set("content-length", String(length));
    return new Response(file.slice(range.start, range.end + 1), {
      status: 206,
      headers,
    });
  }

  headers.set("content-length", String(meta.size));

  return new Response(file, {
    status: 200,
    headers,
  });
}

export async function serveStatic(
  root: string,
  requested: string,
  opts: StaticOptions,
  requestHeaders: Headers = new Headers(),
): Promise<Response> {
  let decoded: string;
  try {
    decoded = decodeURIComponent(requested);
  } catch {
    return new Response("Bad Request", { status: 400 });
  }
  const target = decoded === "" ? opts.index : decoded;

  if (target.startsWith("/") || target.startsWith("\\")) {
    return new Response("Forbidden", { status: 403 });
  }
  // A decoded NUL byte is never a valid file name and makes fs calls throw.
  if (target.includes("\0")) {
    return new Response("Bad Request", { status: 400 });
  }
  // Dotfile policy: refuse hidden files/directories (`.env`, `.git/...`)
  // unless explicitly allowed — see StaticOptions.dotfiles.
  if (opts.dotfiles !== "allow") {
    for (const segment of target.split("/")) {
      if (segment.startsWith(".")) {
        return new Response("Forbidden", { status: 403 });
      }
    }
  }

  const absRoot = resolve(root);
  const absTarget = resolve(absRoot, target);
  const boundary = absRoot === sep ? absRoot : absRoot + sep;
  if (!absTarget.startsWith(boundary) && absTarget !== absRoot) {
    return new Response("Forbidden", { status: 403 });
  }

  const ttl = opts.cacheTtl ?? DEFAULT_CACHE_TTL;
  const cacheKey = JSON.stringify([absRoot, absTarget, opts.index]);
  if (ttl > 0) {
    const cached = cacheGet(cacheKey, ttl);
    if (cached !== undefined) {
      return respond(cached, requestHeaders, opts.maxAge);
    }
  }

  let stat: ReturnType<typeof statSync> | undefined;
  try {
    stat = statSync(absTarget, { throwIfNoEntry: false });
  } catch {
    // ENOTDIR (a path component is a file, e.g. `hello.txt/x`) — the
    // requested resource does not exist as a file.
    return new Response("Not Found", { status: 404 });
  }
  if (!stat) {
    return new Response("Not Found", { status: 404 });
  }
  let final = absTarget;
  if (stat.isDirectory()) {
    final = resolve(absTarget, opts.index);
    if (!final.startsWith(boundary) && final !== absRoot) {
      return new Response("Forbidden", { status: 403 });
    }
    try {
      stat = statSync(final, { throwIfNoEntry: false });
    } catch {
      return new Response("Not Found", { status: 404 });
    }
    if (!stat) {
      return new Response("Not Found", { status: 404 });
    }
  }

  // Symlink containment: the lexical boundary check cannot see a symlink
  // inside root pointing outside it. Resolve the final target and require its
  // realpath to stay inside the realpath of root (which itself may be a
  // symlink). The real target is served, closing the symlink check/use race
  // (a concurrent directory-component swap inside root is the accepted
  // residual race, same as serve-static/nginx).
  let realTarget: string;
  try {
    realTarget = realpathSync(final);
  } catch {
    return new Response("Not Found", { status: 404 });
  }
  const realBoundary = realRoot(root);
  const realBoundaryWithSep = realBoundary === sep ? realBoundary : realBoundary + sep;
  if (!realTarget.startsWith(realBoundaryWithSep) && realTarget !== realBoundary) {
    return new Response("Forbidden", { status: 403 });
  }

  const file = Bun.file(realTarget);
  const modifiedAt = file.lastModified;
  const meta: FileMeta = {
    realTarget,
    size: file.size,
    etag: `W/"${modifiedAt}-${file.size}"`,
    modifiedAt,
    lastModified: new Date(modifiedAt).toUTCString(),
    contentType: file.type || "application/octet-stream",
    fetchedAt: Date.now(),
  };
  if (ttl > 0) cacheSet(cacheKey, meta);
  return respond(meta, requestHeaders, opts.maxAge);
}
