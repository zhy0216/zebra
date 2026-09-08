# Bun 原生服务端热路径

## 意图

用户输入为 `$auto-dev bun native`。Zebra 已是 Bun-first 框架：HTTP/WebSocket 使用 `Bun.serve`，静态正文使用 `Bun.file`，构建、测试和源码发布也已围绕 Bun。结合当前 `CONTRIBUTING.md` 中“有代表性 benchmark 收益时优先 Bun 原生 API”的工作区改动，本计划将需求理解为：评估并采用能改善服务端热路径的 Bun/Web 原生实现，保持现有公共行为、客户端浏览器兼容性和安全边界。

初次规划时向用户询问是否扩大到脚本/测试或仅限 session，采用以上仓库上下文默认范围。用户在看过计划与队列概览后指示“先提交 然后continue”，本轮按已呈现范围继续；用户未提出范围或分发偏好变更。

## 仓库基线

- 分析日期：2026-09-07。
- 分析 HEAD：`216b94763b620a5d844620a579b3a03a0dc64691`。
- 现有 session 工作提交后的实现基线：`4466df7a74864ffde5d83ab0dcb6824f473bbd50`；计划提交随后单独产生，执行器以启动时干净 HEAD 为 worktree 基点。
- 当前 Bun：`1.4.2`；`package.json` 声明最低 `1.4.0`、`packageManager: bun@1.4.0`；CI 使用浮动 `1.4`。不能把本机通过等同于最低版本通过。
- 根配置：Bun workspace、tsgo、Biome、`bun test`；严格 TypeScript、显式 `.ts` 导入、decorator metadata；12 个包直接发布 `src/`。
- 未发现适用的 `AGENTS.md` / `CLAUDE.md`。读取了 README、CONTRIBUTING、API freeze、构建/测试配置、相关源码及既有测试。
- `docs/api-freeze.md` 约束 1.x 的导出、类型、HTTP/cookie 行为和最低运行时；本次没有放宽该约束的用户指令。

### 现有用户改动与执行前置条件

分析开始时工作区有以下未提交内容，暂存区与工作区不完全相同：

```text
M  CONTRIBUTING.md
MM bench/README.md
A  bench/session-sign.ts
M  packages/session/src/sign.ts
 M packages/session/test/integration.test.ts
M  packages/session/test/sign.test.ts
```

其中 `sign.ts` 已从 `createHmac` 改为 `Bun.CryptoHasher("sha256", secret)`，保留 `timingSafeEqual`；另有兼容测试和微基准。这些是已有工作，不能当成本次计划的实现成果。初次运行因缺少提交这些用户改动的授权而停止；用户随后明确要求“先提交 然后continue”，覆盖 auto-dev 对代提交已有改动的默认限制。

上述 6 个文件已完整提交为 `4466df7a74864ffde5d83ab0dcb6824f473bbd50`（`perf(session): use Bun native HMAC for signed cookies`），没有 stash 或丢弃内容；再次检查工作区只剩本计划目录。session 原生化不再拆重复任务，后续整体校验覆盖已保留的实现。单独提交 `plans/bun-native/` 后自动启动 Herdr 协调器；原工作区阻塞已解决。

## 目标 / 非目标

### 目标

1. 对 JSON 响应构造评估 Bun 实现的静态 `Response.json(value, init)`，在行为一致且有可复现收益的路径采用它。
2. 对受大小限制的请求体最终合并评估 `Bun.concatArrayBuffers`，保持逐块限额、取消和共享读取语义。
3. 每个候选都有可复现的行为对照与性能测量，明确“采用 / 未采用”及原因。
4. 更新 Bun 运行时说明和 benchmark 文档，使“原生”范围、必要兼容 API 和实际测量结果一致。

### 非目标

- 不清空全部 `node:` 导入，不迁移只用于脚本/测试的 fs、path、os、child_process 等调用。
- 不改 session cookie 格式、验签方式、cookie 默认属性或浏览器客户端；不重复现有 HMAC 工作。
- 不替换 radix router 为 `Bun.serve.routes`，不绕过 DI、中间件、生命周期、MCP/testing dispatch。
- 不把 `req.body()` 改成无限额的 `Request.json()` / `Bun.readableStreamTo*()` 读取。
- 不重构静态文件 realpath 校验、Redis 客户端/数据布局、WebSocket 类型或信号处理。
- 不升级包版本、最低 Bun、依赖或锁文件；不引入编译为单一可执行文件的发布路线。
- 不重录 `bench/baseline.json`，不降低性能/覆盖率门槛，不扩展执行既有计划中的 roadmap。

## 方案与依据

### 1. JSON 响应：保留边界后采用原生构造

当前以下路径都使用 `new Response(JSON.stringify(value), init)`：

- `packages/core/src/http/response.ts` 的 `json()`。
- `packages/core/src/app/internals.ts` 的 `AppInternals.toResponse()`。
- `packages/core/src/contract/implement.ts` 的 contract 输出。
- `packages/core/src/middleware/error.ts` 的 Problem+Json。
- `packages/core/src/ws/upgrade.ts` 的 `wsProblemResponse()`。

