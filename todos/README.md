# Todos

这是仓库的有序工作队列，按 `$finish-todo` skill 的规则处理：一次只推进一个 todo 文件；文件中的每个条目都必须有实现、独立复核和仓库级校验证据，完成后才能归档到 `todos/done/`。

## 顺序

| 优先级 | 文件 | 条目 | 状态 |
| --- | --- | --- | --- |
| P0 | [01-tech-stack-upgrade.md](01-tech-stack-upgrade.md) | T1–T8 | pending |

当前项目是新项目。文档以当前技术基线为准，不新增旧项目迁移说明，也不承诺对旧运行时、旧编译器或旧依赖的向后兼容。

## 完成定义

- 所有目标条目均标记为 `done`，且有独立复核证据。
- `bun run typecheck`、`bun run build`、`bun test`、`bun run lint`、`bun run docs:build` 和 `bun run verify:packages` 通过；基准任务按 todo 中的要求执行。
- 依赖变更与 `bun.lock` 一致，工作区无未解释的 diff。
- 完成的 todo 文件移动到 `todos/done/`，并同步更新本表。
