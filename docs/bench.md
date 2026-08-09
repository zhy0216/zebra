# Benchmark

Zebra vs Hono vs Elysia 基准：路由吞吐（静态/参数/通配）、中间件链、JSON 序列化。

完整脚本与复现说明见 [`bench/README.md`](../bench/README.md)。

## 结果（req/s，越高越好）

环境：macOS 26.5 (arm64, 16 核) · Bun 1.3.14 · 3s × 64 并发。

| scenario | zebra | hono | elysia |
| --- | ---: | ---: | ---: |
| static | 73,189 | 104,540 | 109,682 |
| param | 71,933 | 100,580 | 104,199 |
| wildcard | 71,582 | 98,566 | 102,491 |
| middleware | 70,153 | 91,226 | 105,408 |
| json | 73,097 | 95,204 | 101,579 |

三框架同一量级；zebra 各场景约为 hono 的 70~77%、elysia 的 65~70%。

## 复现

```bash
bun install
bun --version
bun run bench
```

调参：`BENCH_DURATION_MS` / `BENCH_CONCURRENCY` 环境变量。
