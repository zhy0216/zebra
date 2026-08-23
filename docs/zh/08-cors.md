# CORS（@zebra-web/cors）

`@zebra-web/cors` 是完整的 CORS 中间件：preflight 处理（204 + 完整头集）、origin 白名单（字符串 / 数组 / 正则 / 谓词）、credentials 精确回显、动态匹配时 `Vary: Origin`。

## 安装

```sh
bun add @zebra-web/cors
```

## 快速开始

```ts
import { cors } from "@zebra-web/cors";
import { Zebra } from "@zebra-web/core";

const app = new Zebra();
app.use(cors({ origin: ["http://localhost:3002"], credentials: true }));
```

## 选项

```ts
interface CorsOptions {
  origin?: string | string[] | RegExp | ((origin: string) => boolean);
  credentials?: boolean;
  methods?: string[];          // 默认 [GET, HEAD, POST, PUT, PATCH, DELETE, OPTIONS]
  allowedHeaders?: string[];   // 默认回显 Access-Control-Request-Headers
  exposedHeaders?: string[];
  maxAge?: number;             // preflight 缓存 TTL（秒）
}
```

| 选项 | 默认 | 说明 |
| --- | --- | --- |
| `origin` | `*` | 允许的 origin。字符串 / 数组精确匹配；正则测试；谓词函数接收 origin 返回 boolean |
| `credentials` | `false` | 是否回显 `Access-Control-Allow-Credentials: true`；开启时 origin **精确回显**，绝不 `*` |
| `methods` | 常见方法集 | preflight 广告的方法 |
| `allowedHeaders` | 回显请求头 | preflight 广告的请求头 |
| `exposedHeaders` | — | 暴露给浏览器 JS 的响应头 |
| `maxAge` | — | `Access-Control-Max-Age`（秒） |

## 行为细节

### Preflight（OPTIONS + `Access-Control-Request-Method`）

- 校验 origin：不匹配 → 返回**不带任何 CORS 头的 204**，浏览器在客户端侧拦截（无需 403）。
- 匹配 → `204` + 完整头集：`Access-Control-Allow-Origin`（精确回显或 `*`）、`Access-Control-Allow-Methods`、`Access-Control-Allow-Headers`（默认回显请求头）、可选 `Access-Control-Max-Age`、credentials 时加 `Access-Control-Allow-Credentials: true`。
- 精确回显的 origin 会带 `Vary: Origin`（`*` 不需要）。

### 实际请求

- 只有携带**匹配的 Origin 头**的请求才算跨域，才注入 CORS 头；无 Origin（同源 / 非浏览器）或 origin 不匹配 → 响应原样通过。
- 响应是**包装而非修改**：body / 状态 / 状态文本保留。
- 精确回显时 `Vary: Origin` 用 `append`（不覆盖 handler 自带的 `Vary`）。
- 没有 `Origin` 头的 `OPTIONS` 请求（非 preflight）直接透传。

```ts
app.use(cors({
  origin: (origin) => origin.endsWith(".example.com"),
  credentials: true,
  exposedHeaders: ["X-Total-Count"],
  maxAge: 600,
}));
```

## 与路由级中间件的关系

CORS preflight 应答由 Zebra 的**终端 handler** 自动生成（对已知路径的 OPTIONS），它不经过路由级中间件——preflight 保持未认证，这是刻意设计（预检请求不该触发鉴权）。当你的 preflight 需要自定义行为或守卫时，显式注册 OPTIONS 路由。详见 [路由章节](02-routing.md#方法不匹配405-与自动-options)。

## 完整示例

```ts
import { Zebra } from "@zebra-web/core";
import { cors } from "@zebra-web/cors";

const app = new Zebra();
app.use(cors({ origin: ["https://app.example.com"], credentials: true, maxAge: 86400 }));

app.get("/api/me", async (req) => {
  return { user: "zebra" };
});
```
