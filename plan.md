# Zebra 事件系统实现计划

## 目标

在 `@zebra/core` 中引入一个统一、异步、类型安全的事件系统，并保持现有生命周期 API 兼容：

```ts
const app = new Zebra();

app.on("ready", () => {});
app.on("user.created", (payload) => {});
app.once("order.paid", (payload) => {});
app.off("user.created", handler);

await app.emit("user.created", payload);
```

用户不需要通过 `new Zebra<Events>()` 传入事件类型。事件类型通过全局接口扩展：

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

## 设计约束

### 1. 单 payload

每个事件最多接收一个 payload。无 payload 的事件使用 `undefined` 表示，并在调用层面省略参数：

```ts
interface ZebraEvents {
  ready: undefined;
  "user.created": UserCreated;
}

app.emit("ready");
app.emit("user.created", user);
```

以下情况必须由 TypeScript 拒绝：

- 未声明的事件名；
- payload 类型不匹配；
- listener 参数类型不匹配；
- 无 payload 事件传入额外参数。

### 2. 全局接口扩展，不使用 Zebra 泛型

在 core 中声明可扩展的全局接口。middleware 的内置事件也放在 `ZebraMiddlewareEvents` 中，再由 `ZebraEvents` 继承：

```ts
declare global {
  interface ZebraMiddlewareEvents {
    "before.middleware": BeforeMiddlewareEvent;
    "after.middleware": AfterMiddlewareEvent;
    "middleware.error": MiddlewareErrorEvent;
  }

  interface ZebraEvents extends ZebraMiddlewareEvents {
    boot: undefined;
    ready: undefined;
    shutdown: undefined;
    "before.request": BeforeRequestEvent;
    "after.request": AfterRequestEvent;
    "request.error": RequestErrorEvent;
  }
}
```

用户和第三方包可以通过 `declare global` 添加自定义事件，而不需要修改 Zebra core。不要给 `ZebraEvents` 增加字符串索引签名，否则任意拼写错误的事件名都会被 TypeScript 接受。

全局接口本身用于 declaration merging；如果 TypeScript 模块导出规则不允许直接导出同名 global interface，则导出 `ZebraEventMap` 作为它的类型别名，不要复制出第二张事件表。建议导出以下类型，方便用户声明 payload：

- `ZebraEventMap`（`ZebraEvents` 的导出别名）；
- `ZebraMiddlewareEvents`；
- `BeforeRequestEvent`；
- `AfterRequestEvent`；
- `RequestErrorEvent`；
- `BeforeMiddlewareEvent`；
- `AfterMiddlewareEvent`；
- `MiddlewareErrorEvent`。

### 3. 公共 API

`Zebra` 保留现有 `app.on("boot" | "ready" | "shutdown", fn)` 行为，并新增同一套 API。建议先定义以下工具类型：

```ts
type Awaitable<T> = T | Promise<T>;
type EventPayload<Events, K extends keyof Events> = Events[K];
type EventArgs<Payload> = [Payload] extends [undefined]
  ? []
  : [payload: Payload];
type EventHandler<Payload> = (...args: EventArgs<Payload>) => Awaitable<void>;
```

实际 API：

```ts
on<K extends keyof ZebraEvents & string>(event: K, handler: EventHandler<ZebraEvents[K]>): this;
once<K extends keyof ZebraEvents & string>(event: K, handler: EventHandler<ZebraEvents[K]>): this;
off<K extends keyof ZebraEvents & string>(event: K, handler: EventHandler<ZebraEvents[K]>): this;
emit<K extends keyof ZebraEvents & string>(
  event: K,
  ...args: EventArgs<ZebraEvents[K]>
): Promise<void>;
```

实际类型签名需要用条件类型区分 `undefined` payload，确保无 payload 事件不要求传 `undefined`，也不允许传其他值。

建议同时导出独立的 `EventBus`，供第三方包复用。`EventBus` 使用同样的单 payload 类型模型，不要退化成 `(...args: any[])`：

```ts
export class EventBus<Events> {
  on<K extends keyof Events & string>(event: K, handler: EventHandler<Events[K]>): this;
  once<K extends keyof Events & string>(event: K, handler: EventHandler<Events[K]>): this;
  off<K extends keyof Events & string>(event: K, handler: EventHandler<Events[K]>): this;
  emit<K extends keyof Events & string>(event: K, ...args: EventArgs<Events[K]>): Promise<void>;
  removeAllListeners<K extends keyof Events & string>(event?: K): this;
  listenerCount<K extends keyof Events & string>(event: K): number;
}
```

如果提供别名，使用 `EventEmitter` 作为 `EventBus` 的兼容别名即可，不要引入 Node `events` 依赖。

### 4. 监听器语义