优先测量这些实际调用路径；必要时引入仅 core 内部使用的小 helper，避免多处重复兼容分支，保持各调用点原有错误映射。不要公开新增 API，也不要为检查兼容性在一次响应中执行两次 `JSON.stringify` / `toJSON`。

保留 `undefined → 204` 的 helper/普通 handler 语义、contract 自己的 status 规则、已有 `Response` 分支、字符串和 `null` 的 JSON 编码、显式 content-type 优先、独立的多个 Set-Cookie、HEAD 完成处理。普通 handler 的 BigInt/循环结构仍映射 `response_serialization`；contract 等其他入口按各自原有错误类型处理，不能因复用 helper 将它们一并改写。

本机 Bun 1.4.2 只读探针确认：直接传顶层函数或 Symbol 时，旧构造得到空 200，`Response.json` 抛 TypeError；顶层 undefined 也有差异，框架自己的 204 分支必须保留。对象 `toJSON() → undefined` 在本机两者均为空 200，仍须在最低支持版本验证。带副作用或抛错的 getter/toJSON 应只执行一次。

[Bun HTTP server 文档](https://bun.com/docs/runtime/http/server) 展示原生 `Response.json` 用法；本机锁定的 bun-types 1.4.1 也声明静态构造函数。两者只是 API 依据，不是 Zebra 的性能保证。

### 2. 请求体：仅替换通过限额检查后的字节合并

`packages/core/src/http/body.ts::readBody()` 已逐块读取并检查上限，最后分配 `Uint8Array(size)`，再循环 `set()`。候选为 `Bun.concatArrayBuffers`，优先验证锁定类型支持的 `Bun.concatArrayBuffers(chunks, size, true)`，避免额外包装；实际是否采用由支持版本的行为与代表性 benchmark 决定。

保留 `assertDeclaredSize()`、reader 的获取/释放、逐块统计、超限后的非阻塞取消、`onReadError` 边界和拒绝原因。`packages/core/src/http/request.ts` 的共享 Promise 与流独占状态无需重写。使用真实 `byteOffset` / `byteLength`，不能把视图换成整个 backing buffer；`maxLength` 不能被用来截断超限请求。输出须保留现有复制/隔离行为。

官方 [concatArrayBuffers 参考](https://bun.com/reference/bun/concatArrayBuffers) 描述合并 API；文档的通用性能描述不直接移植为本项目结论。本机短探针中，一种 16 × 1 KiB 合并写法的中位数反而慢于原实现，因此需要按返回 Uint8Array 的候选、小单块、多块及完整读取链重新测量。该探针不构成接受或拒绝所有候选的最终证据。

### 3. 已排除的直接替换

| 位置 / 候选 | 观察与决定 |
| --- | --- |
| session `Bun.CookieMap` | 1.4.2 中 `a=%zz` 解析为替换字符，现有 `parseCookies` 保留 `%zz`；现有测试要求后者。直接替换不进入队列。重复键的后值覆盖在本机相同，不能据此推断其他编码都相同。 |
| session `Bun.Cookie` | 默认序列化增加 `Path=/; SameSite=Lax`，现有无选项 serializer 输出只有 `name=value`；保持现有 serializer 与 TTL/Expires 行为。 |
| session `timingSafeEqual` | 保留常量时间比较；`Bun.hash`、普通字符串比较、deepEquals 不是其替代品。 |
| core 静态文件 | 正文已用 `Bun.file`；fs/path 用于目录识别、路径边界及符号链接校验，本轮保留。 |
| core 生命周期 / WebSocket | `process.on/off` 管理 SIGTERM/SIGINT，Buffer 类型对应 Bun WebSocket 消息，不做形式上的去 Node。 |
| client / contract | 浏览器可用的 Web API 和纯 TS 逻辑保持独立，不增加 Bun-only 运行时引用。 |
| Redis | 当前是调用方提供的 `RedisLike` 接口，并非需要被替换的 Node Redis 依赖；不扩大需求。 |

[Bun Cookie 文档](https://bun.com/docs/runtime/cookies) 提供 API 说明；上表具体差异来自本机探针和仓库测试。[Bun 文件 I/O 文档](https://bun.com/docs/runtime/file-io) 明确允许原生文件 API 未覆盖的操作使用 Bun 的 `node:fs` 实现。

### 4. 性能证据与采用条件

- 01、02 分别拥有新的 benchmark 文件，避免并行改共享 README 或现有 HTTP 基线。
- 使用同机、同 Bun、相同输入/输出和配置；预热后至少 7 轮，交替先后顺序，输出每轮数据、中位数、Bun/CPU/平台及消费校验值。
- JSON 覆盖小对象、嵌套/数组、Unicode、Problem+Json，包含 response body 消费和真实框架 dispatch；请求体覆盖空/单块、多块、偏移视图、常见小 JSON 与较大 payload，分别测合并局部和完整 `readBody`。
- 代表性场景预先选定；源代码改动仅在稳定收益超过测量噪声且其他场景无可复现退化时采用。不只展示最佳场景，不把局部 ns/op 写成 HTTP 吞吐倍率。
- 收益不足或无法等价时，保留原路径，并交付 benchmark 与明确的未采用记录。可完成“评估”任务，但不得报告对应路径已原生化。
- 性能测量由协调器分配独占时段；并行允许写代码和普通验证，不能并行打流互相干扰。

## 拆解

| 顺序 | 任务 | 优先级 | 难度 | 依赖 | 主要文件 |
| --- | --- | --- | --- | --- | --- |
| 01 | JSON 响应原生构造与兼容验证 | P1 | hard | 无 | core 的五个响应入口、对应行为测试；新增 `bench/native-json.ts` |
| 02 | 请求体字节原生合并评估与优化 | P2 | medium | 无 | `http/body.ts`、对应读取测试；新增 `bench/native-body.ts` |
| 03 | Bun 定位说明、性能记录与整体验收 | P2 | medium | 01、02 完成并集成 | README、双语 docs README、CONTRIBUTING、bench README；必要时同步双语 HTTP 文档 |

01 与 02 的实现文件不重叠，可并行；03 等二者完成。任务只修改自己声明的文件；共享文档、队列归档由协调器串行处理。需要修改另一任务文件时调整依赖，不抢写。

## 执行偏好

- `default_agent: codex`，来源：发起本流程的 Codex 宿主。
- 用户未指定全局模型、推理强度或单任务 agent；todo 使用 `agent: inherit`，不保存隐含的模型覆盖。
- 按共享 agent-routing.md：easy → `gpt-6-astra / high`，medium → `gpt-6-astra / xhigh`，hard → `gpt-6-astra / max`。
- 新协调器默认 `codex / gpt-6-astra / high`，任务仍按各自 difficulty 解析。每次启动显式传 YOLO、模型和推理强度；换 session 后读取队列保存值。
- Herdr 环境检查已通过（`HERDR_ENV=1`），但工作区干净与计划提交是启动前置条件。启动时按分发规则再核对 CLI/模型支持。

## 校验

### 规划阶段已运行

以下结果来自上述有用户改动的工作区，不是候选实现验收：

- `bun run typecheck`：exit 0。
- `bun run lint`：exit 0，257 files，无自动修复。
- `bun test packages/core/test/http packages/core/test/contract packages/core/test/app/dispatch.test.ts packages/core/test/app/method.test.ts packages/core/test/app/response-completion.test.ts packages/core/test/middleware/error.test.ts packages/session`：exit 0，416 pass / 0 fail，5,489 assertions，27 files。
- 只读 Bun API 行为探针；短性能探针仅用于识别候选风险，没有形成可发布性能结论。
- 未运行本轮完整 build、全量 test、打包、coverage、docs 或正式 benchmark；历史计划通过记录不能替代本轮验收。

### 每个实现任务

运行自己的定向测试与 benchmark，再运行根 `bun run typecheck`、`bun run lint`、`bun run build`、`bun run test`、`git diff --check`。基准在独占测量时段执行。保留旧测试预期，新增测试仅覆盖原生替换带来的行为风险，不为 API 名称写镜像测试。

### 合并态验收

```sh
bun install --frozen-lockfile
bun run typecheck
bun run lint
bun run build
bun run test
bun run verify:packages
bun test --coverage --coverage-reporter=lcov packages/core
bun run check:coverage
DOCS_BASE=/zebra/ bun run docs:build
bun run bench/native-json.ts
bun run bench/native-body.ts
bun run bench:check
git diff --check
```

保留 core 90% 覆盖率门槛与现有 8 场景 benchmark 门槛。bench:check 的参考来自另一台机器，若失败如实记录并用同机 before/after 分析，不重录 baseline 或将失败改报通过。

在隔离的 Bun 1.4.0 可执行环境和当前 Bun 1.4.2 分别验证候选 API、定向行为与全套仓库检查；每个版本的性能比较都只能与同版本 before 比。不要修改全局 Bun、packageManager、engines 或 CI 版本来迁就候选。若最低版本无法验证，记录未完成项，不声称兼容已通过。

现有 `bench/session-sign.ts` 已随用户授权提交保留，在独占阶段复跑并准确标记其来源；该路径已有的数字不是本轮其他候选的收益。

## 风险与假设

1. “bun native” 的范围采用已向用户呈现的仓库上下文默认；用户要求继续，未提出范围变更。
2. 初次工作区阻塞已通过用户明确授权和提交 `4466df7` 解决；执行仍须从包含计划提交的干净 HEAD 开始。
3. Bun 1.4.2 的行为探针不能证明 1.4.0 的行为；候选需单独验证最低版本。
4. 原生 API 可能更慢，或只在部分输入受益。接受不采用的证据，避免为了名称增加复杂度。
5. Response 构造可能改变序列化异常、getter 调用次数和 Headers；请求体合并可能泄漏视图外数据、改变复制语义或错误时序。测试针对这些结果。
6. 本轮仅编排计划；现有 session 内容依用户明确指示提交，计划另行提交。新的业务实现交给 herdr-finish-plan session，不在当前 session 开始。
