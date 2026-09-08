# 生命周期

Zebra 的生命周期分为三个事件钩子与一个显式的优雅停机过程。钩子在 `prepare()` / `listen()` / `stop()` 的固定时点触发。钩子本身是统一、类型安全、异步事件总线上的事件，该总线同样承载请求级与中间件级事件。

## 不创建监听器的准备阶段

`await app.prepare()` 是公开方法，供进程内 HTTP dispatch 使用。它运行 `boot`、校验
DI、编译路由计划并冻结注册，不打开端口、不安装信号处理器，也不触发 `ready`：

```ts
import { Zebra } from "@zebra-web/core"; // 也可从 @zebra-web/zebra 导入

const app = new Zebra();
app.get("/hello/:name", (req) => `hello, ${req.params.name}`);
await app.prepare();
try {
  const response = await app.dispatch(new Request("http://local/hello/zebra"));
  console.log(await response.json());
} finally {
  await app.stop();
}
```

`prepare(): Promise<void>` 在成功后幂等，并发调用等待同一次 boot。boot 或依赖图校验
失败会 reject；修正配置后可重试。请在准备前注册路由、依赖、中间件及生命周期钩子。
`listen()` 内含相同的准备过程；先成功 `prepare()` 再 listen 不会重复 boot，监听器
启动后才触发 `ready`。未创建 listener 也应调用 `stop()` 释放资源。此方法不提供
Node listener，也不让 `dispatch()` 处理 WebSocket 握手。

## 监听选项

