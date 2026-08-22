# 契约优先 API

Zebra 的契约优先模式（oRPC 风格）：**契约定义一次**，服务端实现（`app.implement`）与客户端调用（`createClient` / `createTestClient`）全部从同一契约派生类型与运行时校验。

- `@zebra/contract` —— 契约构建器 `zc`（Standard Schema V1，零依赖）
- `@zebra/core` —— `app.implement`（输入/输出校验）
- `@zebra/client` —— 派生类型安全客户端（零依赖）

## 构建契约

```ts
import { zc } from "@zebra/contract";
import { z } from "zod";

export const Blog = z.object({ id: z.number(), title: z.string(), content: z.string() });

export const blogContract = {
  list: zc
    .get("/blogs")
    .query(z.object({ page: z.coerce.number().min(1).default(1) }))
    .output(z.array(Blog)),
  get: zc
    .get("/blogs/:id")
    .params(z.object({ id: z.coerce.number().int() }))
    .output(Blog)
    .errors({ blog_not_found: { status: 404 } }),
  create: zc
    .post("/blogs")
    .body(z.object({ title: z.string().min(1), content: z.string() }))
    .output(Blog)
    .status(201)
    .meta({ summary: "Create a blog post", tags: ["blogs"] }),
  remove: zc
    .delete("/blogs/:id")
    .params(z.object({ id: z.coerce.number().int() }))
    .status(204),
};
```

### 构建器方法（链式、不可变）

| 方法 | 作用 | 约束 |
| --- | --- | --- |
| `zc.get/post/put/patch/delete/head/options(path)` | 创建 procedure（方法 + 路径） | — |
| `.params(schema)` | 路径参数 schema | — |
| `.query(schema)` | 查询参数 schema | — |
| `.body(schema)` | 请求体 schema | **GET/HEAD 不允许**（编译期 + 运行时双重拒绝） |
| `.output(schema)` | 响应体 schema | — |
| `.status(n)` | 响应状态码（默认 200） | — |
| `.errors({ code: { status } })` | 声明错误码 | 文档 / 类型层面的错误契约 |
| `.meta(record)` | 任意元数据（OpenAPI 摘要等） | — |

schema 是 **Standard Schema V1** 兼容的任何校验器（zod 4、valibot 等）。每次调用返回新的冻结 procedure，可安全共享与组合。

### 组合：嵌套路由与 `prefix()`

```ts
import { prefix } from "@zebra/contract";

const postContract = {
  list: zc.get("/"),
  get: zc.get("/:id"),
};

const api = {
  posts: prefix("/posts", postContract),   // /posts、/posts/:id
  users: prefix("/users", { list: zc.get("/") }),
};
```

### 类型推断

```ts
import type { InferBody, InferOutput, InferParams, InferQuery } from "@zebra/contract";

type CreateBody = InferBody<typeof blogContract.create>;   // { title: string; content: string }
type BlogOut = InferOutput<typeof blogContract.get>;        // Blog
```

## 服务端实现：`app.implement`

```ts
import { Zebra } from "@zebra/core";
import { blogContract } from "./contract";

const app = new Zebra();
app.injectSingleton(BlogService);

app.implement(blogContract, { blog: BlogService }, {
  list: async (req, { blog }) => blog.list(req.query.page),
  get: async (req, { blog }) => {
    const b = await blog.find(req.params.id);
    if (b === undefined) throw new HttpError(404, "blog_not_found", "No such blog");
    return b;
  },
  create: async (req, { blog }) => blog.create(await req.body()),
  remove: async (req, { blog }) => {
    await blog.remove(req.params.id);
  }, // status 204 → 返回 undefined
});
```

签名：

```ts
implement(procOrRouter, handlerOrImpls);
implement(procOrRouter, deps, handlerOrImpls, opts?);
```

### 运行时校验流程

handler 被 `buildContractHandler` 包装，顺序按规范执行：

1. **params** 校验 → 失败记录问题
2. **query** 校验 → 与 params 聚合，全部失败抛 `ValidationError`（422，`errors` 数组带 `params.*` / `query.*` 前缀）
3. **body** 校验 → 失败抛 422；成功后 `req.body()` 被替换为校验后的值
4. **handler** 执行
5. **output** 校验（`validateOutput: true` 默认）→ 失败抛 500 `output_validation_failed`
6. 序列化：`JSON.stringify(payload)` + 契约声明的 `status`（默认 200）

