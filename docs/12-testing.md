# Testing (@zebra/testing)

`@zebra/testing` provides in-process testing: `createTestApp` drives requests through the **entire pipeline without opening a socket** (graph validation, middleware chain, DI scopes, error middleware), and `createTestClient` connects a contract client to the same in-process app. Tests run the exact composition your server runs.

## Install

```sh
bun add @zebra/testing
```

## createTestApp

```ts
import { createTestApp } from "@zebra/testing";

const app = createTestApp();

// register exactly like a normal Zebra
app.get("/hello/:name", async (req) => ({ hello: req.params.name }));

// requests go through the pipeline (auto-boot)
const res = await app.request("/hello/world");
await res.json(); // { hello: "world" }
```

`TestApp` adds two methods on top of `Zebra`:

| Method | Description |
| --- | --- |
| `request(path, init?)` | prefixes `http://test.local`, dispatches, returns `Response` |
| `boot()` | triggers `prepare()` explicitly (graph validation + plan compilation + freeze) |

- `request` auto-boots every time (idempotent).
- A full URL (`http://...`) is used as-is.
- No socket, no `Bun.serve`, no port — tests can run in parallel.

### The composition-root pattern

Recommended: expose a **composition root** (a build function) from your app module and reuse it in tests:

```ts
// app.ts — shared by production and tests
export function buildForumApp(opts: ForumAppOptions = {}): Zebra {
  // all registrations (DI, middleware, routes, ws, lifecycle hooks)
}

// app.test.ts
import { createTestApp } from "@zebra/testing";
import { buildForumApp } from "./app";

function makeApp() {
  return createTestApp({
    // createTestApp takes the same ZebraOptions — inject a container
    // with mocks if buildForumApp accepts options
  });
}
```

> `createTestApp(opts: ZebraOptions)` accepts the same options as `new Zebra(opts)` — tests can inject mocks via the `container` option (`bind(IRepo).to(MockRepo)`, `snapshot()`/`restore()` for per-case isolation).

## createTestClient

Connect a contract client to the in-process app — **socket-free end-to-end type-safe tests**:

```ts
import { createTestApp, createTestClient } from "@zebra/testing";
import { blogContract } from "./contract";

const app = createTestApp();
app.implement(blogContract, { blog: BlogService }, { ... });

const client = createTestClient(app, blogContract);

const created = await client.create({ body: { title: "T", content: "C" } });
const got = await client.get({ params: { id: created.id } });
```

- Return types are identical to `createClient` (`ContractClient<R>`).
- `fetch` is replaced by `app.request`, exercising the full contract → implement → validate → serialize chain.
- Error paths are testable too: `ClientError`'s `code` / `status` / `problem` match production exactly.

## With bun:test

```ts
import { describe, expect, test } from "bun:test";

test("create + get round-trip", async () => {
  const app = createTestApp();
  app.implement(blogContract, ...);
  const client = createTestClient(app, blogContract);

  const created = await client.create({ body: { title: "A", content: "B" } });
  expect(created.id).toBeTypeOf("number");

  const got = await client.get({ params: { id: created.id } });
  expect(got.title).toBe("A");
});

test("validation error surfaces as typed ClientError", async () => {
  const app = createTestApp();
  app.implement(blogContract, ...);
  const client = createTestClient(app, blogContract);

  expect(client.create({ body: { title: "", content: "" } })).rejects.toMatchObject({
    status: 422,
    code: "validation_failed",
  });
});
```

## Middleware / session tests

Middleware tests work exactly like production — `app.use` then drive with `app.request`:

```ts
import { sessionMiddleware } from "@zebra/session";

const session = sessionMiddleware({ secret: "test-secret" });
const app = createTestApp({ session: { resolver: session.resolver } });
app.use(session);

app.post("/login", async (req) => {
  const s = getSession(req)!;
  await s.set("userId", 1);
  return { ok: true };
});

// replay the Set-Cookie to verify session persistence
const login = await app.request("/login", { method: "POST" });
const cookie = login.headers.get("set-cookie")!;
const me = await app.request("/me", { headers: { cookie } });
```

## Other testing tips

- **Container snapshots**: `container.snapshot()` / `restore()` isolate bindings and instances between cases.
- **`req.ip`**: on the dispatch path (no Bun server), `req.ip` is `undefined` — the rate-limit middleware falls back to the `anonymous` key, so test behavior is deterministic.
- **WebSocket**: the upgrade path needs a real `Bun.serve` (`requestIP` / `upgrade`); use a real server for ws integration tests.

## Next steps

- [Contract-first: where `createTestClient` types come from](11-contract-first.md)
- [forum example: full integration tests](README.md#examples)