- listener 按注册顺序执行；
- `emit()` 顺序等待每个同步/异步 listener；
- listener 抛错或返回 rejected Promise 时，当前 `emit()` reject，并停止后续 listener；
- `once()` listener 第一次触发前移除，listener 即使抛错也不会再次触发；
- `off()` 使用原始 handler 移除；对 `once()` 注册的 handler 也必须有效；
- 同一个 event 的同一个 handler 建议去重，避免重复注册；
- dispatch 前复制 listener 集合，listener 内部增删监听器只影响下一次 emit；
- 没有 listener 时 `emit()` 快速返回，不创建多余对象；
- `emit()` 不吞错，也不隐式打印日志。

## 内置事件

### 生命周期

保留当前生命周期顺序和失败语义：

```ts
"boot"     // listen() 中，依赖图校验和 route plan 编译之前
"ready"    // Bun.serve() 成功启动后
"shutdown" // drain、session/container dispose 完成后
```

现有生命周期测试必须继续通过：

- boot listener 按注册顺序运行；
- ready listener 按注册顺序运行；
- ready listener 失败会触发 stop 并重新抛错；
- shutdown listener 在 container dispose 后运行；
- `listen()` 后注册生命周期 listener 仍然抛错；
- `app.on()` 仍然返回 `app`，支持链式调用。

建议将现有 `hooks: Record<LifecycleEvent, LifecycleHandler[]>` 替换为统一 `EventBus<ZebraEvents>`，不要再维护第二套生命周期 listener 存储。

由于 `ZebraEvents` 是全局可扩展接口，内部实现不要把它复制成另一个静态 event map；`AppInternals` 和 `Zebra.on/once/off/emit` 都应引用同一套 `ZebraEvents` 类型。除非确实需要绕过 app facade，否则不必公开可变的 `app.events` 属性，以免绕过生命周期注册冻结规则。

### 请求事件

第一版加入以下事件：

```ts
interface BeforeRequestEvent {
  readonly request: ZebraRequest;
  readonly route: RegisteredRoute | undefined;
}

interface AfterRequestEvent {
  readonly request: ZebraRequest;
  readonly route: RegisteredRoute | undefined;
  readonly response: Response;
  readonly duration: number;
}

interface RequestErrorEvent {
  readonly request: ZebraRequest;
  readonly route: RegisteredRoute | undefined;
  readonly error: unknown;
  readonly duration: number;
}
```

触发点建议如下：

1. `before.request`：已构造 `ZebraRequest`、已完成路由查找、正式进入 middleware/handler pipeline 之前；
2. `after.request`：pipeline 最终得到 `Response` 之后，`dispatch()` 返回之前；
3. `request.error`：pipeline 抛出异常时触发一次，之后继续交给现有 error middleware 转换为 Problem+Json。

`after.request` 应覆盖 2xx、4xx、5xx 等最终响应；`request.error` 表示原始异常，两者可以针对同一请求先后触发。

请求事件 listener 抛错时，按普通 pipeline 错误处理，不能绕过现有 Problem+Json 和 request timeout 语义。

### Middleware 事件

声明独立的 middleware 事件接口，并将其并入 `ZebraEvents`：

```ts
interface BeforeMiddlewareEvent {
  readonly request: ZebraRequest;
  readonly middleware: Middleware;
  readonly index: number;
}

interface AfterMiddlewareEvent {
  readonly request: ZebraRequest;
  readonly middleware: Middleware;
  readonly index: number;
  readonly response: Response;
  readonly duration: number;
}

interface MiddlewareErrorEvent {
  readonly request: ZebraRequest;
  readonly middleware: Middleware;
  readonly index: number;
  readonly error: unknown;
  readonly duration: number;
}
```

内置事件名：

```ts
"before.middleware"
"after.middleware"
"middleware.error"
```

触发要求：

- 每个 middleware 执行前触发 `before.middleware`；
- middleware 成功返回后触发 `after.middleware`；
- middleware 抛错时触发 `middleware.error`，然后继续原有错误处理；
- `index` 对应预编译 route plan 中的 middleware 顺序；
- `middleware` 使用原始函数引用，不依赖不稳定的 `Function.name`；
- 没有对应 listener 时尽量走零额外开销路径；
- 不要为每个请求向全局 bus 注册 listener，避免 listener 泄漏。

实现方式可在 route plan 预编译阶段为 middleware 创建包装器，而不是在每个请求中重复扫描和拼接 middleware。

第三方 middleware 可以扩展 `ZebraMiddlewareEvents`：

```ts
declare global {
  interface ZebraMiddlewareEvents {
    "auth.denied": {
      requestId: string;
      reason: string;
    };
  }
}
```

