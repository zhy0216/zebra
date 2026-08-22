# Todos

这是仓库的有序工作队列，按 `$finish-todo` skill 的规则处理：一次只推进一个 todo 文件；每个文件都必须有独立实现、对抗式复核和仓库级校验证据，完成后才能归档到 `todos/done/`。

## 顺序

| 顺序 | 优先级 | 文件 | 条目 id | 问题 | 依赖 | 状态 |
| ---: | --- | --- | --- | --- | --- | --- |
| 01 | P0 | [01-bun-1.4.md](done/01-bun-1.4.md) | `BUN-1` | Bun 1.4 运行时基线 | 无 | ✅ |
| 02 | P0 | [02-tsgo.md](done/02-tsgo.md) | `TSGO-1` | `tsc` → `tsgo` | 01 | ✅ |
| 03 | P0 | [03-zod-4.md](03-zod-4.md) | `ZOD-1` | Zod 3 → Zod 4 | 02 | pending |
| 04 | P0 | [04-docs-current-baseline.md](04-docs-current-baseline.md) | `DOC-1` | 文档切换到当前项目基线 | 01–03 | pending |

当前项目是新项目。文档以当前技术基线为准，不新增旧项目迁移说明，也不承诺对旧运行时、旧编译器或旧依赖的向后兼容。

## 执行顺序

严格按 01 → 04 串行处理。每个文件只解决一个问题；后一个文件可以使用前一个文件已经提交的配置、依赖和验证结果，但不要提前修改后续文件的所有权范围。

实现 agent 需要在完成后返回：条目状态、修改文件、实现摘要、局部校验证据和剩余风险。复核 agent 只读，不得修改文件或执行 git 写操作。

## 完成定义

- 所有目标条目均标记为 `done`，且有独立复核证据。
- 每个 todo 的局部命令和最后的仓库级命令都通过：`bun run typecheck`、`bun run build`、`bun test`、`bun run lint`、`bun run docs:build`、`bun run verify:packages`；基准任务按对应 todo 的要求执行。
- 依赖变更与 `bun.lock` 一致，工作区无未解释的 diff。
- 完成的 todo 文件移动到 `todos/done/`，并同步更新本表。
