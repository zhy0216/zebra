difficulty: medium
agent: inherit

# Bun 定位说明、性能记录与整体验收

## T1 · 按实际实现更新 Bun 说明与 benchmark 记录

要做什么：

等 01、02 完成并集成后，读取其最终源码和原始结果。将 README 的 Bun 定位表述为直接面向 Bun 运行时；说明采用的 API、保留的必要 fs/path/timingSafeEqual 调用及浏览器客户端边界。保留用户已有 session HMAC 工作的来源，仅报告复核过的数字。候选未采用时明确说明，不能笼统宣称全部原生化。

预计修改的文件：

- `README.md`
- `docs/README.md`
- `docs/zh/README.md`
- `CONTRIBUTING.md`
- `bench/README.md`
- `docs/05-http.md` 与 `docs/zh/05-http.md`，仅在最终实现需要补充维护说明时同步；避免给产品使用流程增加无关内部细节。

验收条件：

- 两种语言的 Bun 定位和最低版本一致，不暗示所有 `node:` 导入已删除，也不更改 API freeze 或运行时要求。
- benchmark 文档提供新脚本的准确运行方法、before/after 基线 commit、每个版本的环境、轮数、中位数及完整数据位置。
- 对 01、02 分别给出采用/未采用结论和原因。局部成本与 HTTP gate 分开解释，包含无收益/退化结果。
- session 签名若被用户保留，复跑后注明它是本轮之前的实现；不把旧数字复制成本轮其他路径收益。
- 不改业务实现、测试预期、包版本/依赖、共享 benchmark gate 或 baseline。

前置依赖：依赖 01-native-json.md；依赖 02-native-body.md，均须完成并集成。

## T2 · 复核最低 Bun 与最终仓库门禁

要做什么：

按 plan 的合并态命令在隔离 Bun 1.4.0 和当前 Bun 1.4.2 下验证，检查 src-direct 包导入以及 client/contract 浏览器边界。由协调器安排两个新 benchmark 与原 HTTP gate 的独占测量时段。复核已有证据即可，不在没有新修改/失败的情况下反复重跑同一门禁。

预计修改的文件：测量方法和稳定结论写入 `bench/README.md`；协调器按 herdr-finish-plan 将完成证据写入计划记录并归档任务，本任务 agent 不并行修改共享队列。

验收条件：

- typecheck、lint、build、全量 test、12 包 verify:packages、core coverage/check:coverage、带 `/zebra/` base 的双语 docs 构建均通过。
- 两个新 benchmark 能复现；原 `bun run bench:check` 结果完整报告，失败不改 baseline/门槛掩盖。
- 最低 Bun 的验证使用隔离可执行文件，不更改用户全局安装、packageManager、engines、CI 或锁文件。若无法验证，保留未完成状态和原因。
- 对每条命令记录版本、HEAD、退出码；不得把历史计划或规划阶段结果当作最终验收。
- 文档与实际代码一致，所有链接存在，`git diff --check` 通过；不为纯文本修改新写测试。

前置依赖：依赖 01-native-json.md；依赖 02-native-body.md；最终 docs 构建在本文件 T1 文档修改后执行。

## 验证方式

执行 [plan.md](../plan.md) 的“合并态验收”全部命令，并在隔离 Bun 1.4.0 下按同一清单复核。纯文档修改不需要新增测试；若门禁发现代码问题，交由对应原任务修复并串行集成，再补受影响检查，不能降低验收要求。
