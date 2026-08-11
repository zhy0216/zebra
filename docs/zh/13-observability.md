# 可观测性（@zebra/observability）

零依赖的可观测性中间件套件：request id、访问日志、错误上报、指标与健康检查。全部是纯中间件——不依赖 `@zebra/core` 之外的任何东西，也不自带 logger，**sink 由你提供**。

## 安装

```sh
bun add @zebra/observability
```

## 快速开始

```ts
import { Zebra } from "@zebra/core";
import { accessLog, errorReporter, health, metrics, requestId } from "@zebra/observability";

const app = new Zebra();

app.use(requestId()); // 必须最先注册：后面的中间件都靠 req.ctx 里的 id 关联
app.use(accessLog()); // 每请求一行 console.log
app.use(errorReporter((error, req, info) => {
  console.error("handler failed", error, info.requestId);
}));
const metricsHandle = metrics({ onSample: (s) => console.log(s) });
app.use(metricsHandle);
app.use(health({ readiness: () => db.ping() }));

app.get("/", () => Response.json({ ok: true }));
```

**中间件顺序很重要**：`requestId` 必须在 `accessLog` / `errorReporter` / `metrics` 之前，它们才能从 `req.ctx` 读到 id。健康探针是普通请求——把 `health` 放在栈内会让探针也被记录与计数。

## requestId

```ts
requestId({ headerName?, generator?, propagate? })
```

- 保留客户端传入的 `x-request-id`（或配置的 header 名），没有则生成一个（默认 `crypto.randomUUID`）。
- 存到 `req.ctx`（`REQUEST_ID_KEY`），`getRequestId(req)` 读取。
- `propagate: true`（默认）时把 id 回显到响应头。

```ts
import { getRequestId, requestId } from "@zebra/observability";

app.use(requestId({ headerName: "x-trace-id" }));
app.get("/", (req) => Response.json({ id: getRequestId(req) }));
```

> 注意：core 错误中间件产生的响应是在该中间件展开之后构建的，所以错误响应**不带** `x-request-id` 头——用访问日志 / 错误上报关联（它们看得到 id）。

## accessLog

```ts
accessLog({ writer? })
```

每个请求经 writer 输出一条记录（默认单行 `console.log`）：

```ts
interface AccessLogEntry {
  method: string;
  path: string;
  status: number | undefined; // handler 抛错时为 undefined
  durationMs: number;
  requestId: string | undefined;
  timestamp: number;          // epoch 毫秒
  error?: unknown;            // handler 抛错时设置
}
```

```ts
app.use(accessLog({ writer: (entry) => sink.write(JSON.stringify(entry)) }));
```

- 错误记录在条目上并**原样重抛**——core 仍会把它转成 Problem+Json。
- writer 抛错不会破坏请求（吞掉并 console.error）。

## errorReporter

```ts
errorReporter((error, req, info) => void)
```

在 `next()` 内部运行，因此在 core 错误中间件把错误转成 Problem+Json **之前**观察到抛出的错误。错误总是原样重抛，上报器抛错也永远不会掩盖原始错误：

```ts
app.use(errorReporter((error, req, info) => {
  sentry.captureException(error, { extra: info }); // { method, path, requestId }
}));
```

`info = { method, path, requestId }`（requestId 可能为 `undefined`——需要 `requestId` 中间件先行注册）。

## metrics

```ts
metrics({ onSample?, maxLatencySamples? })
```

计数器：请求总数、错误数（抛出或状态 ≥ 500）、在途并发（含峰值）、固定延迟直方图 + 有界采样窗口（p50/p95）。中间件对象本身就是句柄：

```ts
const m = metrics({ onSample: (s) => pushToPrometheus(s) });
app.use(m);

const snapshot = m.snapshot();
// {
//   totalRequests, errors, inFlight, peakInFlight,
//   latency: { bucketBoundsMs, buckets },
//   latencySamples, latencyP50, latencyP95
// }
```

- 直方图桶（ms）：`[5, 10, 25, 50, 100, 250, 500, 1000, 2500, 5000, ∞]`。
- 延迟采样上限 `maxLatencySamples`（默认 1000），内存有界；百分位是采样窗口上的 nearest-rank 估算。
- `onSample` 每个请求触发一次；抛错不会破坏请求。

## health

```ts
health({ path?, readinessPath?, liveness?, readiness? })
```

- 存活探针 `GET /healthz`（默认 `path`）、就绪探针 `GET /readyz`（默认 `readinessPath`）。
- 健康 → `{"status":"ok"}` / 200；不健康 → `{"status":"unavailable"}` / 503。
- 探针是用户回调（默认恒健康）；抛错的探针视为不健康（并记录日志）——**健康端点永远有答案**，负载均衡器总能拿到决策。
- 其他路径原样透传。

```ts
app.use(health({
  readiness: async () => (await db.ping()) === "OK",
  liveness: () => true,
}));
```

## 组合示例（生产级）

```ts
app.use(requestId());
app.use(accessLog());
app.use(errorReporter((err, req, info) => log.error(err, info)));
const metricsHandle = metrics();
app.use(metricsHandle);
app.use(health({ readiness: () => dbHealthy() }));

// 定期把指标推给 Prometheus / 拉取端点
setInterval(() => push(metricsHandle.snapshot()), 10_000);
```
