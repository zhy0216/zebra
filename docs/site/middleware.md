# Middleware

Middleware is Koa-style composed: each middleware calls `next()` to continue
down the chain.

## Global middleware

```ts
import { Zebra } from "zebra";

const z = new Zebra();
z.use(async (req, next) => {
  const started = Date.now();
  const res = await next();
  res.headers.set("x-server-time", String(Date.now() - started));
  return res;
});
```

`app.use()` applies globally; within a [group](routing.md#groups) it applies
to that group's routes only.

## Dependency-aware middleware

The `middleware()` helper declares deps, resolved from the container:

```ts
import { middleware } from "zebra";

const audit = middleware({ audit: Audit }, async (req, next, { audit }) => {
  const res = await next();
  await audit.log(req.url, res.status);
  return res;
});

z.use(audit);
```

`getMiddlewareDeps(mw)` exposes the declared deps for tooling and tests.

## Errors

The default error middleware produces RFC 9457 (Problem+Json) responses:

```ts
import { HttpError } from "zebra";

throw new HttpError(404, "blog_not_found", "blog 42 not found");
```

`HttpError` carries a `status` and a stable error `code`; `ValidationError`
extends it for request-validation failures, and `toProblemJson` shapes the
body.

## Notes

- WebSocket upgrade requests **bypass** `app.use` global middleware — upgrades
  run before the composed middleware chain (see [WebSocket](websocket.md)).
- A handler exception propagates through `next()` untouched and is turned into
  a Problem+Json response by the error middleware, which copies
  `err.headers` verbatim (this is how rate-limit `Retry-After` headers ride
  along on 429s).