第三方 middleware 自定义事件可以通过 app 事件总线发布；不要让 middleware 在每个请求中调用 `on()` 注册全局 listener。

## 自定义事件

用户可以在任意 `.d.ts` 文件中扩展：

```ts
declare global {
  interface ZebraEvents {
    "user.created": {
      id: string;
      email: string;
    };
  }
}

export {};
```

然后直接使用：

```ts
const handler = (user: { id: string; email: string }) => {
  // ...
};

app.on("user.created", handler);
await app.emit("user.created", { id: "u1", email: "a@example.com" });
app.off("user.created", handler);
```

不要给 `on/once/off/emit` 添加 `event: string` 的兜底重载，否则未知事件会失去类型检查。

## 请求上下文与 Middleware 发布事件

第一版优先保证 middleware 自动生命周期事件和 `app.emit()` 能力。不要把可注册的全局 `on()` 暴露到每个 request 对象上，因为这很容易造成每请求一次的 listener 泄漏。

如果确实需要让可复用 middleware 在不捕获 app 的情况下发布事件，提供只包含 `emit()` 的发布器接口，而不是完整 EventBus：

```ts
interface EventPublisher<Events> {
  emit<K extends keyof Events>(event: K, payload: EventPayload<K>): Promise<void>;
}
```

该 publisher 可以作为 `ZebraRequest` 的只读属性或 middleware helper 的显式依赖注入；实现时二选一，优先选择不改变现有 `ZebraRequest` 热路径布局的方案。

## 建议改动文件

### Core

- 新增 `packages/core/src/events.ts`：EventBus、EventHandler、条件 payload 类型；
- 修改 `packages/core/src/app/lifecycle.ts`：声明全局 `ZebraEvents` / `ZebraMiddlewareEvents` 和内置 payload 类型；
- 修改 `packages/core/src/app/internals.ts`：统一持有 EventBus；触发生命周期、请求和 middleware 事件；
- 修改 `packages/core/src/app/app.ts`：实现类型安全的 `on/once/off/emit` 和 `events` 访问器；
- 修改 `packages/core/src/index.ts`：导出 EventBus、事件类型和事件表类型；
- 如需要 publisher，再修改 `packages/core/src/http/request.ts` 和 `buildRequest()`，保持参数向后兼容；
- 如果 route plan 包装 middleware，注意维护现有 fast path、scope 解析、timeout、错误处理和 WebSocket 路径。

### Facade

- `packages/zebra/src/index.ts` 已 re-export `@zebra/core`，确认新增 core 导出自然可见；
- 更新 facade surface 测试，确保 EventBus 和事件类型不被遗漏。

### 文档

- `docs/06-lifecycle.md`：补充统一事件总线、请求/Middleware 事件和 global augmentation；
- `docs/zh/06-lifecycle.md`：同步中文说明；
- `README.md` 的 Features/Packages 部分补充事件系统；
- `docs/api-freeze.md`：记录新增公共 API 和事件名稳定性策略。

## 测试清单

### EventBus 单元测试

- `on + emit` 收到正确 payload；
- listener 按注册顺序、串行等待；
- async listener 被等待；
- `once` 只触发一次；
- `off` 可以移除普通 listener；
- `off` 可以移除 once listener 的原始 handler；
- `removeAllListeners` 和 `listenerCount`；
- listener 抛错时 emit reject，后续 listener 不执行；
- listener 在 emit 中增删时只影响下一次 emit；
- 无 listener 时 emit 不报错。

### 类型测试

使用 `expectTypeOf` 或独立 `tsc` fixture 验证：

- 内置生命周期事件 payload；
- `before.request` / `after.request` / middleware 事件 payload；
- global interface 扩展后自定义事件可用；
- 未声明事件名失败；
- 错误 payload 失败；
- 错误 listener 参数失败；
- `undefined` payload 事件不能传入 payload；
- `on/once/off` handler 类型一致。

### Zebra 集成测试

- boot/ready/shutdown 统一通过 EventBus 触发；
- 生命周期顺序和原有测试完全保持；
- `before.request` 在 middleware 之前；
- `after.request` 在最终 Response 生成之后；
- `request.error` 能观察到原始错误，且仍返回原有 Problem+Json；
- middleware 三类事件顺序正确；
- middleware 错误事件不会破坏现有错误处理；
- 没有事件 listener 时现有请求行为和 fast path 不变；
- `listen()` 后生命周期 listener 仍禁止注册；
- 运行期自定义事件可以 `on/once/off/emit`。

## 验证命令

完成实现后至少运行：

```sh
bun run typecheck
bun test packages/core packages/zebra packages/testing
bun run build
bun run verify:packages
```

不要修改或恢复与事件系统无关的用户工作区变更；当前 `plan.md` 是本任务明确要求新增的计划文件。
