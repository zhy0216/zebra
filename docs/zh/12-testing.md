# 测试（@zebra/testing）

`@zebra/testing` 提供进程内测试：`createTestApp` 在**不打开 socket** 的情况下把请求直接打穿整个管道（包括图校验、中间件链、DI 作用域、错误中间件），`createTestClient` 则把契约客户端接到同一个进程内 app 上。测试跑的是与线上完全相同的组合。

## 安装

```sh
bun add @zebra/testing
```

## createTestApp

```ts
import { createTestApp } from "@zebra/testing";

const app = createTestApp();

// 与普通 Zebra 完全一样地注册
app.get("/hello/:name", async (req) => ({ hello: req.params.name }));

// 请求打穿管道（自动 boot）
const res = await app.request("/hello/world");
await res.json(); // { hello: "world" }
```

`TestApp` 在 `Zebra` 基础上加了两个方法：

| 方法 | 说明 |
| --- | --- |
| `request(path, init?)` | 用 `http://test.local` 前缀构造 `Request` 并 dispatch，返回 `Response` |
| `boot()` | 显式触发 `prepare()`（图校验 + 计划编译 + freeze） |

- `request` 每次自动 `boot()`（幂等）。
- 传入完整 URL（`http://...`）时原样使用。
- 全程无 socket、无 `Bun.serve`、无端口占用——测试可以并行跑。

### 组合根模式

最推荐的用法：应用暴露一个**组合根**（build 函数），测试复用它：

```ts
// app.ts —— 生产与测试共用
export function buildForumApp(opts: ForumAppOptions = {}): Zebra {
  // 所有注册（DI、中间件、路由、ws、生命周期钩子）
}

// app.test.ts
import { createTestApp } from "@zebra/testing";
import { buildForumApp } from "./app";

function makeApp() {
  return createTestApp({
    // 若 buildForumApp 接收 ZebraOptions 或需要注入容器……
  });
}
```

> `createTestApp(opts: ZebraOptions)` 接收与 `new Zebra(opts)` 相同的选项——测试可以通过 `container` 选项注入 mock（`bind(IRepo).to(MockRepo)`、`snapshot()`/`restore()` 隔离用例）。

## createTestClient

把契约客户端接到进程内 app 上，**零 socket 的端到端类型安全测试**：

```ts
import { createTestApp, createTestClient } from "@zebra/testing";
import { blogContract } from "./contract";

const app = createTestApp();
app.implement(blogContract, { blog: BlogService }, { ... });

const client = createTestClient(app, blogContract);

const created = await client.create({ body: { title: "T", content: "C" } });
const got = await client.get({ params: { id: created.id } });
```

- 返回类型与 `createClient` 完全一致（`ContractClient<R>`）。
- `fetch` 被替换为 `app.request`，验证了契约 → implement → 校验 → 序列化的完整链路。
- 错误路径同样可测：`ClientError` 的 `code` / `status` / `problem` 与线上一致。

## 配合 bun:test

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

## 中间件 / 会话测试

中间件测试与线上一致，直接 `app.use` 后用 `app.request` 驱动：

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

// 带上返回的 Set-Cookie 再请求，验证会话持久
const login = await app.request("/login", { method: "POST" });
const cookie = login.headers.get("set-cookie")!;
const me = await app.request("/me", { headers: { cookie } });
```

## 其他测试技巧

- **容器快照**：`container.snapshot()` / `restore()` 在用例间隔离绑定与实例。
- **`req.ip`**：`dispatch` 路径（无 Bun server）下 `req.ip` 为 `undefined`——限流中间件此时回退到 `anonymous` key，测试行为确定。
- **WebSocket**：升级路径需要真实 `Bun.serve`（`requestIP` / `upgrade`），ws 集成测试请用真服务器。

## 下一步

- [契约优先：createTestClient 的类型来源](11-contract-first.md)
- [forum 示例：完整集成测试](README.md#示例)
