difficulty: medium

# 修正指标分位数、容量与健康方法匹配

优先级：P2

来源：plan.md F26、F27、F28

执行模型：flash

前置依赖：无

## T1 · 落实 nearest-rank 和有界样本容量

要做什么：percentile使用nearest-rank的ceil语义；验证maxLatencySamples是有效有限整数，0的行为以已有文档/测试为准。保留bounded window和snapshot副本语义，不扩大为新的统计系统。

预计修改文件（本任务共享范围）：

- `packages/observability/src/metrics.ts`
- `packages/observability/src/health.ts`
- `packages/observability/test/metrics.test.ts`
- `packages/observability/test/health.test.ts`

验收条件：确定性样本1..11的P95=11；空集/单值/P50正确；NaN/Infinity/非法容量初始化失败；合法容量下1100次请求样本数不越界。

前置依赖：无。

## T2 · 健康探针只匹配约定方法

要做什么：health中间件按path和method路由，保留GET探针和明确HEAD行为；POST/PUT等透传。

预计修改文件（本任务共享范围）：

- `packages/observability/src/metrics.ts`
- `packages/observability/src/health.ts`
- `packages/observability/test/metrics.test.ts`
- `packages/observability/test/health.test.ts`

验收条件：GET健康/不健康分别200/503；POST /healthz、PUT /readyz能到达next和相同路径的业务handler；HEAD行为有明确定义且无body；现有日志/metrics集成仍通过。

前置依赖：无；与本文件前面条目一起完成、一起提交。

## 校验

```sh
bun test packages/observability
bun run typecheck
bun run lint
```

按 plan 的公共约束保留 v1 API 与现有正常路径。只改本任务拥有的文件；需要扩大范围时先协调依赖。
