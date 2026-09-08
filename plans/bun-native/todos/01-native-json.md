difficulty: hard
agent: inherit

# JSON 响应原生构造与兼容验证

## T1 · 对照响应行为并采用有收益的原生构造

要做什么：

读取五个响应入口及其测试，对比 `new Response(JSON.stringify(value), init)` 和静态 `Response.json(value, init)`。在等价且有收益的路径采用原生构造；如需共用兼容逻辑，可新增 core 私有 helper，保持错误处理在原有调用点。先完成 T2 的候选测量，再决定保留哪些源码修改。

预计修改的文件：

- `packages/core/src/http/response.ts`
- `packages/core/src/app/internals.ts`（限 `toResponse` 相关逻辑）
- `packages/core/src/contract/implement.ts`（限输出响应构造）
- `packages/core/src/middleware/error.ts`
- `packages/core/src/ws/upgrade.ts`（限 `wsProblemResponse`）
- 可选新增 `packages/core/src/http/json-response.ts`，不从 package index 导出。
- `packages/core/test/http/response.test.ts`
- `packages/core/test/app/dispatch.test.ts`
- `packages/core/test/contract/implement.test.ts`
- `packages/core/test/middleware/error.test.ts`
- `packages/core/test/app/ws.test.ts`，仅在已有 WebSocket 拒绝测试不足时补充。

验收条件：

- helper/普通 handler 的 undefined 仍为空 204；contract 的 status/204 和 Response 直返按原规则处理。
- 字符串、null、布尔/数字、嵌套对象、数组、Unicode 与现有编码一致；顶层函数/Symbol、带 toJSON 的函数或对象也与原实现对照，不将已知空响应边界偷偷改为 500。
- `toJSON`/getter 的副作用与调用次数一致，不通过重试序列化或二次 stringify 检测原生 API 是否可用；循环/BigInt/抛错案例的异常映射保持各入口原状。
- 显式 content-type、status/statusText、Headers 的三种输入形式、独立的多个 Set-Cookie、无正文 status 的边界按原行为；不修改调用方 Headers。
- 既有 HEAD、完成事件、timeout、session 出错后 cookie、contract output validation 与 WebSocket 拒绝行为通过。
- Bun 1.4.0 和当前 1.4.2 均验证，不提高 engines/packageManager/CI 版本，不修改 client、session 或 body 模块。
- 无可复现收益或不能保持行为的候选保留原源码，在本任务完成记录中逐路径注明未采用原因；不得报告这些路径已迁移。

前置依赖：无；源码采用决定依赖本文件 T2 的行为/性能证据。

## T2 · 为 JSON 候选提供可复现测量

要做什么：

新增独立 benchmark，对照原构造和候选完整构造成本，覆盖小对象、数组/嵌套、Unicode、Problem+Json；验证内容并消费输出，再测真实 Zebra helper/dispatch 的 before/after。支持从明确的比较基线复现旧路径；文档/输出写明基线 commit 和调用方式，不能用两个不同功能的 handler 冒充同一框架 before/after。

预计修改的文件：新增 `bench/native-json.ts`。不要修改 `bench/README.md`、共享 runner、`bench/baseline.json` 或 02 的文件。

验收条件：

- `bun run bench/native-json.ts` 可执行；基线对照若需额外参数，在脚本帮助/任务记录中提供准确命令。
- 输入在计时外准备，输出消费检查结果；预热后至少 7 轮交替顺序，输出逐轮数据、中位数、Bun、CPU/平台。
- 同机同 Bun 比较，包含响应正文消费与代表性 framework 路径，不仅测分配空 Response；明确局部成本与 HTTP 吞吐的区别。
- 不以最佳单轮、文档宣传数字或未经复跑的规划探针判定成功；代表性负载有稳定收益且无可复现退化才采用。
- 所有测量在协调器安排的独占时段进行，保留完整数据供 03 汇总。

前置依赖：无；先建立等价候选，与 T1 在同一 worktree 迭代。

## 验证方式

```sh
bun test packages/core/test/http/response.test.ts packages/core/test/app/dispatch.test.ts packages/core/test/app/method.test.ts packages/core/test/app/response-completion.test.ts packages/core/test/middleware/error.test.ts packages/core/test/app/ws.test.ts packages/core/test/contract packages/session
bun run typecheck
bun run lint
bun run build
bun run test
bun run bench/native-json.ts
git diff --check
```

同时按 plan 使用隔离 Bun 1.4.0 运行候选行为检查；协调器在整体验收补齐两个版本的全套门禁。一个任务一个最终 commit，包含实际采用的实现、必要行为测试及 benchmark；若未采用则只提交可复现 benchmark 与证据，不强行制造实现改动。
