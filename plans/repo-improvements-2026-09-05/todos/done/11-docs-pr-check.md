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

## 完成记录

- 状态：已完成，串行集成阶段复验通过并归档，待协调器仓库级校验与合并。
- 执行：agent `codex`，model `gpt-6-astra`，effort `high`。
- 集成基线：`fbb28c1796faf93959a703d5e97d56c53603f4bc`。执行 rebase 后提示当前分支已是最新，无冲突。
- 实现：仅在 `.github/workflows/ci.yml` 新增独立 docs job，沿用 checkout/setup-bun、Bun 1.4 和 frozen install，设置 `DOCS_BASE=/zebra/`。job 仅授予 `contents: read`，无 Pages environment、secret、Pages/OIDC 写权限、上传或部署步骤。
- 结构验收：actionlint 与 Bun YAML 解析通过；与 master 比对确认 push/pull_request 触发条件及 full、coverage job 完全保留。
- 构建验收：产出根目录 HTML 20 页、中文 HTML 19 页；英文与中文首页的语言标记、`/zebra/` 资源路径及中文导航链接通过检查。

串行集成阶段命令与结果：

| 命令 / 检查 | 结果 |
| --- | --- |
| `bun install --frozen-lockfile` | exit 0，无依赖改动，Bun 1.4.0 |
| `DOCS_BASE=/zebra/ bun run docs:build` | exit 0，VitePress 1.6.4，3.39s |
| `bun run typecheck` | exit 0 |
| `bun run lint` | exit 0，255 files，No fixes applied |
| `actionlint .github/workflows/ci.yml` | exit 0 |
| Bun YAML 比对与双语 HTML 产物检查 | exit 0 |
| `git diff --check` | exit 0 |

现有限制：文档配置已有 `ignoreDeadLinks: true`，本 job 不会拦截所有死链接；该配置超出本任务范围，保持原样。未触发远端 workflow，未修改 `deploy-docs.yml` 或依赖，无 blocker。
