# 第二轮仓库改进任务队列

来源：[plan.md](../plan.md)，分析基线 `master` / `a386610`。21 个发现合并为 13 个任务；R01–R04 roadmap 不进入队列。与上一轮已完成的 `plans/repo-improvements/` 分开执行。

## 执行偏好

default_agent: codex

来源：发起流程的 Codex 宿主，用户未指定覆盖。每个 todo 均为 `agent: inherit`，没有单任务指定；不保存隐含的 default_model/default_reasoning_effort。换 session 后沿用本 default_agent；只有用户明确覆盖时才更改。

模型映射来自 herdr-finish-plan 的共享 agent-routing.md：easy → gpt-6-astra / high；medium → gpt-6-astra / xhigh；hard → gpt-6-astra / max。表格展示当前实际解析结果，不是用户模型覆盖。协调器为 Codex / gpt-6-astra / high，每个任务仍按自己的难度选档。每次启动均显式传 YOLO、模型和推理强度。

## 优先级

| 文件 | 优先级 | 难度 | agent | 模型 / Codex 推理强度 | 一句话说明 |
| --- | --- | --- | --- | --- | --- |
| [01-event-listeners.md](done/01-event-listeners.md) | P1 | hard | codex（继承默认） | gpt-6-astra / max | 已完成：回收 once 注册并恢复 emit 快照语义（F01、F02）；验收通过，待协调器合并 |
| [02-session-scope-identity.md](done/02-session-scope-identity.md) | P1 | hard | codex（继承默认） | gpt-6-astra / max | 已完成：旧请求不再释放同名新 session record（F03）；验收通过，待协调器合并 |
| [03-http-completion.md](03-http-completion.md) | P1 | hard | codex（继承默认） | gpt-6-astra / max | 完成 hook 受错误/超时控制，HEAD 无正文且取消流（F04–F06） |
| [04-session-record-keys.md](done/04-session-record-keys.md) | P1 | medium | codex（继承默认） | gpt-6-astra / xhigh | 已完成：session 特殊键安全读写与落库（F07）；验收通过，待协调器合并 |
| [05-schema-await.md](done/05-schema-await.md) | P1 | medium | codex（继承默认） | gpt-6-astra / xhigh | 已完成：跨 realm Promise 的 schema 结果正确验证（F08）；验收通过，待协调器合并 |
| [06-app-boundaries.md](done/06-app-boundaries.md) | P1 | hard | codex（继承默认） | gpt-6-astra / max | 已完成：快照隔离、循环处理与应用配置校验（F09–F12）；验收通过，待协调器合并 |
| [07-body-content-length.md](done/07-body-content-length.md) | P2 | medium | codex（继承默认） | gpt-6-astra / xhigh | 已完成：严格验证声明长度与巨大数值（F13）；验收通过，待协调器合并 |
| [08-session-option-validation.md](done/08-session-option-validation.md) | P2 | medium | codex（继承默认） | gpt-6-astra / xhigh | 已完成：拒绝非有限 TTL 并规范化 cookie 时间（F14、F15）；验收通过，待协调器合并 |
| [09-contract-paths.md](done/09-contract-paths.md) | P1 | hard | codex（继承默认） | gpt-6-astra / max | 已完成：client/MCP 只插值完整参数片段（F16）；验收通过，待协调器合并 |
| [10-mcp-call-isolation.md](done/10-mcp-call-isolation.md) | P2 | medium | codex（继承默认） | gpt-6-astra / xhigh | 已完成：隔离日志故障并建立工具名称索引（F17、F21）；验收通过，待协调器合并 |
| [11-docs-pr-check.md](11-docs-pr-check.md) | P2 | easy | codex（继承默认） | gpt-6-astra / high | PR 校验双语文档与 Pages 路径（F18） |
| [12-compatible-dependencies.md](12-compatible-dependencies.md) | P2 | medium | codex（继承默认） | gpt-6-astra / xhigh | 同范围更新 Bun 类型和 Zod 锁定解析（F19） |
| [13-metrics-sample-window.md](13-metrics-sample-window.md) | P2 | medium | codex（继承默认） | gpt-6-astra / xhigh | 优化有界采样窗口和精确分位数开销（F20） |

## 文件

