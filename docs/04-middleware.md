# Middleware

Middleware is the core extension point of the Zebra request pipeline. Zebra uses Koa-style onion composition: middleware runs before the handler, hands control to the next middleware in the chain via `await next()`, then runs its "after" logic when control returns.

## Signature

```ts
type Middleware = (
  req: ZebraRequest,
  next: () => Promise<Response>,
  deps?: Record<string, unknown>, // only for dep-aware middleware (wrapped by middleware())
) => Promise<Response>;
```

`req` is the same `ZebraRequest` the route handler receives (all middleware for one request share the same object, so `req.ctx` can carry data down the chain). `next()` resolves to the final downstream `Response`; a middleware can wrap it (change headers, wrap the body), short-circuit with its own response, or let it through unchanged.

```ts
import type { Middleware } from "zebra";

const timing: Middleware = async (req, next) => {
  const start = performance.now();
  const res = await next();
  res.headers.set("x-timing-ms", String(performance.now() - start));
  return res;
};

z.use(timing);
```

## Registration scopes

Middleware has three scopes, executed in registration order:

1. **Global** — `app.use(mw)`, applied to every route (except ws upgrades).
2. **Group** — `g.use(mw)` inside a `group`, applied to that group's routes only.
3. **Route-level** — via a contract impl's `{ middlewares, handler }` form, or `implement`'s `opts.middlewares`.

Execution order: global → ancestor groups → group → route-level.

> **Note**: WebSocket **upgrade requests do not go through `app.use` global middleware** (upgrade runs before the composed chain). Do ws auth in the `upgrade` hook.

## Dependency-aware `middleware()`

To declare DI deps in a middleware, wrap it with `middleware(deps, fn)` — the third argument receives the resolved deps:

```ts
import { middleware } from "zebra";

const requireAuth = middleware({ session: AuthService }, async (req, next, { session }) => {
  const user = await session.userFrom(req);
  if (!user) throw new HttpError(401, "unauthorized", "Login required");
  req.ctx.set(USER_KEY, user);
  return next();
});
```

`getMiddlewareDeps(mw)` reads a middleware's declared deps (the framework uses it for boot-time validation and runtime resolution). Dep-aware middleware requires a request scope — the cost is one child-container creation, but the plan is precompiled at boot, so runtime only wraps the middlewares that need resolution, by precomputed index.

## Passing data via `req.ctx`

`req.ctx` is a `Map<symbol, unknown>` shared by all middleware and the handler of one request. Use symbol keys to avoid collisions:

```ts
const USER_KEY = Symbol("zebra.user");

const attachUser = middleware({ auth: AuthService }, async (req, next, { auth }) => {
  req.ctx.set(USER_KEY, await auth.userFrom(req));
  return next();
});

// in the handler:
z.get("/me", async (req) => req.ctx.get(USER_KEY));
```

## Error middleware (built-in)

Zebra ships an error middleware that wraps the outermost layer of the pipeline:

- Any error thrown by middleware/handler is caught and converted to an RFC 9457 Problem+Json response (`application/problem+json`).
- An `HttpError`'s `headers` (e.g. `Allow`, `Retry-After`) are copied verbatim onto the response.
- With `errors.exposeStack: true`, unknown errors include a `stack` field in the body.

```json
{
  "type": "https://errors.zebra.dev/not_found",
  "status": 404,
  "title": "No route for GET /nope",
  "instance": "/nope"
}
```

Custom error handling: register your own error middleware in `app.use` (catching around `next()`), or use `@zebra/observability`'s `errorReporter` to only report without changing the response (see [Observability](13-observability.md)).

## Constraints and semantics

- `next()` can only be called once; a second call throws.
- A short-circuiting middleware (no `next()`) makes its response final — the downstream handler never runs.
- Middleware must be registered before `listen()`; registering afterwards throws.
- The packaged middleware (`@zebra/session`, `@zebra/cors`, `@zebra/rate-limit`, `@zebra/observability`) are plain `Middleware` — just `app.use` them.

## Next steps

- [HTTP: ZebraRequest / responses / errors](05-http.md)
- [Cookie session middleware](07-sessions.md)
- [CORS middleware](08-cors.md)
- [Rate limiting middleware](09-rate-limiting.md)
