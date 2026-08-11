# 生命周期

Zebra 的生命周期分为三个事件钩子与一个显式的优雅停机过程。所有钩子在 `listen()` / `stop()` 的固定时点触发。

## 事件钩子

```ts
z.on("boot", async () => {
  // 图校验与路由计划编译之前
});

z.on("ready", async () => {
  // 服务器已开始接受连接之后
});

z.on("shutdown", async () => {
  // 优雅停机完成、容器释放之后
});
```

`LifecycleEvent = "boot" | "ready" | "shutdown"`，`on()` 返回 `this` 可链式调用，`listen()` 之后注册钩子会抛错。

### 顺序

```
z.listen()
  ├─ [boot 钩子]（按注册顺序，全部 await）
  ├─ validateGraph：校验依赖图（未绑定 / 循环 / 作用域违规 → 抛错）
  ├─ 预编译路由执行计划，容器 freeze()
  ├─ Bun.serve() 开始监听
  └─ [ready 钩子]（按注册顺序，全部 await；任一个失败 → stop() 并抛出）

进程收到 SIGTERM / SIGINT（或调用 z.stop()）
  └─ [优雅停机]（见下）
      └─ [shutdown 钩子]（容器与所有实例释放之后）
```

### 语义要点

- **boot 钩子失败**：`listen()` 直接抛错，服务器不会启动。
- **ready 钩子失败**：自动 `stop()` 并抛出该错误——不会留下半启动的服务器。
- **shutdown 钩子**：在容器 dispose 之后运行。此时所有 singleton 实例已释放，适合做最后一类清理（关闭外部连接、刷缓冲）。注意不要在这里依赖容器。

## 优雅停机 `stop()`

`z.stop()` 是幂等的（并发调用只执行一次），过程如下：

1. 标记 `stopped`，移除信号处理器，停止接受新连接（`Bun.serve.stop(false)`）。
2. **等待在途请求排空**（`waitForDrain`），与 `gracePeriod`（默认 10 秒）赛跑：
   - 超时后强制 `server.stop(true)` 终止剩余连接。
3. 回收所有会话作用域容器（`disposeSession`，逐个）。
4. 释放根容器（所有 singleton 实例的 `dispose()`，LIFO 顺序）。
5. 运行 `shutdown` 钩子。

进程信号（SIGTERM / SIGINT）自动触发 `stop()`——部署平台（如 Railway / Fly / K8s）发 SIGTERM 时应用会优雅排空，而不是立即被杀。

```ts
await z.listen({ port: 3000 });
// 收到 SIGTERM 时自动执行上述停机流程
```

也可以手动调用：

```ts
const server = await z.listen({ port: 3000 });
process.on("SIGUSR2", () => void z.stop());
```

停止后应用不可再次 `listen()`（抛错 `Zebra has been stopped and cannot listen again`）。

## 会话作用域回收

会话容器（session 作用域 DI 的缓存容器）的生命周期：

- 会话解析器解析出 `sessionId` → 首次创建会话容器，记录活跃请求数。
- 活跃请求为 0 时启动一个 `sessionTtl`（默认 30 分钟）的空闲计时器；期间有请求回来则取消计时器。
- 计时器到期 → `disposeSession(id)`：清理计时器、dispose 容器（释放该会话的 session 作用域实例）。
- `app.disposeSession(id)` 可手动提前回收（比如登出时）。

> 数据层面的会话过期由 `@zebra/session` 的 store 负责（TTL 属主不同），core 的 `sessionTtl` 只回收 DI 容器。两者独立设计，见 [会话章节](07-sessions.md#ttl-归属)。

## 释放（Disposable）

实现 `Disposable` 的实例（`dispose(): Promise<void>`）在作用域结束自动释放：

- request 作用域 → 请求结束（无论成功失败）
- session 作用域 → 会话回收 / `disposeSession(id)`
- singleton → `stop()`

释放是 LIFO（依赖先于被依赖者），且单次释放失败不阻止其余释放（错误汇总后抛出）。

## 下一步

- [DI：作用域与释放细节](03-di.md)
- [会话：cookie 会话与 TTL 归属](07-sessions.md)
- [生产部署：停机与健康检查](15-production.md)