1. [01-event-listeners.md](done/01-event-listeners.md) — 已完成并归档，验收通过，待协调器合并；依赖：无。
2. [02-session-scope-identity.md](done/02-session-scope-identity.md) — 已完成并归档，验收通过，待协调器合并；依赖：无。
3. [03-http-completion.md](03-http-completion.md) — 依赖 01-event-listeners.md；依赖 02-session-scope-identity.md。
4. [04-session-record-keys.md](done/04-session-record-keys.md) — 已完成并归档，验收通过，待协调器合并；依赖：无。
5. [05-schema-await.md](done/05-schema-await.md) — 已完成并归档，验收通过，待协调器合并；依赖：无。
6. [06-app-boundaries.md](done/06-app-boundaries.md) — 已完成并归档，验收通过，待协调器合并；依赖：无。
7. [07-body-content-length.md](done/07-body-content-length.md) — 已完成并归档，验收通过，待协调器合并；依赖：无。
8. [08-session-option-validation.md](done/08-session-option-validation.md) — 已完成并归档，验收通过，待协调器合并；依赖：无。
9. [09-contract-paths.md](done/09-contract-paths.md) — 已完成并归档，验收通过，待协调器合并；依赖：无。
10. [10-mcp-call-isolation.md](done/10-mcp-call-isolation.md) — 已完成并归档，验收通过，待协调器合并；依赖：无。
11. [11-docs-pr-check.md](11-docs-pr-check.md) — 依赖：无。
12. [12-compatible-dependencies.md](12-compatible-dependencies.md) — 依赖：无。
13. [13-metrics-sample-window.md](13-metrics-sample-window.md) — 依赖：无。

## 依赖与并行

03-http-completion.md 依赖 01-event-listeners.md。
03-http-completion.md 依赖 02-session-scope-identity.md。

按上面的有序列表扫描就绪任务；最多 5 个尚未集成的 worktree（starting/working/待复核/待合并都占槽）。首批可并行 01、02、04、05、06；03 的两个前置任务合并后可执行。01/02 尚未完成时不提前实现 03。队列编号是执行扫描顺序，P1/P2 表示严重程度，不代表遗漏 09。

其他任务在下列文件所有权内可并行：

- 01：events.ts 与 events.test.ts；02：scope-registry.ts 与新增 session-generation.test.ts。
- 03：internals.ts、app/events.test.ts、timeout.test.ts、method.test.ts 与新增 response-completion.test.ts。
- 04：session/session.ts 与新增 session-record-keys.test.ts；08：session/store.ts、cookie.ts、Redis session store 及其已有测试、双语 session 文档。
- 05：contract/implement.ts 与新增 async-validation.test.ts；06：app.ts、可选私有 helper、route-table.test.ts、新增 options-validation.test.ts、app/types.ts 与双语 HTTP 文档。
- 07：http/body.ts 与新增 content-length.test.ts。
- 09：client.ts、bridge.ts 与新增 path-segments.test.ts / bridge-paths.test.ts；10：adapter.ts、mcp.test.ts、transport.test.ts。
- 11：ci.yml；12：bun.lock；13：metrics.ts、metrics.test.ts、可选私有 latency-window.ts。

不得为了减少冲突而复制另一任务实现；发现必须修改对方文件时先通知协调器调整依赖/所有权。README 和 todo 归档属于共享管理动作，待协调器集成时串行更新；不要在并行实现阶段争写共享 README。

## 共同验收与执行边界

- 开始前读取 plan.md 和 docs/api-freeze.md。一个 todo = 一个独立 worktree = 一个最终 commit；未通过验收不得标完成。
- 所有任务都运行各自的定向验证、根 typecheck、lint 和 git diff --check。工作流文本任务用实际 docs 构建与结构检查，不写镜像式测试。
- 任务 agent 不 merge/push、不切换原 checkout；原分支只由协调器串行 rebase 复核与 ff-only 集成。完成归档遵循 herdr-finish-plan，在集成锁内协调共享 README。
- 新增测试文件已逐项标出。循环/挂起/失败探针须释放闩锁、恢复时钟和清理资源，不引入长时间等待或服务泄漏。
- 最终合并态运行 plan.md 的完整校验集。当前基线为 921 tests、core 98.59%、8 场景 benchmark 通过；不要降低覆盖率或性能门槛。
- audit 当前只有 R01 中的 4 条已知文档工具链告警（1 high、3 moderate），exit 1 必须如实报告；新增告警必须处理。12 的更新不代表解决 R01。
- 不执行 R01–R04，不改 Redis 数据布局或必选接口，不发布、不 push、不部署、不写真实 benchmark baseline，不建立 zvec-grep 持久索引。
- 本轮继承当前用户提供的 workspace 检索规则：精确锚点用 zvec_grep_rg（若可用）或 rg；关系/语义问题先 zvec_grep_search，每次传实际 worktree 的绝对 root。索引缺失时使用合适的精确检索，不擅自建索引。

## 初始状态

13 个任务均未启动、未完成。本文件不复用上一轮完成状态。执行偏好已保存，协调器必须按每个 todo 的 difficulty/agent 逐项解析。
