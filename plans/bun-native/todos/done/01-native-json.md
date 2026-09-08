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

## 准备记录 · 2026-09-07（待独占测量，尚未完成）

工作分支 `herdr/plan-bun-native-01-native-json`，基线
`1418a2f3f8b3e0bae53490eb195811b34590e041`，包含已有 session 提交 `4466df7`。
本阶段未运行任何正式 benchmark 或性能探针，尚未作性能采用决定，也尚未创建任务 commit。

### 逐路径候选状态

| 入口 | 准备状态与行为证据 |
| --- | --- |
| `http/response.ts::json` | 保留原源码。直接原生构造对顶层函数/Symbol 抛错；带 `toJSON` 的函数也被原生 API 拒绝。对象 `toJSON() → undefined / Symbol / function` 的旧响应 `body === null`，原生响应则有空正文流，不能只比较 `.text()`。提前构建 init/Headers 还会改变与序列化副作用的先后顺序。 |
| `app/internals.ts::toResponse` | 保留原源码。上述空正文边界在 handler 返回值中同样可观察；原有 `response_serialization` 映射保持不变。 |
| `contract/implement.ts` | 保留原源码。上述任意根值边界同样适用，且 contract 的空响应 status、204 提前返回、Response 直返及错误映射必须独立保留。 |
| `middleware/error.ts` | 暂定候选 `Response.json(problem, init)`，仅改构造行。框架创建固定顶层 Problem 对象；detail 的既有 `safeSerialize` 及构造时副作用次数、异常、显式 content-type、error/session 独立 cookies 对照通过。是否保留待测量。 |
| `ws/upgrade.ts::wsProblemResponse` | 暂定候选 `Response.json(problem, init)`，仅改构造行。既有 404、401、500、无效握手和 auth/DI 拒绝测试通过。是否保留待测量。 |

没有新增私有 helper；未修改 client、session、body、依赖、锁文件、共享 README 或其他任务文件。
回归测试位于本任务允许的四个测试文件；WebSocket 既有拒绝测试已足够，无需修改它。

### 测量准备

新增 `bench/native-json.ts`，默认固定上述基线，通过 `git archive` 导出临时源码并加载真实
Zebra/helper/contract/error/WebSocket helper。所有 Git 命令只读，不创建或修改 Git worktree。
基线与当前实现使用相同路由、输入、schema、Request 和选项；没有用不同功能的 handler
冒充 before/after。未改的 helper、普通 dispatch、contract 路径明确作为控制场景。

23 个场景覆盖完整构造、小对象、嵌套数组、Unicode、Problem+Json，以及真实 helper、
普通/显式 helper/contract dispatch、带 cookies 的 error middleware/dispatch 和 WS 拒绝响应 helper。
输入在计时外准备，每次 `.text()` 消费并检查全文、累积校验和；默认预热 2,000 次，
每轮每实现 10,000 次、至少 7 轮交替顺序。JSONL 输出包括所有逐轮数据、中位数、
成对胜出次数、Bun 可执行文件、CPU/平台、完整基线 commit 和 core 源码差异。
这是进程内构造/dispatch 成本，不是 HTTP 吞吐。

`--check` 只检查行为及基线加载，不执行计时或预热；两个版本均通过 23 个场景的
每实现 64 个输入检查，同时输出 7 个原生 API 不兼容边界。`--help` 提供参数说明。
行为记录：`/tmp/zebra-native-json-check-142.jsonl`、`/tmp/zebra-native-json-check-140.jsonl`。

协调器发放独占时段后，在本 worktree 根目录依次执行，完整复跑两次：

```sh
bun run bench/native-json.ts --baseline 1418a2f3f8b3e0bae53490eb195811b34590e041 > /tmp/zebra-native-json-bun142-run1.jsonl
bun run bench/native-json.ts --baseline 1418a2f3f8b3e0bae53490eb195811b34590e041 > /tmp/zebra-native-json-bun142-run2.jsonl
PATH=/tmp/zebra-bun-native-run/runtime/bun-linux-x64:$PATH bun run bench/native-json.ts --baseline 1418a2f3f8b3e0bae53490eb195811b34590e041 > /tmp/zebra-native-json-bun140-run1.jsonl
PATH=/tmp/zebra-bun-native-run/runtime/bun-linux-x64:$PATH bun run bench/native-json.ts --baseline 1418a2f3f8b3e0bae53490eb195811b34590e041 > /tmp/zebra-native-json-bun140-run2.jsonl
```

环境需要 Git、tar、现有 frozen-lockfile 安装的 node_modules（已就绪）、当前 Bun 1.4.2
及协调器提供的隔离 Bun 1.4.0。输出供 03 汇总；此处的命令尚未执行。

