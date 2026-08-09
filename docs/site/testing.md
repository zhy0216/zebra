# Testing — `@zebra/testing`

`createTestApp` runs requests **in-process without opening sockets**;
`createTestClient` derives a typed contract client over that app — a
socket-free full loop.

```sh
bun add -d @zebra/testing
```

## In-process test app

```ts
import { describe, expect, test } from "bun:test";
import { createTestApp } from "@zebra/testing";

const app = createTestApp();
app.get("/hello/:name", (req) => Response.json({ hello: req.params.name }));

test("greets", async () => {
  const res = await app.request("/hello/world");
  expect(res.status).toBe(200);
  expect(await res.json()).toEqual({ hello: "world" });
});
```

Middleware and DI work exactly as in production:

```ts
const app = createTestApp({ session: { resolver: mw.resolver } });
app.use(mw);
```

## Typed client round-trip (contract-first)

```ts
import { createTestClient } from "@zebra/testing";

const app = createTestApp();
z.implement(blogContract, { blog: BlogService }, impls);

const client = createTestClient(app, blogContract); // typed, zero sockets
const created = await client.create({ body: { title: "t", content: "c" } });
```

## Full frozen surface

See `docs/api-freeze.md` §3 `@zebra/testing` — `createTestApp`,
`createTestClient`, and the type `TestApp`.
