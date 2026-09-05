# 仓库改进 · 第二轮

日期：2026-09-05。分析基线：`master` / `a386610`。运行环境：macOS arm64、Bun 1.4.0。

## 意图

用户调用 `$auto-dev`，没有附加开发 prompt，因此按仓库探索模式检查当前实现、生成方案和任务队列，再交给 Herdr 中的新协调器执行。上一轮 `plans/repo-improvements/` 的 21 个任务已经合并，当前工作区干净；本轮新建带日期的计划，保留上一轮完成记录。

当前 921 个测试和仓库门禁通过，但边界探针复现了事件监听器回收、session scope 身份、请求完成阶段、session 特殊键、异步验证和路由快照问题。21 个本轮发现合并成 13 个可执行任务；4 项 roadmap 单独保留。没有发现需要 P0 紧急处理的新证据。

## 目标 / 非目标

- 修复已复现的错误行为，补充能防止这些问题复发的行为测试。
- 恢复文档已经承诺的事件、HTTP、契约与 session 语义，保持 v1 exports、签名、Bun 最低要求和包发布方式。
- 补齐有限数值配置校验、PR 文档构建与兼容范围内的依赖维护，优化已测得的观测指标采样开销。
- roadmap 不进入自动执行队列。本轮不改变 Redis 数据布局和 `RedisLike` 必选能力，不决定超时观测指标的新语义，不跨大版本迁移 VitePress / Biome。
- 当前 auto-dev 会话只写本目录的方案和队列并提交；业务实现由新 session 执行。执行只涉及本地 worktree、分支和提交，不发布包、不 push、不部署、不更新真实 benchmark baseline。

## 仓库与探索结果

这是 Bun-first TypeScript monorepo，12 个包以 1.0.0 锁步版本发布 TypeScript 源码。`packages/core/src/app/app.ts` 维护公开注册接口，`internals.ts` 执行请求与关闭流程，`scope-registry.ts` 管理 session DI 生命周期。contract / client / mcp 连接契约与两种调用入口；session、redis、observability 提供可插拔能力。根 tsgo 已覆盖包、示例、脚本与基准，Biome、打包验证和 core LCOV 门禁均已存在。

搜索先尝试当前 workspace 的 zvec-grep，结果为 `INDEX_MISSING`；随后使用 rg 定位精确符号、读取相关源文件和执行无持久代码修改的 Bun 探针。没有创建或重建索引。

| 排查维度 | 本轮证据与结论 |
| --- | --- |
| 正确性 | 全套测试通过；事件、HEAD、异步验证、路由快照、路径插值有缺失用例，见 F01–F10、F16 |
| 健壮性 | scope 同名重建会串扰；after.request 可绕过超时；NaN 配置和错误 Content-Length 被接受，见 F03、F06、F11–F15 |
| 安全 | session 字典会读取继承属性，NaN 能关闭请求体上限；没有把示例默认 secret 当作泄漏的生产密钥；审计仅重现既有工具链告警 |
| 性能 | 原有 8 场景回归门禁通过；一次性监听器残留、metrics 每次完整排序及 MCP 工具线性查找有具体证据，见 F01、F20、F21 |
| 测试 | core 行覆盖率 98.59%，高覆盖并未覆盖本轮交错与异常路径；每项修复内补实际行为回归；Redis 测试仍用 FakeRedis，真实服务验证归入 R02 |
| 工程 / DX | CI 缺少 PR 文档构建；同范围依赖有更新，见 F18、F19；Biome 大版本和整文件忽略归入 R03 |
| 代码质量 | EventBus 失效 entry 常驻、快照遍历缺少所有权与循环边界是直接问题；vendored 类型已有 parity 测试，不因重复本身另起重构 |

未发现包、示例、脚本、基准或 docs 中新增的 TODO / FIXME / XXX / HACK 待办。既有 roadmap 已核对，未伪装成新修复任务。

### 实测基线

以下命令均在根目录实际运行。类型检查、lint、build、全套 test、打包、文档和 audit 可独立运行；coverage 与 benchmark 在其后运行。

