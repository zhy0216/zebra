difficulty: easy
agent: inherit

# 11 · 为 PR 增加文档构建检查

来源：plan.md F18。优先级：P2。一个独立 worktree，一个最终 commit。

## T1 · 增加无需部署权限的 docs job

- 要做什么：在现有 CI workflow 添加独立 job，复用 checkout/setup-bun 与 frozen install 模式，执行 DOCS_BASE=/zebra/ bun run docs:build，覆盖双语路由和链接构建。保持现有 push/pull_request 触发条件。
- 预计修改文件：`.github/workflows/ci.yml`。
- 验收条件：PR 及现有 CI push 都会构建 docs；使用 Bun 1.4 与冻结锁文件；成功产出双语页面；job 不依赖 GitHub Pages environment、secret、pages:write/id-token:write，也不上传/部署站点。已有 full / coverage job 不丢失。
- 前置依赖：无。

## 校验与交付

运行 `DOCS_BASE=/zebra/ bun run docs:build`、`bun run typecheck`、`bun run lint`、`git diff --check`；检查 YAML 结构与触发条件。纯工作流改动无需编写镜像式测试。不要在远端触发 workflow 或改 deploy-docs.yml。
