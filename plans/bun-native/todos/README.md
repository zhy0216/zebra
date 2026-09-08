# Bun 原生服务端热路径任务队列

来源：[plan.md](../plan.md)。范围默认来自 `$auto-dev bun native` 与仓库上下文：有行为和性能证据的服务端热路径优化。用户看过概览后要求“先提交 然后continue”；已有 session 签名改动已按授权提交，不作为重复实现任务。

## 执行偏好

default_agent: codex

来源：发起流程的 Codex 宿主；用户未指定覆盖，所有任务均 `agent: inherit`。没有用户指定的全局模型/推理强度，也没有单任务指定，所以不保存 default_model/default_reasoning_effort。

共享 agent-routing.md 映射：easy → `gpt-6-astra / high`；medium → `gpt-6-astra / xhigh`；hard → `gpt-6-astra / max`。下表是解析结果，不是模型覆盖。新协调器为 `codex / gpt-6-astra / high`，不改变任务自己的难度档位。每次启动显式传 YOLO、模型和推理强度；更换 session 仍读取本文件。

## 优先级

| 文件 | 优先级 | 难度 | agent | 模型 / Codex 推理强度 | 一句话说明 |
| --- | --- | --- | --- | --- | --- |
| [01-native-json.md](01-native-json.md) | P1 | hard | codex（继承默认） | gpt-6-astra / max | 验证并优化 JSON/Problem+Json 原生构造，保持调用点行为 |
| [02-native-body.md](02-native-body.md) | P2 | medium | codex（继承默认） | gpt-6-astra / xhigh | 评估原生字节合并，保持请求体限额、取消和复制语义 |
| [03-docs-and-validation.md](03-docs-and-validation.md) | P2 | medium | codex（继承默认） | gpt-6-astra / xhigh | 汇总采用决定、实测结果及 Bun 文档，完成整体验收 |

## 文件

1. [01-native-json.md](01-native-json.md) — 依赖：无。
2. [02-native-body.md](02-native-body.md) — 依赖：无。
3. [03-docs-and-validation.md](03-docs-and-validation.md)。
   依赖 01-native-json.md。
   依赖 02-native-body.md。

## 依赖与并行

03-docs-and-validation.md 依赖 01-native-json.md。
03-docs-and-validation.md 依赖 02-native-body.md。

按文件顺序扫描就绪任务。01、02 可在独立 worktree 并行实现；二者完成并集成后再启动 03。各任务一个 worktree、一个最终 commit。

- 01 独占 core 响应入口、对应响应测试、新增 `bench/native-json.ts`。
- 02 独占 `http/body.ts`、对应字节读取测试、新增 `bench/native-body.ts`。
- 03 独占本轮共享产品/开发文档与 `bench/README.md`，根据最终实现改写说明。
- 01、02 不修改共享 benchmark 驱动、基线或 README；跨任务文件变更先调整依赖。
- 所有性能测量串行占用协调器分配的独占时段，避免构建/测试/其他 agent 打流干扰。
- 队列 README 与完成归档由协调器集成时串行更新，任务 agent 不争写队列。

## 共同验收

- 先读 plan 与 `docs/api-freeze.md`。保持导出、最低 Bun、cookie/HTTP/DI 语义和浏览器客户端边界。
- 01、02 的采用条件是行为等价且有可复现收益；无收益时交付 benchmark 和未采用记录，不能将评估通过描述为迁移完成。
- 实现任务运行定向测试、根 typecheck/lint/build/test 和 diff 检查；新旧版本的行为对照不能依赖改写旧测试期望。
- 03 与协调器按 plan 的合并态清单验收，包括 Bun 1.4.0、当前 1.4.2、12 包打包、core coverage、双语 docs、两个新 benchmark 与原 HTTP gate。
- 性能测量保留每轮结果、版本、硬件、命令和 before/after commit；不得自动重录 `bench/baseline.json` 或降低门槛。
- 不执行其他计划 roadmap，不做包版本/依赖升级、push、发布或部署。

## 初始状态与启动条件

三个任务均待执行。规划阶段 typecheck/lint 与 416 项定向测试通过；这是既有工作区基线，不是任务完成结果。

起草时存在 plan 外 6 个用户改动文件，清单见 plan，初次运行因此停止。用户随后明确要求提交并继续；这些文件已完整提交为 `4466df7a74864ffde5d83ab0dcb6824f473bbd50`，再次检查工作区只剩本目录。原阻塞已解决，单独提交本计划后自动启动，执行器从包含计划的干净 HEAD 开始。当前默认值与每个 todo 的 agent/difficulty 已保存，协调器不得重新猜测。
