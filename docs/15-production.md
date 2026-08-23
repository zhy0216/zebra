# Deployment & Release

This guide covers production deployment of Zebra, the release/packaging strategy, and performance benchmarks.

## Deployment

### Running

Zebra is Bun-first: run the source directly with Bun in production. **No build step.**

```sh
# Dockerfile (illustrative)
FROM oven/bun:1.4
WORKDIR /app
COPY package.json bun.lock ./
RUN bun install --production
COPY src ./src
EXPOSE 3000
CMD ["bun", "run", "src/main.ts"]
```

### Production recommendations

- **`NODE_ENV=production`**: the benchmark scenarios also run in production mode.
- **Health checks**: mount `@zebra-web/observability`'s `health()` (`/healthz` liveness + `/readyz` readiness) so load balancers get a decision (see [Observability](13-observability.md)).
- **Graceful shutdown**: `SIGTERM` / `SIGINT` trigger `z.stop()` automatically — in-flight requests drain (within `gracePeriod`, default 10s), then the container is disposed and `shutdown` hooks run (see [Lifecycle](06-lifecycle.md)).
- **Request timeout**: `requestTimeout` sets a per-request deadline; a timeout answers 504 `request_timeout` (see [HTTP](05-http.md#request-timeout)).
- **Behind a proxy**: if your reverse proxy **overwrites** `x-forwarded-for`, enable `trustProxy: true` so rate limiting keys on the real client IP (otherwise clients can spoof their own budget). `req.ip` always comes from the socket peer, independent of `trustProxy`.
- **Multi-instance**: in-process `MemoryStore` sessions and rate-limit counters don't share across instances — use `@zebra-web/redis`'s `RedisSessionStore` / `RedisRateLimitStore` for multi-replica deployments (see [Redis](14-redis.md)).
- **Session cookies**: in production use `cookie: { preset: "secure" }` (`HttpOnly` + `SameSite=Lax`).

## Release strategy: src-direct publishing

All packages publish `src` **directly**:

- `main` / `types` / `exports["."]` point at `./src/index.ts`.
- The tarball ships only `src/` (`files: ["src"]`), **no `dist/`**.
- **No build step runs on publish** — consumers get the TypeScript sources, and Bun's native TS support runs them directly (bundler-resolution consumers get the same files).

```sh
bun run build   # produces dist/ (--target bun --packages external) for bundler/edge consumers
# dist/ is NOT part of the published tarball
```

### Lockstep versions

All packages bump versions in lockstep via `scripts/release.ts`:

```sh
bun run release -- --version 1.0.0 --registry https://registry.npmjs.org
bun run release -- --version X.Y.Z --prepare
```

`--prepare` validates SemVer, scans Conventional Commits, bumps every package,
generates the [CHANGELOG](../CHANGELOG.md) section, commits the release, and
creates the `vX.Y.Z` tag without publishing. Push the tag, then publish a GitHub
Release for it; `.github/workflows/publish-npm.yml` runs the checks and publishes
the packages. Add an `NPM_TOKEN` repository secret containing a granular token
with read/write access to the `@zebra-web` scope and 2FA bypass enabled.

### Pre-release smoke test

```sh
bun run verify:packages
```

For every publishable package (anything under `packages/` that isn't `private`):

1. packs it with `bun pm pack`;
2. checks the tarball contents (`src/index.ts` present, no `dist/` leakage, every path referenced by `main`/`types`/`exports` resolves);
3. installs all tarballs into a fresh temp project and verifies each package resolves, imports, and typechecks from the installed tarball.

This guards the src-direct strategy — the tarball ships `src/` only, and the exports map must work from a clean install.

## Performance benchmarks

`bench/` compares Zebra vs Hono vs Elysia on **real HTTP servers** (Bun `Bun.serve` + `fetch` client concurrency, not self-serving counts; response bodies are consistency-checked to prevent fake data).

```sh
bun run bench            # full comparison
bun run bench:check      # regression check (against baseline.json)
```

Scenarios: static / param / wildcard / middleware (5 layers) / json / di / static-file / post-json.

Current zebra results (this machine: macOS arm64 16-core, Bun 1.4.0 — `bun --version` reports `1.4.0` — single-process loopback, 3000ms × 64 concurrency, median of 3 runs, recorded via `BENCH_DURATION_MS=3000 bun run bench/bench-regression.ts --update`):

| scenario | req/s | p95 (ms) |
| --- | ---: | ---: |
| static | 86,364 | 1.21 |
| param | 84,332 | 1.24 |
| wildcard | 82,662 | 1.27 |
| middleware | 78,242 | 1.32 |
| json | 80,250 | 1.31 |
| di | 78,454 | 1.34 |
| static-file | 32,700 | 2.97 |
| post-json | 26,732 | 3.69 |

Cross-framework comparison numbers (Hono / Elysia) and the earlier measurements from the 2026-08-09 zero-cost fast-path work (Bun 1.3.14) are historical reference in [bench/README](../bench/README.md) — re-run `bun run bench` on your current Bun to reproduce.

Key optimization: **the zero-cost fast path** — routes without DI deps and without a session resolver create no Container child scope; middleware dep scanning/wrapping moved to boot-time precompilation. At the time it measured +5–9% overall throughput, p95 down 0.04–0.10ms (biggest win on middleware, +8.6%).

> **Comparability note**: the three frameworks' "5-layer middleware" mechanisms aren't exactly equivalent (zebra composes per request, hono pre-composes the chain, elysia uses a flat `onRequest` hook chain that applies globally). Don't read the middleware row's absolute numbers across frameworks; the relative ordering (zebra < hono < elysia) is meaningful.

Full data and reproduction: [bench/README](../bench/README.md).

## Toolchain

```sh
bun test                 # tests (bun:test)
bun run typecheck        # workspace-wide typecheck
bun run lint             # biome check
bun run format           # biome format --write
bun run build            # dist/ output (not in the tarball)
bun run verify:packages  # tarball smoke test
bun run release -- --version X.Y.Z --registry https://registry.npmjs.org  # dry-run
bun run release -- --version X.Y.Z --prepare                       # prepare + tag
bun run release -- --version X.Y.Z --registry https://registry.npmjs.org --publish
```

## Next steps

- [API freeze & SemVer policy](api-freeze.md)
- [Lifecycle: graceful shutdown details](06-lifecycle.md)
- [Redis: multi-instance storage](14-redis.md)
