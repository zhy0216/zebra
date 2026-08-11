# Routing

Zebra's router is a radix tree: static segments match exactly via a `Map`, `/:name` is a single-segment param, and `/*rest` is a greedy wildcard. There is no string concatenation or regex on the hot path, so lookups are fast and stable.

## Registering routes

Every HTTP method has a same-named shortcut with an identical signature:

```ts
z.get(path, handler);
z.get(path, { deps }, handler); // with named-object DI deps

z.post(...);
z.put(...);
z.patch(...);
z.delete(...);
z.head(...);
z.options(...);

// generic entry (first argument is the method)
z.route("GET", path, handler);
```

The `get` / `post` overloads infer the exact type of `req.params` from the path literal:

```ts
z.get("/users/:id", async (req) => {
  req.params.id; // string — inferred from the path literal
});

z.get("/users/:id/posts/:postId", async (req) => {
  req.params.id;       // string
  req.params.postId;   // string
});
```

## Path params

| Syntax | Matches | Example |
| --- | --- | --- |
| `:name` | a single path segment | `/users/:id` → `/users/42` |
| `*name` | greedily the rest of the path (including `/`) | `/files/*path` → `/files/a/b.txt` |

```ts
z.get("/files/*path", async (req) => {
  req.params.path; // "a/b.txt"
});
```

Registering the exact same `method + path` (same param layout) twice throws `Duplicate route` — at boot time (`listen`), not per request.

## Method mismatch: 405 and automatic OPTIONS

When a path exists but the method does not, Zebra answers per the RFCs:

- **405 Method Not Allowed**, Problem+Json response with an `Allow` header listing the supported methods.
- **OPTIONS** on a known path is answered automatically with `204` + `Allow` (no OPTIONS route needed).

```sh
curl -i -X POST http://localhost:3000/hello/world   # if only GET is registered
# HTTP/1.1 405 Method Not Allowed
# allow: GET, HEAD
```

Two notes:

- **HEAD** is implied by GET: when no HEAD route is registered, a HEAD request falls back to the GET handler with the body stripped (status and headers preserved).
- The automatic OPTIONS answer runs in the **terminal handler**, so it does not go through route-level middleware (e.g. auth guards) — preflight requests stay unauthenticated. Register an explicit OPTIONS route when you need a custom preflight.

## Groups `app.group()`

`group` gives a set of routes a common prefix and scoped middleware:

```ts
z.group("/blogs", (g) => {
  g.use(requireAuth());          // group middleware: applies only to group routes
  g.get("/", async () => listBlogs());
  g.get("/:id", async (req) => getBlog(req.params.id));
});
```

- Prefixes nest: `g.group("/sub", ...)` composes to `/blogs/sub/...`.
- A group route's middleware = global middleware + ancestor group middleware + in-group middleware (in registration order).
- The group's type is `GroupApi`; its `get` / `post` etc. merge the prefix into the path-param types (`JoinPath`).

## Static files `app.static()`

```ts
z.static("/", new URL("../public", import.meta.url).pathname);
```

`app.static(routePath, root, opts)` registers two GET routes (the prefix itself and `/*file`) serving files under `root`:

- Default `index` is `index.html`, `maxAge` is `3600` (`Cache-Control: public, max-age=...`).
- Built-in security: path traversal (`..`) and symlink escape (realpath containment check) are rejected with 403.
- Weak ETags, conditional requests (`If-None-Match` → 304), and byte ranges (`Range` → 206 / 416).
- Metadata caching (`cacheTtl`, default 1000ms) skips `statSync` on the hot path; cache misses are never cached, so newly created files appear immediately.

```ts
z.static("/assets", "./public/assets", { maxAge: 86400, cacheTtl: 0 });
```

## Route table (introspection)

`app.routeTable` returns a **frozen copy** of all registered routes (method, path, deps spec, middleware, optional contract def), for OpenAPI / introspection tooling:

```ts
for (const route of z.routeTable) {
  console.log(route.method, route.path);
}
```

## Zero-cost fast path

Routes are precompiled into execution plans (`RoutePlan`) at `listen()` time:

- Routes without DI deps and without a session resolver take a **zero-cost fast path**: no Container child scope, the precompiled middleware array runs as-is, and the handler receives `{}`.
- Chains with deps compute "which middlewares need dep resolution" once at boot and wrap them by precomputed index — no per-request scanning.

Meaning: plain route + middleware apps have **no request-scope overhead**; only chains that actually declare deps or configure sessions create child scopes.

## Timing and constraints

- Routes / middleware / bindings must be registered **before `listen()`**; calling `z.get(...)`, `z.use(...)`, or `z.inject*(...)` afterwards throws (`Cannot register ... after app.listen()`).
- No path match → 404 Problem+Json (`not_found`).

## Next steps

- [Dependency injection: the `{ deps }` declaration and scopes](03-di.md)
- [Middleware: `app.use` global chain and group scoping](04-middleware.md)
- [HTTP: request / response / errors](05-http.md)
