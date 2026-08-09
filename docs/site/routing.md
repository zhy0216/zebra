# Routing

Zebra uses a radix-tree router with `:params` and wildcards, plus the usual
HTTP verbs and route groups.

## Methods

```ts
z.get(path, handler);
z.post(path, handler);
z.put(path, handler);
z.patch(path, handler);
z.delete(path, handler);
```

Handlers receive a `ZebraRequest` — a `Request` superset with `params`,
`query`, and lazy body parsing — and may return a `Response` or any value
(value returns become JSON).

```ts
z.get("/hello/:name", async (req) => new Response(`hello, ${req.params.name}`));
```

## Route DI

Routes declare their dependencies with a named-object spec:

```ts
z.get("/hi/:name", { g: Greeter }, async (req, { g }) => g.greet(req.params.name));
```

## Groups

`app.group(prefix, g => { ... })` scopes a prefix and per-group middleware:

```ts
z.group("/blogs", (g) => {
  g.use(authMiddleware);
  g.get("/", listHandler);        // GET /blogs
  g.get("/:id", getHandler);      // GET /blogs/:id
});
```

## Static files

`app.static()` serves files with path-traversal defense, weak ETags,
conditional requests, and byte ranges.

## The request object

| Member | Description |
| ------ | ----------- |
| `req.params` | Radix-router path params (`/blogs/:id` → `{ id }`) |
| `req.query` | Parsed query string |
| `req.body()` | Lazily-parsed, content-type-aware body (with size limits) |

## Structured errors

Throw `HttpError` for structured failures; the default error middleware turns
it into an RFC 9457 Problem+Json response (see [middleware](middleware.md)).
