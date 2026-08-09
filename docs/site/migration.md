# Migration guide

Version history of the v2 rewrite, and what changes when moving between
releases. Current target: **v1.0.0** (API frozen).

| Version | Date | Highlights |
| ------- | ---- | ---------- |
| v0.1 | 2026-05 | v2 rewrite: DI container, radix router, middleware, HTTP, lifecycle, static files, WebSocket (`@zebra/core` + `zebra` facade) |
| v0.2 | 2026-08 | Contract-first: `@zebra/contract` (`zc`), `app.implement`, `@zebra/client`, `@zebra/testing`, `examples/contract-blog` |
| v0.3 | (planned) | OpenAPI export — **slipped, not shipped** in v1.0 |
| v1.0.0 | 2026-08-09 | `@zebra/session`, `@zebra/cors`, `@zebra/rate-limit`; API freeze; lockstep `1.0.0` versions |

## v0.1 → v0.2

**Additive, non-breaking.** New packages were introduced; existing handlers
kept working unchanged:

- `@zebra/contract` — `zc` chainable builder (`params`/`query`/`body`/`output`/
  `status`/`errors`/`meta`), `prefix()`, Standard Schema V1 protocol.
- `@zebra/core` gained `app.implement()` (contract validation + runtime
  checks) and `app.routeTable` (introspection).
- `@zebra/client` — `createClient` derives a type-safe client from a contract.
- `@zebra/testing` — `createTestApp` / `createTestClient` for socket-free tests.
- `zebra` facade unchanged (contract/client/testing were never re-exported).

Nothing you wrote against v0.1 requires changes.

## v0.2 → v1.0.0

Changes to be aware of:

1. **New packages, re-exported by the facade.** `@zebra/session`,
   `@zebra/cors`, and `@zebra/rate-limit` ship at v1.0.0. The `zebra` facade
   now re-exports `@zebra/core` + `@zebra/session` + `@zebra/cors` +
   `@zebra/rate-limit` (aliased). `@zebra/contract`, `@zebra/client`, and
   `@zebra/testing` are intentionally **not** re-exported — import them from
   their own packages.
2. **`MemoryStore` alias on the facade.** `@zebra/rate-limit`'s `MemoryStore`
   collides with `@zebra/session`'s re-export and is aliased on the facade
   (exported as `MemoryStore` alongside; the collision is documented in
   `docs/api-freeze.md` §3 `zebra`). When you need one specifically, import
   it unprefixed from the owning package.
3. **`RequestSessionInternal` removed.** This type was exported by accident
   from `@zebra/session`'s public index and was removed during the C1 freeze
   audit. It is middleware-internal; if you imported it, drop the import —
   it was never part of the documented surface.
4. **Versions, in lockstep.** All packages moved from `0.2.0`/`0.3.0` to
   `1.0.0` together. `VERSION` (exported by `@zebra/core`) now reads `1.0.0`.
5. **OpenAPI did not ship.** The v0.3 plan for OpenAPI export was slipped;
   `app.routeTable` / `RegisteredRoute.contract` remain the introspection
   seam for future exporters.
6. **Behavior hardening.** Router, dispatch, DI, HTTP, and client edge cases
   were hardened during v0.2 development; no documented API shape changed.

## Going forward (v1.x)

The v1 API is frozen — see the [API freeze](../api-freeze.md) for the
stability promise, the exact frozen surface per package, and the SemVer
policy (what requires a major). In short: removals/renames/signature changes
are majors; additions and bug fixes that don't change documented semantics
are minors/patches.