handler 返回 `Response` 时直接透传（跳过 output 校验与序列化）；契约声明 `status: 204` 时 handler 必须返回 `undefined`（返回 `Response` 会抛 `invalid_contract_response`）。

### 路由级中间件

procedure 级实现可以是 `{ middlewares, handler }` 形式，或通过 `opts.middlewares` 传入：

```ts
app.implement(
  blogContract,
  { blog: BlogService },
  {
    create: {
      middlewares: [requireAuth(), writeLimit],
      handler: async (req, { blog }) => blog.create(await req.body()),
    },
  },
);
```

### 实现完整性校验

`implement` 会**穷举遍历**契约树，实现里缺了 / 多了 / 结构不对的叶子都会在注册时报错（带 `missing:` / `extra:` / `invalid:` 前缀的清单）——漏实现一个端点会在启动时暴露，而不是上线后。

## 客户端：`createClient`

```ts
import { createClient } from "@zebra/client";
import { blogContract } from "./contract";

const client = createClient(blogContract, {
  baseUrl: "http://localhost:3001",
  headers: () => ({ authorization: `Bearer ${token()}` }), // 动态头
});

const blogs = await client.list({ query: { page: 1 } });   // Blog[]
const blog = await client.get({ params: { id: 1 } });      // Blog
const created = await client.create({ body: { title: "T", content: "C" } }); // Blog, 201
await client.remove({ params: { id: 1 } });                // undefined（204）
```

类型安全：

- 参数按契约声明出现：`list` 需要 `{ query }`，`get` 需要 `{ params }`，`create` 需要 `{ body }`（无声明则不需要）。
- 返回值类型 = `output` 的 `InferOutput`；`status: 204` → `undefined`。

### 参数形态

```ts
interface ClientArgs<Def> = {
  params?: ...;   // 仅当契约声明了 params schema
  query?: ...;    // 仅当声明了 query
  body?: ...;     // 仅当声明了 body（GET/HEAD 无）
  headers?: Record<string, string>; // 请求级头覆盖
  signal?: AbortSignal;             // 取消
};
```

`createClient(router, opts)` 选项：`baseUrl`（必填）、`fetch`（自定义 fetch，测试注入用）、`headers`（静态或函数）。

### 错误处理

非 2xx 响应抛 `ClientError`：

```ts
import { ClientError } from "@zebra/client";

try {
  await client.get({ params: { id: 999 } });
} catch (e) {
  if (e instanceof ClientError) {
    e.status;    // 404
    e.code;      // "blog_not_found"（从 Problem+Json type 推导）
    e.problem;   // 完整 Problem+Json
    e.response;  // 原始 Response
  }
}
```

错误码推导：优先从 `type: "https://errors.zebra.dev/<code>"` 取，否则按状态码映射（`bad_request` / `unauthorized` / `forbidden` / `not_found` / `validation_failed` / `http_<status>`）。非 JSON 错误体回退为 `request_failed`。

## 测试：`createTestClient`

[`@zebra/testing`](12-testing.md) 的 `createTestClient` 把同一契约接到进程内 `TestApp`，零 socket：

```ts
import { createTestApp, createTestClient } from "@zebra/testing";

const app = createTestApp();  // 或 buildForumApp() 之类的组合根
// ... 注册路由/契约 ...
const client = createTestClient(app, blogContract);

const blogs = await client.list({ query: { page: 1 } });
```

## 与手写路由的对比

| | 手写路由 | 契约优先 |
| --- | --- | --- |
| 校验 | 手动 | params/query/body/output 全自动 |
| 客户端类型 | 手写 | 从契约派生 |
| 错误码契约 | 文档约定 | `errors()` 类型声明 |
| 运行时保障 | 无 | implement 完整性校验 + 输入输出校验 |

## 下一步

- [测试：进程内契约客户端](12-testing.md)
- [forum 示例：契约 + 会话 + 限流 + ws 的组合](README.md#示例)
- [contract-blog 示例：契约定义 + 客户端往返](README.md#示例)
