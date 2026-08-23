# HTTP

本章覆盖 `ZebraRequest`（请求对象）、请求体解析、响应 helpers、结构化错误（RFC 9457 Problem+Json）、静态文件与请求超时。

## ZebraRequest

路由 handler 与中间件拿到的 `req` 是一个 `ZebraRequest`，包着 Web Standard `Request`：

```ts
interface ZebraRequest<P, B, Q> {
  raw: Request;            // 原始 Request
  params: P;               // 路径参数（路由字面量推断类型）
  query: Q;                // 查询参数（Record<string, string>）
  headers: Headers;
  url: URL;
  body(): Promise<B>;      // 按 content-type 解析的 body
  json(): Promise<unknown>;
  text(): Promise<string>;
  form(): Promise<FormData>;
  stream(): ReadableStream<Uint8Array>;
  ctx: Map<symbol, unknown>; // 中间件共享数据的请求级 Map
  ip?: string;             // socket 对端地址（Bun requestIP）
  signal: AbortSignal;     // 取消信号（超时/客户端断开）
}
```

- `query` 来自 `url.searchParams`，重复键取最后一个。
- `req.ctx` 是请求级共享状态（中间件写、handler 读），见 [中间件](04-middleware.md#通过-reqctx-传递数据)。
- `req.ip` 来自 `Bun.serve` 的 `server.requestIP(req)`，**永远不从 header 推导**；没有 Bun server（如 `app.dispatch()` 测试）时为 `undefined`。`x-forwarded-for` 只有在显式配置 `trustProxy` 时才被读取（由中间件如 `@zebra-web/rate-limit` 处理）。

## 请求体

### 惰性与单次消费

请求体是**惰性解析 + 记忆化**的：第一次调用 `body()` / `json()` / `text()` / `form()` 时缓冲一次字节，之后共享；`stream()` 不缓冲。

原始流是**单次消费**的：`body()` / `json()` / `text()` / `form()` / `stream()` 只能调用其中一个（否则第二个会读到空流）。

### 解析规则

| 方法 | 行为 |
| --- | --- |
| `body()` | 按 content-type 解析：`application/json` → JSON；`multipart/form-data` → `FormData`（带 `File` 条目）；`application/x-www-form-urlencoded` → `FormData`；其他 → 文本 |
| `json()` | 无视 content-type 强制按 JSON 解析。空 body → `null`；非法 JSON → 400 `invalid_json` |
| `text()` | 原始文本 |
| `form()` | multipart → `FormData`（`File` 条目，受 `maxFiles`/`maxFileSize` 约束）；urlencoded → 字符串条目；其他 content-type → 空 `FormData` |
| `stream()` | 原始流，经过同一个大小限制管道（`limitStream`）——大文件上传的不缓冲路径；限制触发时错误在流被读取时浮现 |

### 大小限制

构造时可覆盖（`ZebraOptions.body`），默认值：

```ts
{
  maxSize: 1024 * 1024,              // 1MB —— body()/json()/text()/form() 的通用上限
  json: { limit: 1024 * 1024 },      // 1MB
  form: { limit: 1024 * 1024 },      // 1MB
  multipart: { limit: 16 * 1024 * 1024, maxFiles: 10, maxFileSize: 8 * 1024 * 1024 },
}
```

`Bun.serve` 层的 `maxRequestBodySize`（`ListenOptions`，默认 128MB）是独立的传输层上限，先于任何 handler 执行。

```ts
const z = new Zebra({
  body: { json: { limit: 256 * 1024 }, multipart: { maxFiles: 4 } },
});
```

## 响应 helpers

来自 `@zebra-web/core`（`@zebra-web/zebra` 门面同样导出）。默认 content-type / 状态：

| Helper | 默认 content-type | 默认状态 |
| --- | --- | --- |
| `json(value)` | `application/json; charset=utf-8` | 200 |
| `text(value)` | `text/plain; charset=utf-8` | 200 |
| `html(value)` | `text/html; charset=utf-8` | 200 |
| `stream(body)` | `application/octet-stream` | 200 |
| `redirect(url)` | —（无 body） | 302 |

```ts
import { html, json, redirect, stream, text } from "@zebra-web/zebra";

z.get("/api", () => json({ ok: true }));
z.get("/plain", () => text("hello"));          // 无引号的原文
z.get("/page", () => html("<h1>Hi</h1>"));
z.get("/dl", () => stream(Bun.file("./x.bin")));
z.get("/old", () => redirect("/new"));         // 或 { status: 301 }
```

规则：

- `init.headers`（任何形式：record / 数组 / `Headers`）里的 `content-type` 总是覆盖默认值。
- `redirect` 的 `Location` 永远来自 `url` 参数；状态默认 302，可用 `init.status` 覆盖（如 301）。
- `stream` 接受 `ReadableStream`（SSE、分块）、`Blob`（`Bun.file()` 即 `BunFile`）、`ArrayBuffer`、类型化数组。

## HttpError 与 Problem+Json

### 抛出结构化错误

```ts
import { HttpError } from "@zebra-web/zebra";

throw new HttpError(404, "board_not_found", "No such board");
throw new HttpError(429, "rate_limit_exceeded", "Too Many Requests", { limit: 10 }, {
  "retry-after": "60",
});
```

```ts
class HttpError extends Error {
  constructor(
    status: number,        // 400–599（其他值抛 RangeError）
    code: string,          // 机器可读错误码
    title: string,         // 人类可读标题
    detail?: unknown,      // 附加详情（自动 JSON 安全序列化）
    headers?: Record<string, string>, // 复制到响应头
  );
}
```

内置错误中间件把它转成：

```json
{
  "type": "https://errors.zebra.dev/rate_limit_exceeded",
  "status": 429,
  "title": "Too Many Requests",
  "detail": { "limit": 10 },
  "instance": "/api/posts"
}
```

`err.headers` 原样进入响应头（`HttpError` 之外的内置错误码见下方「错误一览」）。

### ValidationError

`@zebra-web/core` 的 `ValidationError` 携带 `ValidationIssue[]`（`path` + `message`），渲染为 422 Problem+Json，`errors` 数组列出每个字段。契约实现（`app.implement`）的入参校验失败就是这个形状。

### 错误一览（内置 `code`）

| code | 状态 | 触发 |
| --- | --- | --- |
| `not_found` | 404 | 路径无匹配 |
| `method_not_allowed` | 405 | 路径存在、方法不匹配（带 `Allow` 头） |
| `invalid_json` | 400 | `json()` 遇到非法 JSON |
| `validation_failed` | 422 | `ValidationError` |
| `request_timeout` | 504 | `requestTimeout` 到期（`detail.limit` = 超时毫秒数） |
| `invalid_contract_response` | 500 | 契约声明 204 但 handler 返回了 `Response` |
| `output_validation_failed` | 500 | 契约输出校验失败 |
| `internal` | 500 | 未识别错误 |

`exposeStack: true` 时，未知错误（非 HttpError/ValidationError）的 body 会带 `stack`。

## 静态文件

`app.static(routePath, root, opts)` —— 详见 [路由章节](02-routing.md#静态文件-appstatic)。要点：

- 路径穿越与符号链接逃逸防护（realpath 包含性检查，403）。
- 弱 ETag、`If-None-Match` → 304、`Range` → 206 / 416。
- `index`（默认 `index.html`）、`maxAge`（默认 3600）、`cacheTtl`（默认 1000ms 元数据缓存）。

## 请求超时

`ZebraOptions.requestTimeout`（毫秒）为单个请求设置截止时间：

```ts
const z = new Zebra({ requestTimeout: 5_000 });
```

- 到期后请求被中止，客户端收到 504 `request_timeout`（Problem+Json，`detail.limit` 为毫秒数）。
- handler 可在 `req.signal` 上监听 `abort` 提前停止后台工作；`signal` 在客户端断开时同样触发（来自 Bun 原始 `Request.signal`）。
- 后台工作不会因为超时被杀死（会继续在后台跑完），但它能通过 `req.signal` 感知取消。默认不启用——不设置就没有截止时间与 abort 接线。

## 下一步

- [中间件：如何在管道里处理请求/响应](04-middleware.md)
- [结构化错误与契约校验的配合](11-contract-first.md)
- [静态文件与生产部署](15-production.md)