### 本阶段校验

- `bun install --frozen-lockfile`：通过，锁文件未变。
- 验证方式中的定向测试额外包含 `packages/core/test/app/timeout.test.ts`：Bun 1.4.2
  为 369 pass / 0 fail、5,654 assertions、23 files。
- Bun 1.4.0 同一组测试为 368 pass / 1 fail；唯一失败是原有
  `listen() plumbs the real peer address into req.ip`。单独复跑仍失败；从 `1418a2f`
  导出的未修改源码及原始 dispatch 测试也为 10 pass / 1 fail。
  该运行时在本机返回 `::ffff:127.0.0.1`，既有断言只接受 `127.0.0.1` / `::1`。
  基线日志 `/tmp/zebra-native-json-baseline-dispatch-140.log`；未放宽断言或修改范围外的
  网络代码。此项交协调器处理，不能把最低版本整套门禁报告为通过。
- 隔离 Bun 1.4.0 单独运行 response、contract implement、error middleware 三个文件：
  65 pass / 0 fail；再显式选择新增的两个 dispatch JSON 测试：2 pass / 0 fail
  （11 个其他测试被筛选）。日志 `/tmp/zebra-native-json-candidate-140.log`。
  这只证明候选相关行为通过，不替代上一条有失败的完整定向命令。
- Bun 1.4.2 根 `bun run typecheck`、`bun run lint`、`bun run build`、`bun run test`
  均通过；全量测试 1,289 pass / 0 fail、132,910 assertions、115 files。
  构建及测试完整日志位于 `/tmp/zebra-native-json-build-142.log`、
  `/tmp/zebra-native-json-test-142.log`；定向日志为 `/tmp/zebra-native-json-targeted-142.log`
  和 `/tmp/zebra-native-json-targeted-140.log`。
- `bun run bench/native-json.ts --check`、隔离 Bun 1.4.0 的同一命令和 `--help`：通过。
- `git diff --check`：通过。正式性能证据、最终源码采用决定、最终 commit 与干净交付
  留待独占测量后完成。

### peer-IP 测试夹具补正 · 2026-09-07

协调器明确要求修正本 todo 范围内的地址族不确定性。原始 Bun 1.4.0 失败记录保留在上文
及 `/tmp/zebra-native-json-baseline-dispatch-140.log`：默认监听配合 `localhost` 请求时，
真实地址呈 IPv4-mapped IPv6 格式 `::ffff:127.0.0.1`，不满足既有回环地址断言。

仅在 `dispatch.test.ts` 的 `listen() plumbs the real peer address into req.ip` 用例中，
将监听参数设为 `{ port: 0, hostname: "127.0.0.1" }`，fetch 使用
`http://127.0.0.1:${port}/`，并加注释说明固定地址族的原因。
保留原来的全部断言、`x-forwarded-for: 203.0.113.66` 请求头、真实 HTTP 请求和清理流程；
没有修改生产网络代码。测试仍验证 `req.ip` 来自实际 socket peer，不能被伪造的 XFF 替代。

```sh
bun test packages/core/test/app/dispatch.test.ts
PATH=/tmp/zebra-bun-native-run/runtime/bun-linux-x64:$PATH bun test packages/core/test/app/dispatch.test.ts
bunx --no-install biome check packages/core/test/app/dispatch.test.ts
git diff --check
```

两个版本均为 **13 pass / 0 fail、89 assertions**；目标 peer-IP 用例与 XFF 验证均通过，
Biome 和 diff 检查通过。日志分别为 `/tmp/zebra-native-json-peer-ip-fixture-142.log`、
`/tmp/zebra-native-json-peer-ip-fixture-140.log`。此前观察到的夹具失败已解决；本轮未重跑
最低版本完整仓库门禁，不将本次单文件通过当作完整门禁证据。

本轮未运行 benchmark 或性能探针，未创建 commit；等待协调器另行发放独占测量时段。

## 完成记录 · 2026-09-07（UTC 测量日期 2026-09-08）

**评估完成；五个生产入口全部保留原源码，未采用原生迁移。** 上面的准备记录保留阶段历史，
最终结论及完整数据见 [结果报告](../../results/01/REPORT.md)。

独占时段按协调器授权执行；检测到其他 workspace 的 Rust/Bun 构建、测试和 benchmark 后
只等待、记录，没有操作其他 workspace。共保存八次完整运行，其中四次因测量期间出现
其他 CPU 负载而排除；有效数据为两版各两次：
`bun142-run4`、`bun142-run5`、`bun140-run1`、`bun140-run3`。
每次均为 23 场景 × 7 轮 × 每实现 10,000 次，预热 2,000 次，保留全部逐轮数据。
有效复跑没有记录到其他明显 CPU 负载，全部 644 组配对消费校验和相等；所有测量的
基线均为 `1418a2f3f8b3e0bae53490eb195811b34590e041`，候选及脚本哈希一致。