| 命令 | 结果 |
| --- | --- |
| `bun run typecheck` | exit 0 |
| `bun run lint` | exit 0；251 files，No fixes applied |
| `bun run build` | exit 0；12 个包全部成功 |
| `bun run test` | exit 0；921 pass / 0 fail，17,348 expect()，107 files，26.31s |
| `bun run verify:packages` | exit 0；12 个 tarball、独立安装、imports、types 全部成功 |
| `bun run docs:build` | exit 0；VitePress 1.6.4，3.60s |
| `bun test --coverage --coverage-reporter=lcov packages/core` | exit 0；392 pass / 0 fail，58 files |
| `bun run check:coverage` | exit 0；2303/2336 core source lines，98.59%，threshold 90% |
| `bun run bench:check` | exit 0；8 个场景通过，原 baseline 未改 |
| `bun audit --registry https://registry.npmjs.org` | exit 1；1 high、3 moderate，全部为 R01 已知工具链告警 |
| `bun outdated` | exit 0；Biome 1.9.4 → 2.5.12，@types/bun 1.4.0 → 1.4.1，zod 4.4.3 → 4.5.4；这是当日 registry 快照 |

审计输出中的告警原文：

```text
esbuild@0.21.5
  moderate: esbuild enables any website to send any requests to the development server and read the response (<=0.24.2) - https://github.com/advisories/GHSA-67mh-4wv8-2f99
vite@5.4.21
  moderate: launch-editor: NTLMv2 hash disclosure via UNC path handling on Windows (<=6.4.2) - https://github.com/advisories/GHSA-v6wh-96g9-6wx3
  moderate: Vite Vulnerable to Path Traversal in Optimized Deps `.map` Handling (<=6.4.1) - https://github.com/advisories/GHSA-4w7w-66w2-5vf9
  high: vite: `server.fs.deny` bypass on Windows alternate paths (<=6.4.2) - https://github.com/advisories/GHSA-fx2h-pf6j-xcff
4 vulnerabilities (1 high, 3 moderate)
```

基准输出：

```text
static          85550 req/s (99%)  p95 1.24ms (102%)  OK
param           77484 req/s (92%)  p95 1.31ms (106%)  OK
wildcard        78288 req/s (95%)  p95 1.30ms (103%)  OK
middleware      72799 req/s (93%)  p95 1.37ms (104%)  OK
json            76417 req/s (95%)  p95 1.31ms (100%)  OK
di              65055 req/s (83%)  p95 1.65ms (124%)  OK
static-file     30913 req/s (95%)  p95 3.22ms (108%)  OK
post-json       27215 req/s (102%)  p95 3.78ms (102%)  OK
```

DI 场景接近门槛，最终性能验证应在没有其他构建和测试竞争时运行。不能通过更新 baseline 使门禁通过。

## 方案

### 事件与请求完成

EventBus 区分「从未来注册表移除」与「once 已消费」。消费 once 时真正删除当前 entry；正在进行的普通 listener 快照保留本次调用资格，同时保证同一个 once entry 在重入或并发 emit 中最多执行一次。按 entry 身份移除，避免误删回调中重新注册的同一函数。

请求完成逻辑集中在 `internals.ts`：after.request 的执行也处于错误转换和同一截止时间边界内。保留正常的 request.error → after.request 顺序、原始错误优先级、无 listener 快速路径和资源只清理一次。after.request 自己失败时不能递归重新 emit 自己；应返回一次正确 Problem+Json，超时返回 504。直接 EventBus.emit 的拒绝语义不变。

HEAD 统一在最终 Response 出口去正文，覆盖显式 HEAD、GET fallback、404/405、middleware 和错误响应；保留状态与 headers。被丢弃的流要触发取消以释放底层资源，取消拒绝或永久等待不能替换响应或拖住 HEAD。

### 生命周期身份与数据边界

RequestScopes 绑定实际取得的 session record 身份，而不只保存字符串 id。旧请求只能释放自己的 record；disposeSession 后同 id 的新 record 不受影响。显式 disposeSession 仍是无条件释放，匿名 scope 和关闭语义不变。

session 数据内部使用安全的自有属性读写，`__proto__` / `constructor` / `toString` 都作为普通业务键；get/has 不接受继承属性。保持 data() 的浅拷贝以及 flush revision / destroy 队列，不改跨请求写入语义。该问题只证明单个 session 数据对象的原型被改变，没有证明全局 Object.prototype 被污染。

routeTable 的快照不能冻结调用者的 meta 或 schema。复制并冻结本轮拥有的元数据对象/数组，使用对象身份表处理循环和共享引用；schema 实例、函数和其他外部实例保持不透明引用，不遍历其内部结构。保留 table、route、contract 的冻结表面，以及 validator 的运行能力。

### 输入、契约与调用适配

