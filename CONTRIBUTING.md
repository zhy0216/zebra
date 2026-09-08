# Contributing

## Setup

```sh
bun install
```

Requires Bun ≥ 1.4.0 to develop (see [README](README.md#requirements)).
Typechecking uses `tsgo` (the native TypeScript compiler via
`@typescript/native-preview`) rather than `tsc`.

Server packages target Bun directly. Prefer Bun-native APIs when representative
benchmarks show a performance benefit, preserving public behavior and security
properties. Compare on the same machine and Bun version, and keep a reproducible
benchmark for the changed path. Retain negative results and reject a candidate
when compatibility differs or representative regressions reproduce. Local helper
costs and HTTP throughput are separate measurements; see [bench/README.md](bench/README.md).

Keep `node:fs` / `node:path` where static metadata, path boundaries and realpath
checks require them, and retain `node:crypto.timingSafeEqual` for session signature
comparison. The existing session HMAC implementation uses `Bun.CryptoHasher`;
the JSON response and bounded body-merge candidates were evaluated but not adopted.
Both client and contract packages must remain browser-safe, without Bun runtime
references. These choices preserve the [API freeze](docs/api-freeze.md).

## Before a PR

All of these must pass from the repo root:

```sh
bun run typecheck   # tsgo: package src/tests, examples, scripts, and benchmarks
bun run lint        # biome check .
bun run build       # dist/ bundles for every package
bun run test        # bun test (includes the fuzz/property suites)
bun run verify:packages  # tarball smoke test (pack + install + import + tsgo)
```

`bun run format` reformats the tree with biome.

## Style

- Formatting and linting are enforced by [Biome](https://biomejs.dev/)
  (`biome.json` at the root): 2-space indent, double quotes, semicolons.
- Strict TypeScript: `noUncheckedIndexedAccess`, `exactOptionalPropertyTypes`.
  Imports use explicit `.ts` extensions; type-only imports use `import type`.
- No comments unless they explain *why* (the codebase documents invariants
  and frozen-behavior notes inline).

## Tests

- `bun:test` (`import { expect, test } from "bun:test"`), colocated in
  `packages/<pkg>/test/` next to `src/`. Example and tooling tests live in
  `examples/*/test/`, `scripts/test/`, and `bench/test/`.
- Deterministic property/fuzz tests live in `packages/*/test/fuzz/` — they use
  a seeded PRNG (mulberry32, see `packages/core/test/fuzz/prng.ts`) so failures
  reproduce; assertion messages carry the seed.
- Keep tests bounded and deterministic; use isolated fixtures for release and
  subprocess failures.

The root typecheck uses `tsconfig.json` with the shared strict settings. It includes
all package sources and tests, example sources/tests/client demos, and scripts and
benchmarks with their tests. Package-local typecheck commands remain available.
CI also runs `bun test --coverage --coverage-reporter=lcov packages/core` followed
by `bun run check:coverage` (90% core source line coverage). Build documentation
changes with `DOCS_BASE=/zebra/ bun run docs:build`. For runtime changes, run the
same install (`bun install --frozen-lockfile`), repository checks, core coverage,
docs build and relevant benchmarks on both the current Bun and the minimum
supported Bun 1.4.0. Prepend an isolated minimum-version binary directory to
`PATH` so subprocesses also use it; do not change the global installation,
packageManager, engines or lockfile to perform this check. CI's floating `1.4`
selection does not substitute for a minimum-version run.

Build client and contract entry points with `bun build --target browser` and
check the emitted bundles for Bun runtime references. Run `bun run bench:check`
locally for performance changes. Its Apple Silicon baseline is machine-specific:
record a failed gate in full, compare the original and final sources on the same
machine and Bun version, and keep the existing baseline and thresholds intact
during an evaluation. Serialize performance runs after a sustained quiet window,
record load throughout, and retain but exclude complete interrupted runs using a
rule chosen before inspecting results.

## Commits

Conventional Commits, matching the repo history (and what
`scripts/release.ts` parses for the changelog):

```
feat(core): add request helpers
fix(session): reject tampered cookies
docs(readme): align with v1.0.0
test(rate-limit): cover trustProxy behavior
chore(release): v1.0.0
```

Types: `feat` `fix` `docs` `chore` `test` `refactor` `perf` `build` `ci`
`style` `revert`. Scope is the package or area (e.g. `core`, `session`,
`rate-limit`, `examples`, `docs`). Commits are grouped and categorized into
CHANGELOG.md by `scripts/release.ts` on release.

## Releasing

Lockstep release of all publishable packages via
[`scripts/release.ts`](scripts/release.ts):

```sh
bun run release -- --version X.Y.Z --registry https://registry.npmjs.org  # dry-run
bun run release -- --version X.Y.Z --prepare
bun run release -- --version X.Y.Z --registry https://registry.npmjs.org --publish
```

For the normal GitHub release flow:

1. Run `bun run release -- --version X.Y.Z --prepare`. This bumps every package,
   updates the changelog, commits the release, and creates `vX.Y.Z` without
   publishing to npm.
2. Push the commit and tag: `git push origin master --follow-tags`.
3. Create a GitHub Release for `vX.Y.Z` and click **Publish release**.
4. The `Publish npm packages` workflow runs the checks and publishes all packages
   in dependency order.

The repository must have an Actions secret named `NPM_TOKEN`. Use a granular
npm token with `Read and write` package access for the `@zebra-web` scope and
**Bypass two-factor authentication** enabled. Keep the token in GitHub Secrets,
never in the repository. The dry-run, prepare, and publish modes run typecheck
and tests first unless `--no-verify` is passed. The `--publish` mode remains
available for a fully local release; `--publish-only` is reserved for CI.
