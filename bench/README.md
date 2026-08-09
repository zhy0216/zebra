# Zebra Benchmark

Zebra vs Hono vs Elysia — 路由吞吐 / 中间件链 / JSON 序列化对比，跑在真实 HTTP 服务器上（Bun `Bun.serve` + `fetch` 客户端并发打流，非 self-serving 计数）。

## 场景

| 场景 | 路径 | 说明 |
| --- | --- | --- |
| static | `/hello` | 静态路由，返回纯文本 |
| param | `/user/:id` | 参数路由，回显 `id` |
| wildcard | `/wild/a/b/c` | 通配路由，回显匹配尾巴 `a/b/c` |
| middleware | `/middleware` | 5 层中间件链 + 处理器 |
| json | `/json` | 返回 JSON 对象（`{"hello":"world","arr":[1..10]}`） |

三个框架注册完全相同的路由集（见 `zebra-bench.ts` / `hono-bench.ts` / `elysia-bench.ts`），响应体做了一致性校验（200 + body 断言），不通过直接报错，避免假数据。

## 结果

环境：macOS 26.5 (arm64, Apple Silicon 16 核) · Bun **1.3.14**（`bun --version` 记录）· 单进程本机回环 · 3s × 64 并发（`BENCH_DURATION_MS` / `BENCH_CONCURRENCY` 可调）· 2026-08-09。

吞吐 req/s（数字越高越好）：

| scenario | zebra | hono | elysia |
| --- | ---: | ---: | ---: |
| static | 73,189 | 104,540 | 109,682 |
| param | 71,933 | 100,580 | 104,199 |
| wildcard | 71,582 | 98,566 | 102,491 |
| middleware | 70,153 | 91,226 | 105,408 |
| json | 73,097 | 95,204 | 101,579 |

延迟（上一轮完整输出，p50/p95/p99 ms）：

| scenario | zebra p50/p95/p99 | hono p50/p95/p99 | elysia p50/p95/p99 |
| --- | ---: | ---: | ---: |
| static | 0.95 / 1.38 / 1.84 | 0.68 / 1.10 / 1.33 | 0.61 / 1.05 / 1.19 |
| param | 0.96 / 1.39 / 1.79 | 0.71 / 1.13 / 1.49 | 0.62 / 1.06 / 1.31 |
| wildcard | 0.98 / 1.42 / 1.91 | 0.71 / 1.12 / 1.41 | 0.63 / 1.08 / 1.35 |
| middleware | 1.02 / 1.48 / 1.95 | 0.78 / 1.17 / 1.51 | 0.63 / 1.07 / 1.33 |
| json | 0.98 / 1.43 / 1.90 | 0.75 / 1.16 / 1.48 | 0.66 / 1.10 / 1.44 |

结论：三框架在同一量级（5 万 ~ 11 万 req/s）。静态/参数/通配/JSON 场景 zebra 约为 hono 的 70~75%、elysia 的 65~70%；中间件链场景差距最小（zebra 为 hono 的 77%）。zebra 的 per-request 开销主要来自 DI 请求作用域创建与拆解、错误中间件包装；具体差异分析见下文。

> **中间件场景的可比性注意**：三框架的"5 层中间件"机制不完全等价——zebra 每请求走 compose 嵌套 + `withResolvedDeps` 扫描，hono 是预组合链（实测比 static 掉 ~11%），elysia 的 `onRequest` 是扁平 hook 链且**全局生效**（static 等场景也背着这 5 个钩子，实测近零成本）。因此 middleware 行的绝对数值不能跨框架直接解读，相对排序（zebra < hono < elysia）可信。

## 复现

```bash
# 1) 安装依赖（hono / elysia 作为 bench devDependencies，zebra 为 workspace 依赖）
bun install

# 2) 记录 Bun 版本
bun --version

# 3) 跑基准（默认 3s × 64 并发，可调）
bun run bench

# 或调参：
BENCH_DURATION_MS=2000 BENCH_CONCURRENCY=32 bun run bench
```

脚本会依次启动每个框架的 server（随机端口），对每个场景先做响应正确性校验，再 warmup 500ms、计时打流，最后输出每场景 req/s 与 p50/p95/p99 延迟汇总表。

### 实现说明

- `bench.ts`：驱动。设置 `NODE_ENV=production` 后动态 import 各框架 server，用 `fetch` 并发打流（keep-alive 复用连接），`performance.now()` 计延迟。
- `zebra-bench.ts` / `hono-bench.ts` / `elysia-bench.ts`：各自注册同一组路由；zebra 的中间件链用空前缀 `group` 挂 5 层 `use()`，hono 用 `app.use("/middleware", …)` × 5，elysia 用 5 个 `onRequest` 插件。
- 结果表格数字会随机器/Bun 版本浮动，更新方式：跑 `bun run bench`，把「Summary (req/s)」与延迟行贴回本文件。
