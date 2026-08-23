# 部署与发布

本章覆盖 Zebra 的生产部署要点、发布/打包策略与性能基准。

## 部署

### 运行

Zebra 是 Bun-first 的：生产环境用 Bun 直接跑源码即可，**不需要构建步骤**。

```sh
# Dockerfile（示意）
FROM oven/bun:1.4
WORKDIR /app
COPY package.json bun.lock ./
RUN bun install --production
COPY src ./src
EXPOSE 3000
CMD ["bun", "run", "src/main.ts"]
```

### 生产建议

- **`NODE_ENV=production`**：benchmark 场景也在 production 模式下跑。
- **健康检查**：挂 `@zebra-web/observability` 的 `health()`（`/healthz` 存活 + `/readyz` 就绪），让负载均衡器拿到决策（见 [可观测性](13-observability.md)）。
- **优雅停机**：`SIGTERM` / `SIGINT` 自动触发 `z.stop()` —— 排空在途请求（`gracePeriod` 内，默认 10s），再释放容器、跑 `shutdown` 钩子（见 [生命周期](06-lifecycle.md)）。
- **请求超时**：`requestTimeout` 为单请求设置截止时间，超时返回 504 `request_timeout`（见 [HTTP](05-http.md#请求超时)）。
- **代理部署**：若你的反向代理会**覆盖** `x-forwarded-for`，开 `trustProxy: true` 让限流按真实客户端 IP 计（否则客户端可伪造自己的额度）。`req.ip` 永远来自 socket 对端，与 `trustProxy` 无关。
- **多实例**：会话与限流的进程内 `MemoryStore` 不跨实例共享——多副本部署用 `@zebra-web/redis` 的 `RedisSessionStore` / `RedisRateLimitStore`（见 [Redis](14-redis.md)）。
- **会话 cookie**：生产环境用 `cookie: { preset: "secure" }`（`HttpOnly` + `SameSite=Lax`）。

## 发布策略：src 直发

所有包**直接发布 `src`**：

- `main` / `types` / `exports["."]` 都指向 `./src/index.ts`。
- tarball 只带 `src/`（`files: ["src"]`），**不发布 `dist/`**。
- 发布时**无构建步骤**——消费者拿到 TypeScript 源码，Bun 原生跑 TS；bundler 解析的消费者拿到同样的文件。

```sh
bun run build   # 产出 dist/（--target bun --packages external），给 bundle/edge 消费者
# dist/ 不进发布 tarball
```

### 锁步版本

所有包版本锁步递增，由 `scripts/release.ts` 处理：

```sh
bun run release -- --version 1.0.0 --registry https://registry.npmjs.org
```

该脚本：校验 SemVer → 扫描 Conventional Commits（`feat` / `fix` / `docs` ...）→ 统一 bump 所有包版本 → 生成 [CHANGELOG](../../CHANGELOG.md) 分类章节。

### 发布前冒烟测试

```sh
bun run verify:packages
```

对每个可发布包（`packages/` 下非 `private` 的）：

1. `bun pm pack` 打包；
2. 校验 tarball 内容（`src/index.ts` 存在、无 `dist/` 泄漏、`main`/`types`/`exports` 引用的路径都在）；
3. 装进一个全新的临时项目，逐个验证：resolved、runtime import、`tsgo` typecheck。

这守护了 src-direct 策略——tarball 只带 `src/`，且 exports map 必须能从干净安装工作。

## 性能基准

`bench/` 在**真实 HTTP 服务器**上对比 Zebra vs Hono vs Elysia（Bun `Bun.serve` + `fetch` 客户端并发打流，非 self-serving 计数；响应体做一致性校验，防止假数据）。

```sh
bun run bench            # 全量对比
bun run bench:check      # 回归检查（对比 baseline.json）
```

场景：static / param / wildcard / middleware（5 层链）/ json / di / static-file / post-json。

当前 zebra 结果（本机：macOS arm64 16 核，Bun 1.4.0——`bun --version` 报告 `1.4.0`——单进程本机回环，3000ms × 64 并发，3 次取中位数，通过 `BENCH_DURATION_MS=3000 bun run bench/bench-regression.ts --update` 录制）：

| scenario | req/s | p95 (ms) |
| --- | ---: | ---: |
| static | 86,364 | 1.21 |
| param | 84,332 | 1.24 |
| wildcard | 82,662 | 1.27 |
| middleware | 78,242 | 1.32 |
| json | 80,250 | 1.31 |
| di | 78,454 | 1.34 |
| static-file | 32,700 | 2.97 |
| post-json | 26,732 | 3.69 |

跨框架对比数字（Hono / Elysia）与 2026-08-09 zero-cost fast path 时的早期测量（Bun 1.3.14）在 [bench/README](../../bench/README.md) 中仅作历史参考——请在你当前的 Bun 上重跑 `bun run bench` 复现。

关键优化：**zero-cost fast path** —— 无 DI 依赖、无 session resolver 的路由不创建 Container 子作用域；中间件依赖扫描与包装移到 boot 期预编译。当时测得整体吞吐 +5~9%、p95 下降 0.04~0.10ms（middleware 场景收益最大 +8.6%）。

> **可比性注意**：三框架的「5 层中间件」机制不完全等价（zebra 每请求 compose 嵌套、hono 预组合链、elysia 扁平 hook 且全局生效），middleware 行的绝对数值不能跨框架直接解读；相对排序（zebra < hono < elysia）可信。

完整数据与复现方式见 [bench/README](../../bench/README.md)。

## 工具链

```sh
bun test                 # 测试（bun:test）
bun run typecheck        # 全 workspace typecheck
bun run lint             # biome check
bun run format           # biome format --write
bun run build            # dist/ 产出（不进 tarball）
bun run verify:packages  # tarball 冒烟测试
bun run release -- --version X.Y.Z --registry https://registry.npmjs.org  # dry-run
bun run release -- --version X.Y.Z --registry https://registry.npmjs.org --publish
```

## 下一步

- [API 冻结与 SemVer 策略](api-freeze.md)
- [生命周期：优雅停机细节](06-lifecycle.md)
- [Redis：多实例存储](14-redis.md)