构造阶段拒绝非有限时间和 body 配置；保留已支持的合法有限数值、gracePeriod=0、零字节/零文件上限及既有类型。NaN 不应让比较失效，也不能把无限 timeout 交给会溢出的原生计时器。store 的 ttl / touch 与 cookie maxAge 同样拒绝非有限值；touch 的有限零值/负值到期行为和 cookie 负数归零保持不变。

Content-Length 按十进制数字语法校验，不用 Number() 的宽松语法作为合法性判断。明显超过上限的巨大数字在分配/读取前失败，真实字节数仍由读取上限约束。此发现发生于直接构造 Request 的调用路径，没有据此证明 Bun 网络传输层存在请求走私。

Standard Schema 结果采用跨 realm 安全的等待方式，不用 instanceof Promise 决定是否验证结果。只修等待行为，不升级 vendored schema 类型、不修改正常 422 / output validation 行为。

client 与 MCP 的路径插值只识别完整 segment 的 `:name` 或最后一个 segment 的 `*name`。`/clock:zone` 与 `/a*b` 是合法静态路径，保持原文。保留现有参数名 `[A-Za-z0-9_]+`、编码、wildcard 斜线和单次插值；不新增包依赖。

MCP logger 失败不能把已经执行成功的 tool 变成失败；错误报告作为诊断隔离。预先建立 manifest 名称索引，避免每次 callTool 线性扫描，同时保留 tools/list 顺序和未知工具错误。

### 工程与性能

CI 新增独立文档构建校验 job，沿用仓库 Bun 配置并使用 Pages 相同 DOCS_BASE；PR 检查不要求 Pages 写权限，也不执行部署。

仅更新现有范围内的 @types/bun 与 Zod 锁定解析，不升级 Biome / VitePress 或其他无关依赖。确认新解析通过完整 Zod adapter / Ajv / 契约测试；如确需改变受冻结行为，报告具体阻塞而不是修改既有期望掩盖差异。

metrics 优化限于采样窗口和精确分位数计算：减少每个 onSample 的全量排序与数组头删除，不改变 nearest-rank、样本时间顺序、快照拷贝、计数或回调时机。用同机前后对照验证，不能引用下面一次微基准作为生产吞吐承诺。超时观测含义另列 R04。

## 拆解：完整发现清单

所有行的位置以 `a386610` 为准。F 为本轮队列，R 为 roadmap。

