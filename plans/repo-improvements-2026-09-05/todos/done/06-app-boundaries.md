difficulty: hard
agent: inherit

# 06 · 修复应用配置与路由快照边界

来源：plan.md F09、F10、F11、F12。优先级：P1（包含 P2 配置问题）。一个独立 worktree，一个最终 commit；这些改动均集中在 app.ts。

## T1 · 生成不修改用户对象的循环安全快照

- 要做什么：替换 routeTable 的 shallow-copy + deepFreeze。复制并冻结自有 metadata/errors/mcp 等普通数据图，使用身份表处理循环和共享引用；schema、函数和其他外部实例不递归遍历/冻结，保留可调用语义。
- 预计修改文件：`packages/core/src/app/app.ts`、`packages/core/test/contract/route-table.test.ts`；必要时新增仅供 app 使用的 `packages/core/src/app/route-snapshot.ts`。
- 验收条件：访问 routeTable 后原 meta/tags/errors 仍可修改；已取得的普通元数据快照不随原对象后续修改而变化；循环 meta 不溢栈，重复引用保持关联；table/route/contract 冻结；调用者 Zod/自定义 Standard Schema 未被冻结，读取表后 dispatch 的验证、转换和错误仍正常。不能 structuredClone 整个 contract，不能调用任意 schema getter 来深遍历。
- 前置依赖：无。

## T2 · 在构造阶段拒绝会失效的非有限配置

- 要做什么：校验合并后的 sessionTtl/session.ttl、gracePeriod、requestTimeout 及 body.maxSize/json.limit/form.limit/multipart.limit/maxFiles/maxFileSize，拒绝 NaN 和正负 Infinity。保持现有有限值范围和默认值，不额外将合法小数或零上限收紧成新 API。
- 预计修改文件：`packages/core/src/app/app.ts`；新增 `packages/core/test/app/options-validation.test.ts`；需要时更新 `packages/core/src/app/types.ts` 中说明和 `docs/05-http.md`、`docs/zh/05-http.md` 的配置约束。不修改 http/body.ts（07 所有）。
- 验收条件：非法配置在实例构造阶段失败，时间项使用已有 RangeError 类别；非法 body 值按一致可诊断的 RangeError 失败；不创建服务器/timer、不进入 handler。覆盖别名优先级、每个字段、默认值、gracePeriod=0、body 零上限。原探针 maxSize=NaN/json.limit=1 不能继续得到超限 200；合法 limit=1 的超限请求仍返回 413，正常小请求成功。保留所有已支持且有意义的有限输入。
- 前置依赖：无（可与 T1 在本 worktree 内顺序完成）。

## 校验与交付

运行 `bun test packages/core/test/contract/route-table.test.ts packages/core/test/app/options-validation.test.ts packages/core/test/app/timeout.test.ts packages/core/test/http/body.test.ts`、`bun run typecheck`、`bun run lint`、`DOCS_BASE=/zebra/ bun run docs:build`、`git diff --check`。不修改其他任务的源文件或已有 session/timeout 测试；新增测试采用本文件指定路径。

## 完成记录

- 状态：已完成本任务全部验收；2026-09-05 在协调器持有集成锁期间归档，待协调器仓库级校验与合并。
- 执行 agent：codex；model：gpt-6-astra；effort：max。
- 集成基线：`8af73f3e275dab53d56c7f792d36c658f961f8b5`。在本任务 worktree 执行 rebase 成功，无冲突，无需修改实现。
- T1 快照隔离：普通 metadata/errors/mcp 数据复制后冻结，原 meta/tags/errors 和 MCP 声明仍可修改，旧快照不随原对象变化。身份表保留循环及跨字段、跨路由的共享引用，table/route/contract 保持冻结。
- T1 外部边界：Zod、自定义 Standard Schema、函数及其他外部实例保留原引用；读取快照时 schema getter 调用次数为 0。dispatch 的输入转换、输出裁剪与转换、422 输入错误和 500 输出验证错误均通过回归测试。
- T2 非有限配置：10 个配置入口分别覆盖 NaN、正负 Infinity，均在构造阶段抛出带字段名的 RangeError；未创建服务器或 timer，未进入应用回调。
- T2 兼容范围：覆盖 sessionTtl 优先于 session.ttl、默认值、原有有限范围、小数值、gracePeriod=0，以及各 body 零上限。maxSize=NaN/json.limit=1 在构造时失败；合法 json.limit=1 的小请求成功、超限请求返回 413。
- 文件边界：实现只涉及 app.ts、私有 route-snapshot.ts、app/types.ts、指定两个测试文件及双语 HTTP 文档；保留 master 已合入任务，不修改其他任务源码或已有 session/timeout 测试。

rebase 后重新运行的校验：

| 命令 | 结果 |
| --- | --- |
| `bun test packages/core/test/contract/route-table.test.ts packages/core/test/app/options-validation.test.ts packages/core/test/app/timeout.test.ts packages/core/test/http/body.test.ts` | exit 0；73 pass / 0 fail，385 expect()，4 files |
| `bun run typecheck` | exit 0 |
| `bun run lint` | exit 0；252 files，No fixes applied |
| `DOCS_BASE=/zebra/ bun run docs:build` | exit 0；VitePress 1.6.4，3.19s |
| `git diff --check` / `git diff master --check` | exit 0 |

无剩余 blocker。audit 和 benchmark 留待协调器安排仓库级校验；本任务未修改真实 benchmark baseline。README 仅更新本任务的完成状态及 done/ 链接，plan.md 和其他任务状态保持不变。
