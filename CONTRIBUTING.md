# Contributing

## Setup

```sh
bun install
```

Requires Bun ≥ 1.1.30 to develop (the test suite needs ≥ 1.3 — see
[README](README.md#requirements)). TypeScript ≥ 5.6.

## Before a PR

All of these must pass from the repo root:

```sh
bun run typecheck   # tsc --noEmit across all workspaces
bun run lint        # biome check .
bun run build       # dist/ bundles for every package
bun run test        # bun test (includes the fuzz/property suites)
bun run verify:packages  # tarball smoke test (pack + install + import + tsc)
```

`bun run format` reformats the tree with biome.

## Style

- Formatting and linting are enforced by [Biome](https://biomejs.dev/)
  (`biome.json` at the root): 2-space indent, double quotes, no semicolons.
- Strict TypeScript: `noUncheckedIndexedAccess`, `exactOptionalPropertyTypes`.
  Imports use explicit `.ts` extensions; type-only imports use `import type`.
- No comments unless they explain *why* (the codebase documents invariants
  and frozen-behavior notes inline).

## Tests

- `bun:test` (`import { expect, test } from "bun:test"`), colocated in
  `packages/<pkg>/test/` next to `src/`.
- Deterministic property/fuzz tests live in `packages/*/test/fuzz/` — they use
  a seeded PRNG (mulberry32, see `packages/core/test/fuzz/prng.ts`) so failures
  reproduce; assertion messages carry the seed.
- Keep tests fast: the fuzz suites are bounded to keep the whole run under a
  few seconds.

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
bun run release -- --version X.Y.Z   # dry-run (verifies typecheck + test)
bun run release -- --version X.Y.Z --publish
```

The script bumps versions, syncs `@zebra/*` dependency specs, writes the
CHANGELOG section from commits since the last semver tag, publishes in
dependency order, and tags `vX.Y.Z`. It runs typecheck + tests first unless
`--no-verify` is passed.
