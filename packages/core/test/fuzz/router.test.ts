import { expect, test } from "bun:test";
import { Router } from "../../src/router/radix.ts";
import { int, mulberry32, pick } from "./prng.ts";

// --- router precedence fuzz ---------------------------------------------------
//
// Random mixes of static / param / wildcard routes, then random queries:
//   1. every match result has a handler and params where every captured value
//      is a non-null string (no undefined param captures).
//   2. static precedence: a request whose path exactly matches a registered
//      static route resolves to THAT route's handler — a param/wildcard route
//      on the same layout may never shadow it.
//   3. random garbage paths never throw.
//
// Generator exclusions (documented): route paths use a fixed segment alphabet
// with param/wildcard names matching `[A-Za-z0-9_]+` (parsePath rejects other
// names); duplicate method+path-layout registrations are skipped (the router
// throws on them by design).

const SEGMENTS = ["a", "b", "users", "posts", "me", "profile", "1", "2", "static", "x", "y"];
const PARAM_NAMES = ["id", "slug", "name", "n"];
const METHODS = ["GET", "POST", "PUT", "DELETE", "PATCH"];
const QUERY_SEGMENTS = ["a", "b", "me", "profile", "1", "users", "zz", "🙂", "%2e%2e", "..", ""];

/** Route path with param names canonicalized, so `/a/:x` and `/a/:y` dedupe. */
function canonical(path: string): string {
  return path.replace(/:[A-Za-z0-9_]+/g, ":p").replace(/\*[A-Za-z0-9_]+/g, "*w");
}

function randomPath(rnd: () => number): string {
  const depth = int(rnd, 1, 4);
  const segments: string[] = [];
  for (let i = 0; i < depth; i++) {
    const kind = int(rnd, 0, 9);
    if (kind < 6) segments.push(pick(rnd, SEGMENTS));
    else if (kind < 9) segments.push(`:${pick(rnd, PARAM_NAMES)}`);
    else segments.push(`*${pick(rnd, ["rest", "all"])}`);
  }
  // parsePath requires a wildcard to be the last segment.
  for (let i = 0; i < segments.length - 1; i++) {
    if (segments[i]!.startsWith("*")) segments[i] = pick(rnd, SEGMENTS);
  }
  return `/${segments.join("/")}`;
}

/** Concretizes a route path into a query that definitely matches it. */
function concretePath(path: string, rnd: () => number): string {
  const parts = path.replace(/^\/+/, "").split("/");
  const out = parts.map((p) => {
    if (p.startsWith(":")) return pick(rnd, QUERY_SEGMENTS);
    if (p.startsWith("*")) {
      const rest: string[] = [];
      for (let i = 0; i < int(rnd, 0, 3); i++) rest.push(pick(rnd, QUERY_SEGMENTS));
      return rest.join("/");
    }
    return p;
  });
  return `/${out.join("/")}`;
}

test("fuzz: router precedence and param capture invariants", async () => {
  const rnd = mulberry32(0x8ab1e);
  const seen = new Set<string>();
  const staticRoutes: Array<{ method: string; path: string; handler: number }> = [];
  const allRoutes: Array<{ method: string; path: string; handler: number; hasParams: boolean }> =
    [];

  for (let i = 0; i < 60; i++) {
    const path = randomPath(rnd);
    const method = pick(rnd, METHODS);
    const key = `${method} ${canonical(path)}`;
    if (seen.has(key)) continue;
    seen.add(key);
    const handler = i;
    allRoutes.push({ method, path, handler, hasParams: path.includes(":") || path.includes("*") });
    if (!path.includes(":") && !path.includes("*")) {
      staticRoutes.push({ method, path, handler });
    }
  }

  const router = new Router<number>();
  for (const route of allRoutes) router.add(route.method, route.path, route.handler);

  // Invariant 2: an exact match of a registered static route must hit that route.
  for (const route of staticRoutes) {
    const match = router.find(route.method, route.path);
    expect(
      match,
      `seed 0x8ab1e static route ${route.method} ${route.path} was shadowed by a param/wildcard route`,
    ).not.toBeNull();
    expect(match!.handler, `seed 0x8ab1e ${route.method} ${route.path}`).toBe(route.handler);
  }

  // Invariant 1: concrete paths for param/wildcard routes yield full captures.
  for (const route of allRoutes) {
    if (!route.hasParams) continue;
    for (let k = 0; k < 3; k++) {
      const query = concretePath(route.path, rnd);
      const match = router.find(route.method, query);
      if (match === null) continue; // shadowed by a static route — fine
      for (const [key, value] of Object.entries(match.params)) {
        expect(
          typeof value,
          `seed 0x8ab1e ${route.method} ${route.path} -> ${query}: param ${key} is ${String(value)}`,
        ).toBe("string");
        expect(key, `seed 0x8ab1e ${route.method} ${route.path} -> ${query}`).not.toBe("");
      }
    }
  }

  // Invariant 3: random garbage queries never throw, and results are well-formed.
  for (let i = 0; i < 3000; i++) {
    const method = pick(rnd, [...METHODS, "OPTIONS", "BREW"]);
    const path = pick(rnd, [
      () => randomPath(rnd),
      () => concretePath("/:p/:p/:p", rnd),
      () => randomGarbage(rnd),
    ])();
    const match = router.find(method, path);
    if (match === null) continue;
    expect(match.handler).toBeTypeOf("number");
    for (const value of Object.values(match.params)) expect(value).toBeTypeOf("string");
  }
});