| ID | 位置与问题 / 证据 | 改进建议 | 优先级 | 难度 | 队列 |
| --- | --- | --- | --- | --- | --- |
| F01 | `core/src/events.ts:62-73,85-96,113-123`：once 后 count=1、hasAnyOf=true；再次注册同函数后 calls 仍为 1；回调及捕获对象常驻，热路径持续包事件层 | 消费时移除 entry，计数和探测只反映存活注册，允许重新注册 | P1 | hard | 01 |
| F02 | `core/src/events.ts:41-47,67-68` 与 `docs/06-lifecycle.md:64`：first 在 emit 内 off(second)，实际只执行 first，违背本次快照语义 | 普通 listener 的移除影响后续 emit；保留 once 的跨 emit 消费标记 | P1 | hard | 01 |
| F03 | `core/src/app/scope-registry.ts:70-74,93,160-175`：old scope → disposeSession(same) → new scope；dispose old 后新 record.activeRequests 从 1 变 0 | 用 record 身份配对 acquire/release，防止新请求处理中被 TTL 回收 | P1 | hard | 02 |
| F04 | `core/src/app/internals.ts:141-145,181-187`：显式 HEAD 的 body 是 payload；HEAD 404/405 仍返回 JSON 正文 | 所有 HEAD 最终响应统一无正文，保持 headers/status | P1 | hard | 03 |
| F05 | 同上：GET fallback 返回 ReadableStream，HEAD 去正文后底层 cancel 从未触发 | 丢弃流时取消，取消失败/挂起均不能拖住响应 | P1 | hard | 03 |
| F06 | `core/src/app/internals.ts:188-195`：after.request 抛错导致 dispatch reject；timeout=5ms、hook 挂起，35ms 后仍 pending。文档承诺 listener 错误受错误中间件和超时约束 | 将完成 hook 纳入错误/超时边界，防止递归和重复结束 | P1 | hard | 03 |
| F07 | `session/src/session.ts:97-116,167-169`：新 session.has(toString)=true；set(__proto__,{admin:true}) 后 get(admin)=true、data()={}、落库={} | 所有键按自有数据属性处理，保留特殊键序列化 | P1 | medium | 04 |
| F08 | `core/src/contract/implement.ts:44-47`：node:vm 的 Promise.resolve({issues:[...]}) 返回 success:true，未检查 issues | 统一等待 schema 结果，补跨 realm 成功、失败和拒绝回归 | P1 | medium | 05 |
| F09 | `core/src/app/app.ts:110,625-631`：读取 routeTable 后调用者 meta 和 tags 数组均被冻结 | 克隆快照拥有的数据，不修改调用者对象和 schema | P1 | hard | 06 |
| F10 | 同上：meta.self=meta 时读取 routeTable 抛 RangeError Maximum call stack size exceeded | 循环安全复制，重复引用和 schema 实例有明确边界 | P1 | hard | 06 |
| F11 | `core/src/app/app.ts:64-70`：sessionTtl / requestTimeout 的 NaN 及 gracePeriod Infinity 被接受；Infinity 产生原生 TimeoutOverflowWarning 并设为 1ms | 在构造时拒绝非有限时间，保留合法边界 | P2 | medium | 06 |
| F12 | `core/src/app/app.ts:82-86` / `http/body.ts:34-41`：maxSize=NaN、json.limit=1 时大于 1 字节的 JSON 获得 200 | 校验合并后的 body 数值，保证所有限额有效 | P1 | medium | 06 |
| F13 | `core/src/http/body.ts:45-56`：Content-Length 的 1.5、0x10、1e1、+1、空字符串均被接受 | 严格数字语法、巨大值安全处理、保持 streaming 字节上限 | P2 | medium | 07 |
| F14 | `session/src/store.ts:60-61,81-87`、`redis/src/session-store.ts:47-51,86-89`：MemoryStore ttl=NaN 写入后始终无法按时间过期；Redis 同样把非法值传给 PX/PEXPIRE（静态确认） | ctor/touch 提前校验非有限 ttl，错误调用不读写后端，保留有限立即过期语义 | P2 | medium | 08 |
| F15 | `session/src/cookie.ts:55-62`：NaN/Infinity 产生 Max-Age=NaN/Infinity 与 Expires=Invalid Date；1.5 输出非法小数秒 | 非有限值失败；有限正小数向下取整，负数/0 维持删除 cookie 语义 | P2 | medium | 08 |
| F16 | `client/src/client.ts:5-13`、`mcp/src/bridge.ts:12-20`：core 注册 /clock:zone 与 /a*b 均返回 200，client/MCP 却报缺少 :zone 或 *b | 按路由 segment 语法插值，保留静态冒号/星号 | P1 | hard | 09 |
| F17 | `mcp/src/adapter.ts:125-130`：tool 已令 mutations=1，logger 抛错却令 callTool reject | 隔离 logger 异常；不触发业务重试或覆盖原结果 | P2 | medium | 10 |
| F18 | `.github/workflows/ci.yml` 没有 docs build；`deploy-docs.yml` 仅 master push / 手动触发 | 在 PR CI 检查双语文档和 Pages base，防止合并后才发现构建失败 | P2 | easy | 11 |
| F19 | `bun outdated`：@types/bun 1.4.0 → 1.4.1、zod 4.4.3 → 4.5.4 在现有范围内 | 定向更新锁定解析并验证兼容；Biome 大版本归 R03 | P2 | medium | 12 |
| F20 | `observability/src/metrics.ts:85-98`：每次 onSample 都复制并完整排序最多 N 个 samples，窗口用 shift；同进程 10k 次中间件调用，无 callback 2.37ms、空 callback 571.32ms（非生产性能结论） | 优化有界窗口与精确分位数更新，保持返回样本顺序和快照隔离，并进行前后测量 | P2 | medium | 13 |
| F21 | `mcp/src/adapter.ts:113`：每次 callTool 使用 manifests.find，工具数量增长时做 O(N) 查找（静态算法证据） | 创建时建立 Map，list 顺序独立保留 | P2 | medium | 10 |

### Roadmap（只进 plan）

