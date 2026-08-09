# Changelog

## Unreleased

Pre-release hardening for v1.0.0: CI, packaging smoke tests, and property tests.

- HEAD and OPTIONS request support.
- Security defaults: `trustProxy` opt-in, socket-IP rate-limit keys, symlink-escape defense for static files, secure cookie preset.
- Request timeouts with 504 Problem+Json and abort signals.
- Dispatch fast path.
- `@zebra/observability` package (request id, access logs, metrics, health, error reporter).
- Request and response helpers (`json` / `text` / `form` / `stream` / `html` / `redirect`).
- `@zebra/redis` package (Redis-backed session and rate-limit stores).
- CI matrix (Linux + Bun versions), tarball smoke test (`verify:packages`), fuzz/property tests for HTTP security paths.

## v1.0.0 (2026-08-09)

### Features

- Initial frozen v1.0.0 release: the `zebra` facade plus `@zebra/core` (DI, radix router, middleware, lifecycle, static files, WebSocket, contract implementation), `@zebra/contract`, `@zebra/client`, `@zebra/testing`, `@zebra/session`, `@zebra/cors`, `@zebra/rate-limit`.
- API freeze (docs/api-freeze.md) defines the v1 stability promise and SemVer policy.
- Docs site, benchmarks, lockstep release pipeline.
