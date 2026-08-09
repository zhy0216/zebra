# CORS — `@zebra/cors`

CORS middleware: origin allowlists, preflight handling (204 + full header
set), credentials with exact-origin echo, and `Vary: Origin` on dynamic
matches.

```sh
bun add @zebra/cors
```

## Basic use

```ts
import { cors } from "@zebra/cors";

const z = new Zebra();
z.use(cors({ origin: "https://example.com" }));
```

## Options

| Option | Default | Description |
| ------ | ------- | ----------- |
| `origin` | `*` (any origin) | Allowed origins: string, string[], RegExp, or predicate `(origin) => boolean` |
| `credentials` | `false` | Reflect credentials. When true the concrete origin is echoed, never `*` |
| `methods` | common set (`GET`, `HEAD`, `POST`, `PUT`, `PATCH`, `DELETE`, `OPTIONS`) | Methods advertised in preflight |
| `allowedHeaders` | echoes `Access-Control-Request-Headers` | Headers advertised in preflight |
| `exposedHeaders` | — | Response headers exposed to the browser |
| `maxAge` | — | Preflight cache TTL in seconds |

## Behavior

- **Preflight** — an `OPTIONS` request carrying `Access-Control-Request-Method`
  is answered with 204 plus the full header set the browser will enforce. A
  disallowed origin gets a plain 204 *without* CORS headers — the browser
  blocks the actual request on its side (no 403 needed). Other `OPTIONS`
  requests pass through.
- **Actual requests** — allowed origins get the CORS response headers; a
  `null` origin (same-origin or non-browser request) never matches.
- **Credentials** — with `credentials: true`, `Access-Control-Allow-Origin`
  echoes the exact request origin instead of `*`.
- **Dynamic matches** — with RegExp/predicate origins, responses carry
  `Vary: Origin` so caches don't serve a wrong-credentialed copy.

## Origin utilities

`DEFAULT_ORIGIN` (`*`), `matchOrigin(origin, config, credentials)`, and
`resolveAllowOrigin` are exported for custom middleware and tooling.

## Full frozen surface

See `docs/api-freeze.md` §3 `@zebra/cors` — `cors`, `DEFAULT_ORIGIN`,
`matchOrigin`, `resolveAllowOrigin`, and the types `CorsOptions`, `CorsOrigin`.