| ID | 位置与问题 | 后续方向 / 不直接执行的原因 | 优先级 | 难度 |
| --- | --- | --- | --- | --- |
| R01 | `package.json` VitePress 1.6.4，`bun.lock` Vite 5.4.21 / esbuild 0.21.5；当前 audit 4 条告警 | 延续上一轮：需要兼容的文档工具链大版本迁移与主题/双语/Pages 验证，不能简单强制 override Vite。Vite 维护者公告确认旧版本受影响，见下方引用 | P1 | hard |
| R02 | `redis/src/rate-limit-store.ts` 多命令窗口声明与计数覆盖；`session-store.ts` 短 TTL tombstone 与旧写复活；suffix key 冲突；`redis/test/integration.test.ts` 实际使用 FakeRedis | 延续上一轮：设计可选原子能力、兼容 key 迁移、存量数据与真实 Redis 并发集成验证。不把 EVAL 改成 RedisLike 必填，不把本轮 ttl 校验误报为修复原子性 | P1 | hard |
| R03 | `biome.json` 对 decorators 与多份核心测试整文件忽略；Biome 1.9.4 与 registry 2.5.12 存在大版本差距 | 延续上一轮：先验证装饰器语法与格式兼容，再逐步收窄忽略；不在本轮扩大格式 diff | P2 | hard |
| R04 | `observability/src/metrics.ts`、access-log / request-id 与 `core/src/app/internals.ts` 分处 middleware 与最终响应边界：探针返回 504 时 errors=0/inFlight=1；handler 稍后成功结束后 errors 仍 0 | 新发现：需要先定义最终响应、取消、后台 handler 与 streaming 的统计口径，再设计可选完成通知/兼容实现。v1 冻结 middleware 语义，不能在采样优化中顺手改变计数定义；与 F06 的既有事件承诺修复区分 | P2 | hard |

### 任务依赖

01、02 完成后执行 03（事件快照和 scope 身份是请求完成修复的基础）。其余任务在明确文件所有权内独立；06 独占 app.ts 与 HTTP 配置说明，07 独占 body.ts，04 独占 session.ts，08 独占 session/store.ts、cookie.ts 与 Redis session store。09 使用新建的 bridge-paths.test.ts；10 使用 mcp.test.ts，不共享测试文件。

按编号扫描就绪任务，最多 5 个未集成 worktree。首批可执行 01、02、04、05、06；03 就绪后优先调度。最终合并、rebase 与归档由协调器串行控制；队列 README 是共享管理文件，其完成状态更新在集成阶段协调，不能视为业务文件可任意并行覆盖。

## 执行偏好

- `default_agent: codex`，来源：当前 Codex 宿主；用户未传分发覆盖。
- 用户没有全局模型或推理强度覆盖，不保存 default_model / default_reasoning_effort。
- 用户没有单任务指定；每个 todo 写 `agent: inherit`。
- 按共享分发规则：easy → gpt-6-astra / high；medium → gpt-6-astra / xhigh；hard → gpt-6-astra / max。
- auto-dev 协调器：Codex、gpt-6-astra / high；不把协调器档位当作任务默认难度。
- 本机 codex --help 已确认 --model、-c 与 --dangerously-bypass-approvals-and-sandbox；可用模型元数据已确认 gpt-6-astra 支持 high/xhigh/max。每次 Herdr 启动显式设置 YOLO、模型与推理强度。
- Herdr 环境检查通过；新 pane 在当前仓库根目录，保留用户焦点。后续协调器必须读取此目录的偏好，不能从上一轮旧队列的 flash/max 建议推断类型。

## 校验

