difficulty: hard
agent: inherit

# 03 · 统一请求完成阶段的错误、截止时间和 HEAD 响应

来源：plan.md F04、F05、F06。优先级：P1。一个独立 worktree，一个最终 commit。

依赖 01-event-listeners.md。
依赖 02-session-scope-identity.md。

## T1 · after.request 纳入错误和超时边界

- 要做什么：调整 AppInternals.dispatch，使 after.request 的同步抛错、异步拒绝和挂起均经过既有 Problem+Json / 同一请求 deadline。after.request 自身失败不能重新递归 emit 自己。保留普通失败 request.error → after.request 顺序、原始错误优先级、无 listener 快速路径和 exactly-once scope 清理。
- 预计修改文件：`packages/core/src/app/internals.ts`、`packages/core/test/app/events.test.ts`、`packages/core/test/app/timeout.test.ts`；新增 `packages/core/test/app/response-completion.test.ts`。
- 验收条件：GET 成功但 after.request 抛错时 dispatch 返回 500 Problem+Json，不 reject；timeout=有限值时挂起 after.request 返回 504，signal aborted；hook 晚完成/晚失败不产生重复响应、重复错误事件或未处理拒绝；原始 4xx/5xx、session 的待发 Set-Cookie、资源清理异常有回归。测试记录事件顺序与次数，finally 释放所有闩锁。
- 前置依赖：01-event-listeners.md、02-session-scope-identity.md。

## T2 · 所有 HEAD 出口去正文并释放被丢弃的流

- 要做什么：将 HEAD 去正文从仅 GET fallback 改为所有最终响应；保留显式 HEAD 优先级、响应状态/statusText/headers。对丢弃的 res.body 触发安全 cancel，不能消费整个流或 await 永久挂起的取消。
- 预计修改文件：`packages/core/src/app/internals.ts`、`packages/core/test/app/method.test.ts`、本任务新增的 response-completion.test.ts。
- 验收条件：显式 HEAD、fallback、404、405、middleware 直接响应、handler/hook 错误和 timeout 最终 body 都为 null；Allow、Content-Type、ETag、Content-Length 与 Set-Cookie 保留适用值。底层 cancel 正好触发一次；cancel reject 或永不完成时 HEAD 仍及时返回，无 unhandled rejection。普通 GET 的流继续可读且不会被提前取消。
- 前置依赖：本文件 T1，以及 01、02。

## 校验与交付

运行 `bun test packages/core/test/app packages/session/test/integration.test.ts packages/session/test/session-concurrency.test.ts`、`bun run typecheck`、`bun run lint`、`git diff --check`。完成后在空闲条件运行 `bun run bench:check`，保留原 baseline。不改 app.ts、events.ts、scope-registry.ts 和观测指标计数语义（R04）。需要基础任务改动时先协调，不能重复实现另一份修复。

## 完成记录

- 状态：已完成并通过本任务全部验收，2026-09-06 在协调器持有的集成锁内归档，待协调器执行仓库级门禁与合并。
- 执行 agent：`codex`；model：`gpt-6-astra`；reasoning effort：`max`；difficulty：`hard`。本任务由同一 agent 亲自实现。
- 串行集成：任务分支 rebase 到 `36caf808155120a0692dab94784f897e205a197d`，无冲突；5 个实现/测试文件与 rebase 前提交 `28aa323caf9abc7b9b437d797d1a00fe426fd002` 字节一致。归档和 README 中仅 03 的完成状态 amend 到同一个任务 commit。
- 修改文件：`packages/core/src/app/internals.ts`、`packages/core/test/app/events.test.ts`、`packages/core/test/app/timeout.test.ts`、`packages/core/test/app/method.test.ts`、新增 `packages/core/test/app/response-completion.test.ts`，以及本任务归档和队列 README 的 03 行。
- 保留 master 已合入的其他任务；README 中 12 的部分完成 / Zod 延后说明和 `12-compatible-dependencies.md` 原路径保持原样，其他任务状态未改。未修改 `plan.md`、公共 API、R01–R04、真实 benchmark baseline 或门槛。

### 逐项验收证据

