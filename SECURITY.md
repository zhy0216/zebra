# Security

## Reporting vulnerabilities

Please report security issues privately before opening a public issue. Contact
the maintainers at the repository <https://github.com/zhy0216/zebra> (issues
marked `security`), or by email if one is listed on the profile of a
maintainer of the repo. Do not open a public issue or PR for a vulnerability
until it has been triaged.

Please include:

- the affected package (`@zebra-web/zebra`, `@zebra-web/*`) and version,
- a minimal reproduction (code + request),
- the impact you believe the issue has (DoS, path traversal, spoofing, ...).

## Security-relevant configuration

Zebra's defaults favor not trusting client input; changing them must be
deliberate.

- **Client IPs** — `ZebraRequest.ip` is always the socket peer address from
  Bun (`server.requestIP`); it is never header-derived. Framework code does
  not read `x-forwarded-for`.
- **Rate limiting** — `@zebra-web/rate-limit` keys on the socket IP by default.
  Set `trustProxy: true` **only** behind a proxy that overwrites
  `x-forwarded-for` (reverse proxy / CDN / load balancer); otherwise clients
  can spoof the header to carve out their own unlimited budget.
- **Static files** — `app.static()` rejects traversal (`..`, absolute paths,
  NUL bytes) and verifies the `realpath` of the served file stays inside the
  realpath of the root, closing symlink-escape (a symlink inside root pointing
  outside it is not served). Keep static roots to content you actually want to
  serve, and never mount a directory that contains secrets or source.
- **Sessions** — `@zebra-web/session` ids are HMAC-SHA256 signed; destroyed or
  expired ids are never revived (fixation-safe). The default cookie carries
  `HttpOnly` + `SameSite=Lax` (`SECURE_COOKIE`); opt out with
  `cookie: { preset: "plain" }` for a flag-free cookie.
- **Bodies** — app-level body limits (per content-type) compose with Bun's
  transport-level `maxRequestBodySize`; keep the transport limit ≥ the largest
  app limit so the parser's structured 413s stay authoritative.