每项任务运行有针对性的行为测试、`bun run typecheck`、`bun run lint`、`git diff --check`。不为纯工作流文本更改增加镜像式测试。最终集成态运行：

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
bun audit --registry https://registry.npmjs.org
bun run bench:check
git diff --check
git status --porcelain
```

audit 当前预期仍可能 exit 1：只能接受 R01 中相同的 4 条已知 advisory，出现新增项必须记录并处理，不能把非零结果称为全绿。benchmark 在其他重任务结束后独立运行；保留原始数值和失败原因，不调低门槛。

F20 性能验证增加同机、相同容量/调用次数、预热后多轮的 before/after 探针，覆盖无 callback、空 callback 和主动 snapshot；报告分布/中位数，不把绝对毫秒数写成跨机器 CI 阈值。所有测试中的挂起流、闩锁和假时钟均应 finally 恢复，避免遗留进程。

## 风险与假设

- `docs/api-freeze.md` 是兼容性边界：修复应恢复已有承诺；需要改动已文档化行为时移入 roadmap 并报告，不悄悄放宽/收紧公共类型或更新版本。
- after.request 的异常路径需要防重复事件、重复 scope dispose 和丢失 Set-Cookie；必须同时复核 listener 快速路径、timeout、HEAD 与 session 的集成组合。
- scope 交错测试应验证真实资源没有在新请求运行中被销毁，而不只断言私有计数器。
- 非有限配置在此前会产生无效日期、失效上限或原生计时器溢出，视为无效输入；保留有限零值/负值已文档化的即时过期或禁用容量语义。cookie 有限正小数归整按整数 Max-Age 语法修复。
- 路由快照只拥有自己的复制数据；不能用 structuredClone 对整个含函数/schema 的 contract 生搬硬套。
- 无索引影响检索方式，不影响本轮已经读取和复现的证据；探索不是形式化证明，未复现的更大设计问题已单列。
- 当前工作区保持干净；执行前如出现本计划以外用户改动，按 auto-dev 规则保留并停止启动，不代为 stash、提交或丢弃。

HTTP HEAD 与 Content-Length 规则依据 [RFC 9110 §9.3.2](https://www.rfc-editor.org/rfc/rfc9110.html#section-9.3.2) 和 [§8.6](https://www.rfc-editor.org/rfc/rfc9110.html#section-8.6)；跨 realm 探针是本地推断，Standard Schema 的返回值合同见 [Standard Schema V1](https://standardschema.dev/)。R01 的 Vite 高等级告警经 [Vite 维护者安全公告](https://github.com/vitejs/vite/security/advisories/GHSA-fx2h-pf6j-xcff)核对。本轮未从旧公告推断其他未审计的漏洞。


## 执行结果（2026-09-05 至 2026-09-06）

本轮从 `master` / `13eddf766ba68a30f1c87449a1d52911773cbb9c` 开始，按独立 Herdr worktree 实现、协调器独立复核、串行 rebase、仓库校验和 fast-forward 合并完成集成。共合入 13 个任务 commit：**12 项完整完成，任务 12 部分交付，Zod 升级延后**。最终实现提交为 `ee387aabe04ca314365ad03a8e78b705ecb03b72`；后续仅提交本执行记录和队列状态。

### 提交、归档与逐项验收

以下所有任务实际使用 `codex` / `gpt-6-astra`，通过 Herdr 显式 YOLO 启动；effort 按队列难度选择，没有换模型或降档。每行日志目录均位于本机 `/tmp/zebra-0905-run/`，包含协调器在 rebase 后工作树亲自执行的 `typecheck.log`、`lint.log`、`build.log`、`test.log` 和 `verify-packages.log`，五项均 exit 0。测试数量对应当时的串行集成状态，不能相加。

| Todo | 合入 commit | 实际 agent / effort | 全量 pass / fail | 独立验收日志目录 | 最终状态 |
| --- | --- | --- | ---: | --- | --- |
| [01 · event-listeners](todos/done/01-event-listeners.md) | `534a48fdcf2f54fe95bf2c1eecd2039de7d4fae4` | `zebra-0905-01` / `max` | 981 / 0 | `gates-01-1788618455` | 完成、归档、已清理 |
| [02 · session-scope-identity](todos/done/02-session-scope-identity.md) | `8af73f3e275dab53d56c7f792d36c658f961f8b5` | `zebra-0905-02` / `max` | 990 / 0 | `gates-02-1788619559` | 完成、归档、已清理 |
| [03 · http-completion](todos/done/03-http-completion.md) | `e12e007d593d7c4058517185983aa2c1fb2ce83e` | `zebra-0905-03` / `max` | 1194 / 0 | `gates-03-1788624709` | 完成、归档、已清理 |
| [04 · session-record-keys](todos/done/04-session-record-keys.md) | `03567fde4bececa3837ed2b746d7808c38951371` | `zebra-0905-04` / `xhigh` | 964 / 0 | `gates-04-1788618016` | 完成、归档、已清理 |
| [05 · schema-await](todos/done/05-schema-await.md) | `6221284a7ee221c3be6b38b2f7e54a67ab831d99` | `zebra-0905-05` / `xhigh` | 950 / 0 | `gates-05-1788617719` | 完成、归档、已清理 |
| [06 · app-boundaries](todos/done/06-app-boundaries.md) | `f26aa5867de34752e3c531e095bbe05626d359f4` | `zebra-0905-06` / `max` | 1041 / 0 | `gates-06-1788619968` | 完成、归档、已清理 |
| [07 · body-content-length](todos/done/07-body-content-length.md) | `4e13741522501726bb8eb6ad2e23c5b262f7651c` | `zebra-0905-07` / `xhigh` | 1123 / 0 | `gates-07-1788621301` | 完成、归档、已清理 |
| [08 · session-option-validation](todos/done/08-session-option-validation.md) | `c96f0cbea26e00ca8f2c6c0554adb7b18c6be828` | `zebra-0905-08` / `xhigh` | 1089 / 0 | `gates-08-1788620885` | 完成、归档、已清理 |
| [09 · contract-paths](todos/done/09-contract-paths.md) | `fbb28c1796faf93959a703d5e97d56c53603f4bc` | `zebra-0905-09` / `max` | 1154 / 0 | `gates-09-1788622077` | 完成、归档、已清理 |
| [10 · mcp-call-isolation](todos/done/10-mcp-call-isolation.md) | `11bf45306f6a8ae1bb391949ecf946588d791442` | `zebra-0905-10` / `xhigh` | 1134 / 0 | `gates-10-1788621642` | 完成、归档、已清理 |
| [11 · docs-pr-check](todos/done/11-docs-pr-check.md) | `2b8ea7970b862cf0d96f53de8ea72f31a7bdaa0b` | `zebra-0905-11` / `high` | 1154 / 0 | `gates-11-1788622580` | 完成、归档、已清理 |
| [12 · compatible-dependencies](todos/12-compatible-dependencies.md) | `36caf808155120a0692dab94784f897e205a197d` | `zebra-0905-12` / `xhigh` | 1154 / 0 | `gates-12-1788623405` | 部分交付，Zod 延后 |
| [13 · metrics-sample-window](todos/done/13-metrics-sample-window.md) | `ee387aabe04ca314365ad03a8e78b705ecb03b72` | `zebra-0905-13` / `xhigh` | 1219 / 0 | `gates-13-1788625247` | 完成、归档、已清理 |

合入顺序：05 → 04 → 01 → 02 → 06 → 08 → 07 → 10 → 09 → 11 → 12（部分）→ 03 → 13。03 在 01、02 合入后才启动；03、13 的性能测试使用协调器分配的独占测量时段。每项仅保留一个 commit，均无冲突完成 rebase，没有 merge commit。

已归档的文件是上表链接到 `todos/done/` 的 01–11 和 13，共 12 个；`todos/12-compatible-dependencies.md` 保持原路径与原验收要求。README 中完整完成项已统一标记为已合并并清理，12 保持 partial/deferred。

### 验收中发现的问题与延后范围

- **任务 12 未全部完成。** `@types/bun` 和必需的 `bun-types` 已从 1.4.0 更新到 1.4.1。Zod 4.5.4 候选导致三个既有 JSON Schema 输出断言失败：交集的 `allOf` 被折叠，简单 union/nullable 改为 `type` 数组。候选全量结果为 1151 pass / 3 fail；恢复 Zod 4.4.3 且不改源码或测试期望后为 1154 pass / 0 fail。两版本同输入 HTTP 探针状态相同，证据只确认 Schema 文档结构差异。按冻结要求接受 Bun 类型部分交付；Zod 保留 4.4.3，不能宣称原任务验收全部通过。详见[任务 12 的候选对照与官方依据](todos/12-compatible-dependencies.md)。
- **任务 02 的首次协调器全量检查失败并已修复。** 989 pass / 1 fail 暴露既有 WebSocket 测试 helper：测试覆盖 `onclose` 后，原 `closed` Promise 的 3000 ms 定时器没有清理，异步拒绝泄漏到后续测试。额外等待 3200 ms 的临时探针确定复现。协调器授权同一任务 agent 修复 `packages/core/test/ws.test.ts` 的 Promise/定时器及 socket/server 清理，未改 WebSocket 运行时；修复后同一探针 5 pass，集成全量 990 pass / 0 fail。修复包含在任务 02 唯一提交中。原失败与修复日志均保留，没有以重排测试掩盖问题。
- 07、09 各遇到一次明确的模型 capacity 错误；原 agent 在同一 worktree、同一模型和 effort 上继续完成，没有将错误状态当作完成。
- R01–R04 仍为 roadmap：文档工具链告警、Redis 原子性与真实服务验证、Biome 大版本迁移、timeout/inFlight/errors 观测口径均未在本轮扩展执行。

### 主分支最终验收

协调器在全部任务合入、任务 agent 退出和工作树清理后，对实现 HEAD `ee387aabe04ca314365ad03a8e78b705ecb03b72` 运行如下检查。原始日志目录为 `/tmp/zebra-0905-run/final-1788625309/`，`results.json` 记录非 benchmark 命令及退出码；`bench.log` 保存独立 benchmark 输出。

| 命令 | 结果 |
| --- | --- |
| `bun install --frozen-lockfile` | exit 0；Bun runtime 1.4.0，锁文件未变化 |
| `bun run typecheck` | exit 0 |
| `bun run lint` | exit 0；260 files，未应用修复 |
| `bun run build` | exit 0 |
| `bun run test` | exit 0；1219 pass / 0 fail，131,900 assertions，115 files |
| `bun run verify:packages` | exit 0；全部 12 包的 tarball、独立安装、imports 和 types 通过 |
| `bun test --coverage --coverage-reporter=lcov packages/core` | exit 0；572 pass / 0 fail，12,918 assertions，63 files |
| `bun run check:coverage` | exit 0；core 2384/2417 行，98.63%，门槛 90% |
| `DOCS_BASE=/zebra/ bun run docs:build` | exit 0；双语文档及 Pages base 构建通过 |
| `bun audit --registry https://registry.npmjs.org` | **exit 1**；仅原有 4 条告警（1 high、3 moderate），没有新增 |
| `git diff --check` | exit 0 |
| `bun run bench:check` | exit 0；其他仓库重任务结束后独立运行，8/8 通过 |