| 验收项 | 实际结果与回归证据 |
| --- | --- |
| T1 · 完成 hook 错误转换 | `events.test.ts` 分别覆盖同步 throw、异步 reject：GET 成功后 hook 失败返回一次 500 Problem+Json；错误观察者再次抛错仍保留原错误；不递归 emit `after.request`，后续同事件 listener 遵守停止语义。 |
| T1 · 同一请求 deadline | `timeout.test.ts` 覆盖 handler 与 hook 共享截止时间、挂起 hook、hook 失败后挂起的 `request.error`；返回 504 Problem+Json，signal aborted，reason 为 504 HttpError，保留 `detail.limit`。 |
| T1 · 顺序与晚完成隔离 | 普通失败按 `request.error` → `after.request` 排序；原始 401/503 的错误对象、响应和 headers 保留。挂起 hook 晚 resolve/reject、GET/HEAD handler 晚 resolve/reject、清理晚 reject 均记录顺序与次数，没有重复响应、重复错误事件或未处理拒绝。 |
| T1 · Cookie 与清理 | `response-completion.test.ts` 的 GET/HEAD × handler 成功/失败 × hook reject/timeout 组合保留 session 已附加和待发的 Set-Cookie，以及独立的业务 cookie，session 数据已落库。请求及匿名 session 资源各清理一次；成功请求的清理异常转 500，原始 4xx/5xx 不被清理异常或 hook 异常覆盖。 |
| T1 · 快速路径与前置兼容 | once 请求 listener 消费后恢复无事件 emit 的快速路径；定向 app 套件同时覆盖无依赖 scope 快速路径、01 的事件行为及 02 的 session record 身份回归。 |
| T2 · 所有 HEAD 出口 | 显式 HEAD 优先，GET fallback、404、405、middleware 直接响应、handler/middleware/before/after hook 错误、handler/hook timeout 最终 `body === null`。保留适用的 status、statusText、Allow、Content-Type、ETag、Content-Length、Set-Cookie 和 hook 添加的 headers。 |
| T2 · 丢弃流取消 | 底层 cancel 正好调用一次，highWaterMark=0 的流没有 pull；cancel 同步抛错、异步拒绝、保持 pending 均不拖住 HEAD，也没有未处理拒绝。普通 GET 的流保持可读，不预读、不提前取消。 |
| 测试资源收尾 | 新增的挂起 hook、handler、清理和 cancel 测试均在 finally 释放闩锁、清除测试计时器、恢复监听器并停止 app。 |

### 校验命令与结果

| 命令 | 实现阶段 | rebase 后 |
| --- | --- | --- |
| `bun install --frozen-lockfile` | exit 0；独立 worktree 安装 | exit 0；按 master 锁定解析安装 `@types/bun@1.4.1`，lockfile 未改 |
| `bun test packages/core/test/app packages/session/test/integration.test.ts packages/session/test/session-concurrency.test.ts` | exit 0；285 pass / 0 fail，1141 expect()，26 files，2.08s | exit 0；285 pass / 0 fail，1141 expect()，26 files，2.09s |
| `bun run typecheck` | exit 0 | exit 0 |
| `bun run lint` | exit 0；253 files | exit 0；256 files |
| `git diff --check` | exit 0 | exit 0 |
| `bun run bench:check` | exit 0；8 场景全部 OK | exit 0；8 场景全部 OK |

rebase 后普通验证日志目录：`/var/folders/b6/161n55hx7f7d9lqmqq8h13lw0000gn/T/zebra-03-rebase-_iyv3goo/`，包含 `targeted-tests.log`、`typecheck.log`、`lint.log`。

### 两次独占性能测量

两次均在协调器明确授予的无竞争时段原样运行 `bun run bench:check`，Bun 1.4.0，duration 1000ms × concurrency 64，每场景沿用脚本的 3 轮中位数；未使用 `--update`。原 RPS ≥80%、p95 ≤125% 的门槛未改。两次测量前后的 `bench/baseline.json` SHA-256 均为 `1e37941b73db6daae50170b62e220dcc5ccefe17f1452806eaddf73bd6e394ba`。

第一次：实现阶段、rebase 前。完整日志：`/var/folders/b6/161n55hx7f7d9lqmqq8h13lw0000gn/T/zebra-03-http-completion-bench-348vurvb/bench-check.log`。

```text
static          91573 req/s (106%)  p95 1.15ms (95%)  OK
param           90594 req/s (107%)  p95 1.17ms (95%)  OK
wildcard        87601 req/s (106%)  p95 1.20ms (95%)  OK
middleware      88453 req/s (113%)  p95 1.21ms (92%)  OK
json            88696 req/s (111%)  p95 1.18ms (90%)  OK
di              76985 req/s (98%)  p95 1.34ms (100%)  OK
static-file     30958 req/s (95%)  p95 3.18ms (107%)  OK
post-json       27475 req/s (103%)  p95 3.61ms (98%)  OK

OK: all zebra scenarios within thresholds
BENCH_EXIT_CODE=0
BASELINE_UNCHANGED=true
```

第二次：rebase 到指定 master 后。完整日志：`/var/folders/b6/161n55hx7f7d9lqmqq8h13lw0000gn/T/zebra-03-rebase-_iyv3goo/bench-after-rebase.log`。

```text
static          92003 req/s (107%)  p95 1.16ms (96%)  OK
param           94714 req/s (112%)  p95 1.14ms (92%)  OK
wildcard        91728 req/s (111%)  p95 1.16ms (92%)  OK
middleware      84503 req/s (108%)  p95 1.23ms (93%)  OK
json            89264 req/s (111%)  p95 1.17ms (89%)  OK
di              77658 req/s (99%)  p95 1.34ms (100%)  OK
static-file     31603 req/s (97%)  p95 3.03ms (102%)  OK
post-json       27213 req/s (102%)  p95 3.82ms (103%)  OK

OK: all zebra scenarios within thresholds
BENCH_EXIT_CODE=0
BASELINE_UNCHANGED=true
```

### 剩余风险与边界

本任务没有未通过的验收或 blocker。超时后用户代码仍可能在后台完成，继续遵守既有 signal 协作取消语义；本次确保这些晚结果不会重复完成请求。R04 的观测计数口径未改。最终仓库级门禁与合并由协调器执行。
