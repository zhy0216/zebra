# MCP Tools from your contract

Zebra's contract-first pattern (`@zebra-web/contract` → `app.implement` → `@zebra-web/client`) extends to MCP: declare a procedure as an MCP tool with `.mcp()`, and `@zebra-web/mcp` exposes it over the **same contract** — same schemas, same middleware, same DI, same runtime validation.

```text
@zebra-web/contract:   zc.get(...).mcp("get_topic", "获取主题", { readOnly: true })
@zebra-web/schema-zod: zod → JSON Schema (inputSchema / codegen)
@zebra-web/mcp:        tools/list + tools/call → HTTP Request → app.dispatch()
```

## Packages

- `@zebra-web/contract` — adds the `.mcp()` builder (MCP metadata lives on the contract def)
- `@zebra-web/schema-zod` — the Zod → JSON Schema adapter (zod dependency isolated here)
- `@zebra-web/mcp` — the MCP protocol adapter + HTTP dispatch bridge (the only place with an MCP SDK dependency)

`@zebra-web/core` never imports zod or any MCP SDK at runtime.

## Declaring a tool

```ts
import { zc } from "@zebra-web/contract";
import { z } from "zod";

const Topic = z.object({ id: z.number(), title: z.string(), content: z.string() });

const api = {
  topics: {
    get: zc
      .get("/topics/:id")
      .params(z.object({ id: z.coerce.number().int() }))
      .output(Topic)
      .mcp("get_topic", "获取主题", { readOnly: true }),
    create: zc
      .post("/topics")
      .body(z.object({ title: z.string().min(1), content: z.string() }))
      .output(Topic)
      .status(201)
      .mcp({ name: "create_topic", description: "创建主题", destructive: true }),
  },
  // no .mcp() → not exposed as an MCP tool
  internal: zc.get("/internal/stats"),
};
```

`.mcp()` supports both a positional form `(name, description, options?)` and an object form. Options are **descriptions/annotations only** — never authorization:

| option | MCP annotation | meaning |
| --- | --- | --- |
| `title` | `Tool.title` | tool display title |
| `readOnly` | `readOnlyHint` | safe to call repeatedly, no side effects |
| `destructive` | `destructiveHint` | irreversible side effects |
| `idempotent` | `idempotentHint` | repeating the call is safe |
| `openWorld` | `openWorldHint` | may affect the outside world |

Real authorization stays in Zebra middleware / session / DI.

## Creating the MCP server

```ts
import { Zebra } from "@zebra-web/core";
import { createMcpServer } from "@zebra-web/mcp";
import { zodSchemaAdapter } from "@zebra-web/schema-zod";

const app = new Zebra();
app.implement(api, { /* handlers */ });

const mcp = createMcpServer({
  app,
  contract: api,
  schema: zodSchemaAdapter(),
});

// Connect any MCP transport (stdio / SSE / streamable HTTP):
await mcp.connect(new StdioServerTransport());
```

`@zebra-web/mcp` only handles `tools/list`, `tools/call`, and the Request ↔ Response mapping. Everything else runs through `app.dispatch()`:

```text
MCP tools/call
  ↓ { params, query, body }
HTTP Request
  ↓ app.dispatch()
router / middleware / auth / session / rate-limit / DI / contract validation
  ↓ Response
MCP result
```

## Argument shape

MCP arguments are **namespaced** (`{ params, query, body }`) so path/query/body fields never collide:

```json
{ "params": { "id": 123 }, "query": { "includePosts": true }, "body": {} }
```

The `inputSchema` is generated from the contract schemas: `params` is required when declared, `query`/`body` follow their own schema's required fields (all-optional parts can be omitted).

## Mapping results

| HTTP response | MCP result |
| --- | --- |
| 2xx JSON object | `content: [text JSON]` + `structuredContent` |
| 2xx JSON array / scalar | `content: [text JSON]` |
| 2xx text (plain `Response`) | `content: [text]` |
| 204 | `content: []` |
| non-2xx Problem+Json | `isError: true` tool error with the Problem+Json as text |
| unknown tool name | protocol `MethodNotFound` error |

Zod `transform` / `coerce` results still reach the handler — the JSON Schema only describes the input shape, runtime validation is unchanged.

## Forwarding context

Map MCP call context into HTTP headers so existing auth middleware keeps working:

```ts
const mcp = createMcpServer({
  app,
  contract: api,
  schema: zodSchemaAdapter(),
  headers: (ctx) => ({ authorization: `Bearer ${tokenFor(ctx.name)}` }),
});
```

You can also observe calls (request id + tool name + status + duration) via `logger`, and pass an `AbortSignal` through `callTool({ name, arguments, signal })`.

## Direct use (no transport)

For tests and tooling, `mcp` also exposes `listTools()` and `callTool()` directly, so you can drive it in-process without a transport:

```ts
const { tools } = await mcp.listTools();
const result = await mcp.callTool({ name: "get_topic", arguments: { params: { id: 1 } } });
```

## Testing

`@zebra-web/mcp` tests exercise the full loop in-process (MCP call → `app.dispatch()` → contract validation → result). Because the bridge reuses dispatch, the same contract implemented by `app.implement` is covered by `createTestClient` ([Testing](12-testing.md)) and by MCP without duplicating business logic.

## Next steps

- [Contract-first APIs](11-contract-first.md) — the contract builder, `app.implement`, `createClient`
- [Testing](12-testing.md) — in-process test clients over the same contract