审计逐条核对为 esbuild `GHSA-67mh-4wv8-2f99`，Vite `GHSA-v6wh-96g9-6wx3`、`GHSA-4w7w-66w2-5vf9`、`GHSA-fx2h-pf6j-xcff`。本轮没有解决 R01，不能将 audit 描述为通过。

最终 benchmark 使用原命令、默认 1000 ms、并发 64，每场景三轮按 req/s 取中位数；没有覆盖门槛或重写 baseline。正常 OS 后台进程保留。

| 场景 | req/s | p95 ms | 原门槛 |
| --- | ---: | ---: | --- |
| static | 95605 | 1.13 | 通过 |
| param | 91923 | 1.15 | 通过 |
| wildcard | 93847 | 1.16 | 通过 |
| middleware | 86692 | 1.22 | 通过 |
| json | 87451 | 1.20 | 通过 |
| di | 78026 | 1.33 | 通过 |
| static-file | 34440 | 2.78 | 通过 |
| post-json | 27447 | 3.59 | 通过 |

### Metrics 前后性能证据

协调器独立复核 before/after 源码、测量脚本和全部原始数据，并重算中位数。容量 1000，同机同 Bun 1.4.0，每组预热 10,000 次；两种时钟各 11 轮，交错 before/after、交替先后顺序。无 callback 场景测量 100,000 次，空 callback/主动 snapshot 场景测量 20,000 次，重复 snapshot 在填满窗口后测量 20,000 次读取。毫秒中位数如下；完整方法、改善轮数、原日志路径见[任务 13 完成记录](todos/done/13-metrics-sample-window.md)。