function randomGarbage(rnd: () => number): string {
  const alphabet = "/abcdefg:.%*?[]{}🙂\\ 0123456789";
  const length = int(rnd, 0, 24);
  let out = "";
  for (let i = 0; i < length; i++) out += pick(rnd, [...alphabet]);
  return out;
}

test("fuzz: method-aware matches and method order agree with a route-list model", () => {
  for (const seed of [0x2a11, 0x2a12, 0x2a13, 0x2a14]) {
    const rnd = mulberry32(seed);
    const router = new Router<number>();
    const routes: Array<{ method: string; parts: string[]; handler: number }> = [];
    const layouts = new Set<string>();
    const paths = ["/", "/a/fixed", "/a/:id", "/a/*rest", "/a//b", "/a/%2F", "/%GG"];
    for (let i = 0; i < 70; i++) paths.push(randomPath(rnd));
    for (const path of paths) {
      const method = pick(rnd, METHODS);
      const key = `${method} ${canonical(path)}`;
      if (layouts.has(key)) continue;
      layouts.add(key);
      const handler = routes.length;
      router.add(method, path, handler);
      routes.push({ method, parts: modelParts(path), handler });
    }
    for (let i = 0; i < 350; i++) {
      const path = pick(rnd, [
        ...paths,
        concretePath(pick(rnd, paths), rnd),
        "/a/a%2Fb",
        "/a/%GG",
        "/a//b",
        "/a/%2F/%zz",
        randomGarbage(rnd),
      ]);
      const query = `${"/".repeat(int(rnd, 0, 3))}${path}${"/".repeat(int(rnd, 0, 3))}`;
      const method = pick(rnd, [...METHODS, "HEAD", "BREW"]);
      const parts = modelParts(query);
      const matches = routes
        .map((route) => ({ ...route, match: modelMatch(route.parts, parts) }))
        .filter((route) => route.match !== null)
        .sort((a, b) => {
          for (let idx = 0; idx < Math.max(a.parts.length, b.parts.length); idx++) {
            const difference = modelPriority(b.parts[idx]) - modelPriority(a.parts[idx]);
            if (difference) return difference;
          }
          return a.handler - b.handler;
        });
      const expected = matches.find((route) => route.method === method);
      const label = `seed ${seed} ${method} ${query}`;
      expect(router.find(method.toLowerCase(), query), label).toEqual(
        expected ? { handler: expected.handler, params: expected.match! } : null,
      );
      const methods = [...new Set(matches.map((route) => route.method))];
      expect(router.allowedMethods(query), label).toEqual(methods.length ? methods : null);
    }
  }
});

function modelParts(path: string): string[] {
  const parts = path.split("/");
  while (parts[0] === "") parts.shift();
  while (parts.at(-1) === "") parts.pop();
  return parts;
}

function modelPriority(part: string | undefined): number {
  if (part === undefined) return 3;
  if (part.startsWith("*")) return 0;
  return part.startsWith(":") ? 1 : 2;
}

function modelMatch(pattern: string[], query: string[]): Record<string, string> | null {
  const params: Record<string, string> = Object.create(null);
  for (let i = 0; i < pattern.length; i++) {
    const segment = pattern[i]!;
    if (segment.startsWith("*")) {
      params[segment.slice(1)] = query.slice(i).join("/");
      return params;
    }
    const value = query[i];
    if (value === undefined) return null;
    if (segment.startsWith(":")) {
      try {
        params[segment.slice(1)] = decodeURIComponent(value);
      } catch {
        params[segment.slice(1)] = value;
      }
    } else if (segment !== value) return null;
  }
  return pattern.length === query.length ? params : null;
}