`listen(options: ListenOptions)` 接受 `port`、`hostname`、HTTP `idleTimeout`（秒）、
`maxRequestBodySize`、`reusePort`、`tls` 及可选的 `websocket`。
`websocket: WsTransportOptions` 控制消息大小、WebSocket 空闲超时与发送背压，Zebra
仍管理回调与 data 分发。未设置的 transport 字段保持 Bun 默认值，详见
[WebSocket transport 选项](10-websockets.md#监听器-transport-选项) 和
[HTTP 大小限制](05-http.md)。

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

`LifecycleEvent = "boot" | "ready" | "shutdown"`，`on()` 返回 `this` 可链式调用，`prepare()` 或 `listen()` 之后注册生命周期钩子会抛错——请求、中间件和自定义事件在运行时仍可注册。

### 顺序

```
z.listen()
  ├─ [boot 钩子]（按注册顺序，全部 await）
  ├─ validateGraph：校验依赖图（未绑定 / 循环 / 作用域违规 → 抛错）
  ├─ 预编译路由执行计划，容器 freeze()
  ├─ Bun.serve() 开始监听
  └─ [ready 钩子]（按注册顺序，全部 await；任一个失败 → stop() 并抛出）

进程收到 SIGTERM / SIGINT（默认信号处理开启），或调用 z.stop()
  └─ [优雅停机]（见下）
      └─ [shutdown 钩子]（容器与所有实例释放之后）
```

### 语义要点

- **boot 钩子失败**：`listen()` 直接抛错，服务器不会启动。
- **ready 钩子失败**：自动 `stop()` 并抛出该错误——不会留下半启动的服务器。
- **shutdown 钩子**：在容器 dispose 之后运行。此时所有 singleton 实例已释放，适合做最后一类清理（关闭外部连接、刷缓冲）。注意不要在这里依赖容器。

## 事件总线

所有事件——生命周期、请求、中间件与自定义事件——都流经同一个异步 `EventBus`。它是类型安全的：每个事件**至多携带一个 payload**，无 payload 的事件用 `undefined` 表示，调用处无需传参。

```ts
z.on("user.created", (user) => {
  // user: { id: string; email: string }
});
await z.emit("user.created", { id: "u1", email: "a@example.com" });
z.off("user.created", handler);

z.once("boot", () => {});            // 只触发一次，随后自动退订
await z.emit("ready");               // undefined payload → 无需参数
```

语义要点：

- listener 按注册顺序执行并被**串行 await**；某个 listener 抛错（或返回 rejected Promise）会让当前 `emit()` reject，并停止后续 listener。
- `once()` listener 在触发前先退订——即使抛错也不会再次触发。
- `off()` 按原始 handler 移除，对 `once()` 注册的同样有效；同一事件同一 handler 重复注册会被去重。
- dispatch 前快照 listener 集合：listener 在 emit 过程中增删只影响下一次 emit。
- 没有 listener 时 `emit()` 立即返回，不吞错、也不隐式打印日志。

`z.events` 暴露同一个 `EventBus` 实例（`EventEmitter` 是它的兼容别名），并提供 `removeAllListeners()` / `listenerCount()`。

### 声明事件

Zebra **不**通过泛型传入事件类型。事件表是一个全局接口，可在任意 `.d.ts` 中扩展：

```ts
// zebra-events.d.ts
import type { UserCreated } from "./domain";

declare global {
  interface ZebraEvents {
    "user.created": UserCreated;
  }
}

export {};
```

之后 `z.on("user.created", ...)` 与 `z.emit("user.created", ...)` 即获得完整类型检查。拼错的事件名与不匹配的 payload 都会被 TypeScript 拒绝（`ZebraEvents` 没有字符串索引签名）。第三方中间件可用同样方式扩展 `ZebraMiddlewareEvents` 发布自己的事件。导出的 `ZebraEventMap` 是 `ZebraEvents` 的类型别名。

### 请求事件

```ts
z.on("before.request", ({ request, route }) => {
  // 路由匹配之后、进入 middleware/handler pipeline 之前
});
z.on("after.request", ({ response, duration }) => {
  // 最终响应生成之后（含 2xx/4xx/5xx）、dispatch 返回之前
});
z.on("request.error", ({ error, duration }) => {
  // 原始 pipeline 异常，尚未转换为 Problem+Json
});
```

请求失败时 `request.error` 与 `after.request` 都会触发（先 `request.error`，随后 `after.request` 携带 Problem+Json 响应）。事件 listener 抛错按普通 pipeline 错误处理：不会绕过现有 Problem+Json 错误中间件，也不会绕过请求超时语义。

### 中间件事件

```ts
z.on("before.middleware", ({ middleware, index }) => {});
z.on("after.middleware", ({ middleware, index, response, duration }) => {});
z.on("middleware.error", ({ middleware, index, error, duration }) => {});
```

按预编译 route plan 的顺序（`index`）逐个触发，`middleware` 是原始函数引用（不依赖不稳定的 `Function.name`）。包装器在 boot 时编译一次；没有 listener 时请求 pipeline 保持零开销 fast path。抛错的 `middleware.error` listener 永远不会掩盖原始中间件错误。

## 优雅停机 `stop()`

`z.stop()` 是幂等的（并发调用只执行一次），过程如下：

1. 标记 `stopped`，仅移除 Zebra 自己安装的信号处理器（若有），停止接受新连接（`Bun.serve.stop(false)`）。用户的信号监听器保持不变。
2. **等待在途请求排空**（`waitForDrain`），与 `gracePeriod`（默认 10 秒）赛跑：
   - 超时后强制 `server.stop(true)` 终止剩余连接。
3. 回收所有会话作用域容器（`disposeSession`，逐个）。
4. 释放根容器（所有 singleton 实例的 `dispose()`，LIFO 顺序）。
5. 运行 `shutdown` 钩子。

`ZebraOptions.signalHandlers?: boolean` 默认 `true`。省略或设为 `true` 时，
`listen()` 安装 SIGTERM / SIGINT 处理器，自动触发 `stop()`。无论如何配置，
`prepare()` 都不安装信号处理器。boot 或端口绑定失败时不安装；ready 钩子失败
仍会调用 `stop()`，清理 listener 和已安装的框架信号处理器，再抛出原 ready 错误。

```ts
await z.listen({ port: 3000 });
// 收到 SIGTERM 时自动执行上述停机流程
```

也可以手动调用：

```ts
await z.stop();
```

停止后应用不可再次 `listen()`（抛错 `Zebra has been stopped and cannot listen again`）。
即使清理出错，`stop()` 仍尝试会话释放、根容器释放和 shutdown 钩子，最后以原错误或
`AggregateError` reject。并发及后续调用观察同一份缓存结果，再次调用 `stop()` 不会
重试失败的清理。默认自动信号处理以 `[zebra] shutdown failed:` 打印失败，不设置退出码。
框架处理器在 `stop()` 开始时就被移除，因此清理期间的另一次信号可能触发运行时默认终止。

### 应用拥有信号

嵌入 Zebra、由应用协调关机时，使用 `new Zebra({ signalHandlers: false })`。
这个构造选项从 `@zebra-web/core` 与 `@zebra-web/zebra` 公开；此时 `listen()` 不安装
框架信号处理器，`stop()` 也不添加或移除应用的信号监听器。无需访问私有属性或删除
框架 listener。

应用负责注册自己的处理器、等待 `stop()` 和额外工作，并决定何时及如何退出。
使用 `process.on`，在整个关机期间保留处理器，把重复信号合并到同一个关机 Promise。
使用 `process.once` 或一开始就移除处理器，可能让下一次 SIGTERM 在异步清理完成前
终止进程。多个 Zebra 实例共享同一个应用关机所有者时，应逐个禁用框架信号处理。

```ts
import { Zebra } from "@zebra-web/core";
import { closePool, flushWithRetry } from "./resources.ts"; // 应用提供的函数

const app = new Zebra({ signalHandlers: false });
app.get("/", () => "ok");

async function shutdown() {
  const errors: unknown[] = [];
  try {
    await app.stop();
  } catch (error) {
    errors.push(error);
  }
  try {
    await flushWithRetry();
    await closePool();
  } catch (error) {
    errors.push(error);
  }
  if (errors.length) throw new AggregateError(errors, "Shutdown failed");
}

let stopping: Promise<void> | undefined;
function onSignal() {
  if (stopping) return;
  stopping = Promise.resolve().then(shutdown).then(
    () => { process.exit(0); },
    (error) => {
      console.error(error);
      process.exit(1);
    },
  );
}
process.on("SIGINT", onSignal);
process.on("SIGTERM", onSignal);
await app.listen({ port: 3000 });
```

示例记录 stop 失败后仍尝试应用 flush，只有 flush 成功才关闭 pool；stop、flush 或
pool 关闭失败都会导致非零退出。flush 重试、截止时间和失败策略由应用定义。
`stop()` *之后*仍需要的资源应放在 Zebra 会释放的 DI scope 之外。
`gracePeriod` 只限制 Zebra 的 drain，不限制额外的应用工作；后台任务需由应用按需
另行跟踪与等待。

## 会话作用域回收

会话容器（session 作用域 DI 的缓存容器）的生命周期：

- 会话解析器解析出 `sessionId` → 首次创建会话容器，记录活跃请求数。
- 活跃请求为 0 时启动一个 `sessionTtl`（默认 30 分钟）的空闲计时器；期间有请求回来则取消计时器。
- 计时器到期 → `disposeSession(id)`：清理计时器、dispose 容器（释放该会话的 session 作用域实例）。
- `app.disposeSession(id)` 可手动提前回收（比如登出时）。

> 数据层面的会话过期由 `@zebra-web/session` 的 store 负责（TTL 属主不同），core 的 `sessionTtl` 只回收 DI 容器。两者独立设计，见 [会话章节](07-sessions.md#ttl-归属)。

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