| 场景 | 固定种子 before → after ms | 真实时钟 before → after ms |
| --- | ---: | ---: |
| 无 callback | 13.865 → 11.180 | 14.304 → 11.550 |
| 读取后无 callback | 13.015 → 11.099 | 13.983 → 11.496 |
| 空 callback | 1839.841 → 46.033 | 1248.837 → 45.009 |
| 每请求 snapshot | 1849.387 → 43.784 | 1281.263 → 44.640 |
| 重复 snapshot | 1282.409 → 20.507 | 849.529 → 16.942 |

空 callback 两种时钟分别为 39.97x、27.75x 的局部成本改善，均 11/11 配对轮次改善。固定种子「读取后无 callback」有一轮 +1.65% 波动，其余 10 轮及真实时钟全部 11 轮改善；保留这一事实。实现存储 O(capacity)，无 callback 写入 O(1)，数组移动/拷贝仍为 O(capacity)，多次写入后的首次读取仍需全量排序。这是局部 middleware/snapshot 测量，不是生产 HTTP 吞吐倍率承诺。

### 仓库与资源状态

本轮创建的 13 个 Herdr workspace、13 个 worktree 路径及 13 个本地任务分支均已清理；12 的已合入部分也已安全清理，其未完成需求保留在原 todo。`git worktree list` 仅余原 checkout；本轮分支查询为空，所有任务 commit 均为 master 祖先。没有清理本轮之外的资源。

`bench/baseline.json`、中英文 API freeze 文档和全部 package.json 相对起始 HEAD 均未变化；baseline SHA-256 为 `1e37941b73db6daae50170b62e220dcc5ccefe17f1452806eaddf73bd6e394ba`。所有 Zebra 包仍为 1.0.0，依赖范围和源码发布策略不变。没有 push、PR、发布或部署，也没有创建持久检索索引。最终记录提交后，以 `git status --short` 为空作为收尾条件。
