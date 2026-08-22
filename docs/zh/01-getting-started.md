# 快速开始

Zebra 是一个 Bun-first 的 TypeScript Web 框架。本文带你完成安装、配置和第一个应用。

## 安装

```sh
bun add zebra reflect-metadata
```

`zebra` 是公共门面包，再导出 `@zebra/core`、`@zebra/session`、`@zebra/cors` 以及别名后的 `@zebra/rate-limit`。如果你只需要某个子包，也可以单独安装：

```sh
bun add @zebra/contract @zebra/client @zebra/testing
bun add @zebra/session @zebra/cors @zebra/rate-limit
bun add @zebra/observability @zebra/redis
```

## 运行环境

- **Bun ≥ 1.4.0**（运行时）。仓库固定为 `packageManager bun@1.4.0`，测试与 CI 跑在同一个 Bun 上。
- **类型检查**通过 `tsgo`——原生 TypeScript 编译器（`@typescript/native-preview`）。
- `reflect-metadata` 在入口处导入一次，且 `tsconfig.json` 开启装饰器支持：

```json
{
  "compilerOptions": {
    "experimentalDecorators": true,
    "emitDecoratorMetadata": true
  }
}
```

`reflect-metadata` 必须在**任何其他代码之前**导入一次：

```ts
import "reflect-metadata";
import { Zebra } from "zebra";
```

## 第一个应用

```ts
import "reflect-metadata";
import { Zebra } from "zebra";

const z = new Zebra();

z.get("/hello/:name", async (req) => new Response(`hello, ${req.params.name}`));

await z.listen({ port: 3000 });
```

```sh
bun run src/main.ts
curl http://localhost:3000/hello/world
# hello, world
```

`z.listen()` 会在启动前自动完成两件事：

1. 依次执行 `boot` 钩子；
2. 校验整张依赖图（所有已注册的 DI 绑定、路由与中间件声明的依赖），发现未绑定 token、循环依赖或作用域违规会直接抛错；
3. 预编译每条路由的执行计划（中间件链、依赖下标、是否创建 request scope），让运行时零扫描。

校验通过后，应用进入 `ready`（`ready` 钩子随后执行），并开始接受连接。

## 带依赖的应用

依赖通过 `@injectable()` 装饰器声明，注册到 `Zebra` 实例，再在路由里按名字拉取：

```ts
import "reflect-metadata";
import { Zebra, injectable } from "zebra";

@injectable()
class Greeter {
  greet(n: string) {
    return `hi, ${n}`;
  }
}

const z = new Zebra();
z.injectSingleton(Greeter);

z.get("/hi/:name", { g: Greeter }, async (req, { g }) => g.greet(req.params.name));

await z.listen({ port: 3000 });
```

`{ g: Greeter }` 就是**命名对象路由 DI**：第二个参数声明本路由需要的依赖，第三个参数（handler）的第二个入参会获得与声明完全对应的、已解析的依赖对象。路由的 `req.params` 和依赖的类型全部由 TS 推断。

## 值编码规则

Handler 的返回值会被 `Zebra.toResponse` 统一编码：

| 返回值 | 结果 |
| --- | --- |
| `Response` | 原样透传（不包装、不修改） |
| `undefined` | 204 空响应 |
| 其他任意值（对象 / 字符串 / 数字 / `null`） | `JSON.stringify` 编码，`content-type: application/json; charset=utf-8`，状态 200 |

> 注意：普通字符串也会被 JSON 编码（`"hi"` 会带引号）。需要原文返回字符串时用 `req.text()` 的响应 helper `text()`，或直接构造 `Response`。需要显式控制时请使用 [响应 helpers](05-http.md#响应-helpers)。

## 自带 Container

对需要 mock 绑定（测试）或共享容器（多个应用）的场景，可以显式构造容器：

```ts
import { Container, Zebra } from "zebra";

const container = new Container();
container.bind(IRepo).to(MockRepo);
const z = new Zebra({ container });
```

`z.inject*` 系列方法写入的就是 `Zebra` 实例所持有的那个容器。

## 构造选项

`new Zebra(opts)` 支持：

| 选项 | 说明 |
| --- | --- |
| `container` | 自定义 `Container`（默认新建） |
| `body` | 请求体大小限制覆盖（见 [HTTP](05-http.md#请求体)） |
| `errors.exposeStack` | 出错时是否在 Problem+Json 里暴露 `stack`（默认 `false`） |
| `session` / `sessionResolver` / `sessionTtl` | 会话作用域 DI 的解析器与 TTL（见 [会话作用域 DI](03-di.md#session-作用域)） |
| `gracePeriod` | 优雅停机的等待时长（毫秒，默认 `10_000`） |
| `requestTimeout` | 单请求超时（毫秒），超时返回 504 `request_timeout`（见 [HTTP](05-http.md#请求超时)） |
| `trustProxy` | 应用级声明：允许信任 `x-forwarded-for`（默认 `false`） |

## 下一步

- [路由与分组](02-routing.md)
- [依赖注入](03-di.md)
- [中间件](04-middleware.md)
- [契约优先 API](11-contract-first.md)

仓库里带有一个最小示例 `examples/hello`，可以边看边跑：

```sh
bun --filter example-hello start
```