### 采用决定

| 入口 | 最终决定与原因 |
| --- | --- |
| `json()` | 保留原源码。直接原生构造的 function/Symbol、带 toJSON 的函数、空根值 body 及 Headers 读取顺序存在兼容边界；没有采用直接替换。 |
| 普通 handler `toResponse` | 保留原源码。保留 undefined→204、空根值 null body 与 response_serialization 映射；实际 benchmark 作为未改控制。 |
| contract 输出 | 保留原源码。保留 contract 自身 status/204、Response 规则、output validation 与 internal 映射；实际 benchmark 作为未改控制。 |
| error middleware | 恢复原源码。局部耗时在两版四次有效复跑分别增加 12.33%、16.72%、5.72%、6.20%；完整 dispatch 没有稳定收益且存在复现退化。 |
| `wsProblemResponse` | 恢复原源码。耗时变化分别为 -2.65%、+0.63%、+0.06%、-1.27%，方向不稳定，幅度未超过控制场景波动。 |

控制场景源码未改，四次复跑的变化范围分别为 -7.94%～+5.32%、-7.86%～+5.80%、
-10.58%～+5.68%、-7.31%～+8.57%。未以最佳轮次或微小局部变化认定收益，也未将原生 API
的直接替换差异泛化为所有可能兼容实现均不可行。

### 逐项验收

| 验收项 | 证据 |
| --- | --- |
| undefined、status/204、Response 直返 | response / dispatch / contract 测试覆盖 helper/普通 handler 的空 204、contract 的独立空响应 status、204 验证及 Response 禁止/直返规则。 |
| 普通 JSON 值与特殊根值 | 四个允许的测试文件覆盖字符串、null、布尔/数字、嵌套对象、数组、Unicode、函数/Symbol、带 toJSON 的函数/对象及 toJSON 返回无 JSON 表示的根值；正文文本和 body 是否为 null 均对照旧构造。 |
| 副作用与异常 | 验证 toJSON/getter 次数及副作用顺序；循环/BigInt/抛错保留各调用点映射。error detail 保留既有 safeSerialize + 构造两次调用，无新增重试或 API 可用性检测。 |
| Response 元数据 | 覆盖 content-type/status/statusText、Headers 三种输入形式、独立 Set-Cookie、调用方 Headers 不被修改、无正文 status 的 Bun 既有边界。 |
| 框架集成 | 定向套件含 HEAD、response completion、timeout、contract output validation、WebSocket 拒绝与完整 session 包；两版各 369 pass / 0 fail。 |
| 支持版本与范围 | Bun 1.4.2 与隔离 1.4.0 的 typecheck/lint/build/test 全部通过，全量各 1,289 pass / 0 fail；未修改 engines/packageManager/CI、client/session/body、依赖或锁文件。 |
| benchmark 可复现性 | `bun run bench/native-json.ts` 可执行，默认在临时基线源码应用两个固定 Problem 候选，最终 HEAD 仍可比较被拒绝的真实框架候选。`--candidate current` 比较实际最终源码；`--check` 无计时。 |
| 测量方法与判断 | 输入在计时外准备、全文消费验证、预热/至少 7 轮交替、逐轮/中位数/环境/源码证据齐全；同机同 Bun、真实 helper/dispatch、控制噪声均纳入判断；不代表 HTTP 吞吐。 |
| 追溯与保存 | `results/01/` 含原始 JSONL、负载/命令/日期、候选 patch、全部 core/脚本 SHA-256、原样测量脚本、汇总 CSV、候选及最终校验日志。部分原始输出以 gzip 无损保存。 |
| peer-IP 夹具 | 原始最低版本失败及两版修正后通过日志均保留；仅固定监听和请求为 127.0.0.1，原断言/XFF/真实请求/清理流程不变，生产网络语义未改。 |

最终源码恢复后，两版定向验证均为 369 pass / 0 fail、5,654 assertions，根全量均为
1,289 pass / 0 fail、132,910 assertions；typecheck、lint、build 均 exit 0。
最终默认候选模式在两版均通过 23 场景行为检查，候选源码哈希与测量时一致。
最终 `git diff --check` 及暂存 diff 检查通过，提交仅包含 benchmark、行为/夹具测试和本任务证据；
生产源码与基线一致。一个 Conventional Commits 任务提交，未 rebase/merge/push/建 PR，
未改共享 README 或归档队列；本 turn 结束释放独占测量时段。
