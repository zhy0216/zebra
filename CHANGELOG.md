# Changelog

## Unreleased

Pre-release hardening for v1.0.0: CI, packaging smoke tests, and property tests.

- HEAD and OPTIONS request support.
- Security defaults: `trustProxy` opt-in, socket-IP rate-limit keys, symlink-escape defense for static files, secure cookie preset.
- Request timeouts with 504 Problem+Json and abort signals.
- Dispatch fast path.
- `@zebra-web/observability` package (request id, access logs, metrics, health, error reporter).
- Request and response helpers (`json` / `text` / `form` / `stream` / `html` / `redirect`).
- `@zebra-web/redis` package (Redis-backed session and rate-limit stores).
- CI matrix (Linux + Bun versions), tarball smoke test (`verify:packages`), fuzz/property tests for HTTP security paths.

### Bug fixes and hardening (2026-08-14)

- Route params are percent-decoded (matching stays on raw segments, so `%2F`
  can never shadow a static route); wildcard captures stay raw.
- Session cookies now survive error responses: a first-time visitor whose
  handler throws still receives the signed sid cookie; a destroyed session
  still receives the expiring cookie.
- Lazy DI factories participate in cycle detection (readable
  `CircularDependencyError` instead of a stack overflow).
- Session expiry timers can no longer dispose a session container while a
  request is in flight; stale timers are cleared before re-arming.
- WebSocket upgrade hooks only run for well-formed handshakes
  (Sec-WebSocket-Key + Version 13), so plain `Upgrade: websocket` probes can
  no longer trigger auth/session/DI work.
- Session writes are isolated between concurrent requests on the same id
  (per-request shallow copy; flushed on persist).
- `client` sends `FormData`/`Blob` bodies as-is instead of `"{}"`;
  `json(undefined)` returns 204 instead of an invalid JSON body.
- Non-JSON-serializable handler results raise a structured 500
  (`response_serialization`) instead of escaping the pipeline.
- WS handler callback exceptions are reported via `console.error` instead of
  becoming unhandled rejections; `contract.status()` validates 100–599.
- Static files deny dotfiles by default (`dotfiles: "allow"` opts out).
- Rate-limit `MemoryStore` sweeps expired buckets (bounded per-call cost).
- Request ids are validated (charset + length) before being echoed or logged.
- CORS rejected preflights carry `Vary: Origin` (cache-poisoning defense).

## v1.0.0 (2026-08-09)

### Features

- Initial frozen v1.0.0 release: the `@zebra-web/zebra` facade plus `@zebra-web/core` (DI, radix router, middleware, lifecycle, static files, WebSocket, contract implementation), `@zebra-web/contract`, `@zebra-web/client`, `@zebra-web/testing`, `@zebra-web/session`, `@zebra-web/cors`, `@zebra-web/rate-limit`.
- API freeze (docs/api-freeze.md) defines the v1 stability promise and SemVer policy.
- Docs site, benchmarks, lockstep release pipeline.
