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
| di | `/di` | 路由 DI 依赖解析（zebra 走 container；hono/elysia 无 DI，直接返回同 body 的 JSON） |
| static-file | `/static/hello.txt` | 真实文件静态服务（zebra `app.static()`，hono/elysia `Bun.file` handler） |
| post-json | `/post-json` (POST) | JSON body 解析后回显（zebra `req.json()`；hono `c.req.json()`；elysia 自动 body 解析） |

三个框架注册完全相同的路由集（见 `zebra-bench.ts` / `hono-bench.ts` / `elysia-bench.ts`），响应体做了一致性校验（200 + body 断言），不通过直接报错，避免假数据。

## 结果

环境：macOS 26.5 (arm64, Apple Silicon 16 核) · Bun **1.3.14**（`bun --version` 记录）· **elysia 1.4.29 / hono 4.13.1**（`bench/package.json` 精确锁版，结果随版本漂移时以锁定版本为准）· 单进程本机回环 · 1.5s × 64 并发（`BENCH_DURATION_MS` / `BENCH_CONCURRENCY` 可调）· 2026-08-09（zero-cost fast path 之后；下表数字先于版本锁定与中位数测量法，仅作历史参考）。

吞吐 req/s（数字越高越好）：

| scenario | zebra | hono | elysia |
| --- | ---: | ---: | ---: |
| static | 75,599 | 103,931 | 107,089 |
| param | 75,072 | 102,000 | 109,834 |
| wildcard | 75,498 | 100,944 | 108,505 |
| middleware | 73,650 | 93,832 | 106,666 |
| json | 74,230 | 92,524 | 104,653 |
| di | 70,310 | 78,802 | 103,118 |
| static-file | 31,296 | 37,037 | 39,962 |

延迟（完整输出，p50/p95/p99 ms，zebra）：

| scenario | zebra p50/p95/p99 |
| --- | ---: |
| static | 0.91 / 1.35 / 1.73 |
| param | 0.92 / 1.34 / 1.67 |
| wildcard | 0.94 / 1.34 / 1.65 |
| middleware | 0.96 / 1.35 / 1.65 |
| json | 0.94 / 1.37 / 1.67 |
| di | 1.01 / 1.41 / 1.73 |
| static-file | 2.39 / 3.00 / 3.41 |

zero-cost fast path 对比（改造前 / 后，zebra，1.5s × 64）：

| scenario | rps 前 → 后 | p95 前 → 后 |
| --- | ---: | ---: |
| static | 72,121 → 75,599 | 1.39 → 1.35 |
| param | 70,158 → 75,072 | 1.42 → 1.34 |
| wildcard | 71,964 → 75,498 | 1.39 → 1.34 |
| middleware | 67,842 → 73,650 | 1.45 → 1.35 |
| json | 70,564 → 74,230 | 1.41 → 1.37 |

无 DI 的常规路由不再创建 Container child scope，`withResolvedDeps` 的 per-request 扫描/包装移到 boot 期预编译，因此吞吐整体提升约 5~9%、p95 下降 0.04~0.10ms；middleware 场景收益最大（+8.6%）。

> **中间件场景的可比性注意**：三框架的"5 层中间件"机制不完全等价——zebra 每请求走 compose 嵌套，hono 是预组合链，elysia 的 `onRequest` 是扁平 hook 链且**全局生效**（static 等场景也背着这 5 个钩子，实测近零成本）。因此 middleware 行的绝对数值不能跨框架直接解读，相对排序（zebra < hono < elysia）可信。
>
> **static-file 场景的可比性注意**：功能不等价——zebra 走完整的 `app.static()`（路径穿越/symlink 逃逸防护、weak ETag、条件请求、Range、缓存），hono/elysia 是裸 `Bun.file` handler，无任何安全检查。该行数字是"完整实现 vs 最小实现"的对比，不是同功能对比。

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

# 4) 性能回归门槛（zebra-only，默认 1s × 64 × 3 次取中位数，阈值：rps ≥ 基线 80% 且 p95 ≤ 基线 125%；已接入 CI）
bun run bench:check

# 有意的性能改动后重录基线：
BENCH_DURATION_MS=3000 bun run bench/bench-regression.ts --update
```

脚本会依次启动每个框架的 server（随机端口），对每个场景先做响应正确性校验，再 warmup 500ms、计时打流，最后输出每场景 req/s 与 p50/p95/p99 延迟汇总表。

### 实现说明

- `bench.ts`：驱动。设置 `NODE_ENV=production` 后动态 import 各框架 server，用 `fetch` 并发打流（keep-alive 复用连接），`performance.now()` 计延迟。
- `runner.ts`：打流与场景校验的共享实现，`bench.ts` 与 `bench-regression.ts` 共用。
- `bench-regression.ts` + `baseline.json`：zebra-only 回归门槛，CI 可用；`--update` 重录基线。
- `zebra-bench.ts` / `hono-bench.ts` / `elysia-bench.ts`：各自注册同一组路由；zebra 的中间件链用空前缀 `group` 挂 5 层 `use()`，hono 用 `app.use("/middleware", …)` × 5，elysia 用 5 个 `onRequest` 插件。
- 结果表格数字会随机器/Bun 版本浮动，更新方式：跑 `bun run bench`，把「Summary (req/s)」与延迟行贴回本文件。
