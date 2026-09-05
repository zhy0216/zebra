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
