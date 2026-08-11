# 路由

Zebra 的路由基于 radix 树实现：静态段用 `Map` 精确匹配，`/:name` 是单段参数，`/*rest` 是贪婪通配符。匹配本身不做任何字符串拼接或正则，查找速度快且稳定。

## 注册方法

所有 HTTP 方法都有同名快捷方法，签名一致：

```ts
z.get(path, handler);
z.get(path, { deps }, handler); // 带命名对象 DI 依赖

z.post(...);
z.put(...);
z.patch(...);
z.delete(...);
z.head(...);
z.options(...);

// 通用入口（第一个参数是方法名）
z.route("GET", path, handler);
```

`get` / `post` 等的重载自动推断 `req.params` 的精确类型：

```ts
z.get("/users/:id", async (req) => {
  req.params.id; // string —— 由路径字面量推断
});

z.get("/users/:id/posts/:postId", async (req) => {
  req.params.id;       // string
  req.params.postId;   // string
});
```

## 路径参数

| 语法 | 匹配 | 示例 |
| --- | --- | --- |
| `:name` | 单个路径段 | `/users/:id` → `/users/42` |
| `*name` | 贪婪匹配剩余路径（含 `/`） | `/files/*path` → `/files/a/b.txt` |

```ts
z.get("/files/*path", async (req) => {
  req.params.path; // "a/b.txt"（路径参数是解码后的原文，不含前导斜杠的段首）
});
```

重复注册完全相同的 `方法 + 路径`（参数布局一致）会抛出 `Duplicate route` 错误 —— 在启动时（`listen`）而不是请求时暴露。

## 方法不匹配：405 与自动 OPTIONS

路径存在但方法不匹配时，Zebra 返回 RFC 规范的行为：

- **405 Method Not Allowed**，Problem+Json 响应带 `Allow` 头（列出该路径支持的方法）。
- 对已知路径的 **OPTIONS** 请求自动应答 `204` + `Allow` 头（无需注册 OPTIONS 路由）。

```sh
curl -i -X POST http://localhost:3000/hello/world   # 若只有 GET 注册
# HTTP/1.1 405 Method Not Allowed
# allow: GET, HEAD
```

两点说明：

- `HEAD` 隐含支持 GET：未注册 HEAD 路由时，HEAD 请求回落到 GET handler，响应体被剥离，状态与头保留。
- 自动 OPTIONS 应答运行在**终端 handler** 里，因此不会经过路由级中间件（比如鉴权守卫）——preflight 请求保持未认证。需要自定义 preflight 时显式注册 OPTIONS 路由。

## 分组 `app.group()`

`group` 给一组路由加上公共前缀，并可作用域化中间件：

```ts
z.group("/blogs", (g) => {
  g.use(requireAuth());          // 组内中间件：仅对组内路由生效
  g.get("/", async () => listBlogs());
  g.get("/:id", async (req) => getBlog(req.params.id));
});
```

- 前缀可以嵌套：`g.group("/sub", ...)` 会拼成 `/blogs/sub/...`。
- 组内路由的中间件 = 全局中间件 + 祖先组中间件 + 组内中间件（按注册顺序）。
- 组的类型是 `GroupApi`，其 `get`/`post` 等方法的路径参数类型会把前缀合并进来（`JoinPath`）。

## 静态文件 `app.static()`

```ts
z.static("/", new URL("../public", import.meta.url).pathname);
```

`app.static(routePath, root, opts)` 注册两个 GET 路由（前缀本身 + `/*file`），服务 `root` 目录下的文件：

- 默认 `index` 为 `index.html`，`maxAge` 为 `3600`（`Cache-Control: public, max-age=...`）。
- 内置安全防护：路径穿越（`..`）与符号链接逃逸（realpath 包含性检查）都会被拒绝（403）。
- 弱 ETag、条件请求（`If-None-Match` → 304）、字节范围（`Range` → 206 / 416）。
- 元数据缓存（`cacheTtl`，默认 1000ms）跳过热路径上的 `statSync`；命中缺失永不缓存，新建文件立即可见。

```ts
z.static("/assets", "./public/assets", { maxAge: 86400, cacheTtl: 0 });
```

## 路由表（内省）

`app.routeTable` 返回已注册路由的**冻结副本**（方法、路径、依赖声明、中间件、可选的契约 def），供 OpenAPI / 内省工具使用：

```ts
for (const route of z.routeTable) {
  console.log(route.method, route.path);
}
```

## 零成本快速路径

路由在 `listen()` 时被预编译成执行计划（`RoutePlan`）：

- 不含 DI 依赖、不含 session resolver 的路由走**零成本快速路径**：不创建 Container 子作用域，中间件数组原样执行，handler 拿到 `{}`。
- 含依赖的链只需在启动时计算一次「哪些中间件要解析依赖」，运行时按预计算下标包装，不做逐请求扫描。

这意味着：**纯路由 + 中间件的应用没有 request scope 开销**，只有真正声明了依赖或配置了 session 的链才创建子作用域。

## 时序与约束

- 路由/中间件/依赖都必须在 `listen()` 之前注册；`listen()` 后调用 `z.get(...)`、`z.use(...)`、`z.inject*(...)` 会抛错（`Cannot register ... after app.listen()`）。
- 匹配不到任何路径 → 404 Problem+Json（`not_found`）。

## 下一步

- [依赖注入：路由的 `{ deps }` 声明与 scope](03-di.md)
- [中间件：`app.use` 全局链与组作用域](04-middleware.md)
- [HTTP：请求/响应/错误](05-http.md)
