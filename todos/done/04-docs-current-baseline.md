# P0 · 文档切换到当前项目基线

条目 id：`DOC-1`

状态：`pending`

## 问题

现有文档混有旧 Zebra、v1/v2、归档、历史兼容和旧工具链信息。这个仓库按新项目维护，文档应该只说明当前可运行的技术栈和 API，不应引导读者做旧版本迁移或期待向后兼容。

## 实现思路

1. 先用 `rg` 建立文档命中清单，区分三类内容：
   - 必须移除的产品历史/迁移/向后兼容叙事（旧 Zebra、v1/v2 rewrite、2019 archive、旧版本支持承诺）；
   - 必须更新的当前工具链信息（Bun 1.4、Zod 4、tsgo、Docker tag、CI 和验证命令）；
   - 必须保留的外部协议和安全事实（如 Standard Schema V1、RFC 9457、cookie/session 安全行为）。
2. 只在技术 todo 01–03 完成后写入最终版本号和命令，避免文档先改成一个尚未实际安装的版本。英文与中文页面成对修改，不能只更新一侧。
3. 更新 README、贡献指南、入门、生产部署、MCP/schema adapter、llms context、基准说明和导航交叉链接。把 `tsc`/TypeScript 5.6、Bun 1.3/1.1.30、Zod 3 改成当前工作流。
4. 处理 `docs/api-freeze.md` 与中文对应页：若保留，改成当前 API/约束说明，不再承诺旧项目或旧 API 的稳定/向后兼容；若删除，必须同步 VitePress 导航、README 链接和中英文交叉链接。不要删除仍然准确的协议版本号或安全说明。
5. `CHANGELOG.md` 是历史记录，不为了“看起来整齐”重写已发布事实；只有其中存在会被读者误认为当前支持政策的旧叙述时才做最小修订。`plan.md` 等设计文档也要移除已不适用的旧兼容约束，或明确标为当前设计。
6. 基准结果要么在 Bun 1.4 下重测并记录机器、版本和命令，要么删除过时的硬编码数字，只保留可复现的 benchmark 命令；不要继续把 Bun 1.3 作为当前基线。
7. 最后构建 docs site 并做反向链接/版本扫描，确保没有只在某个语言页面、llms 文件或代码块里残留旧信息。

## 涉及文件（初始所有权）

- `README.md`、`CONTRIBUTING.md`、`llms.txt`、`SECURITY.md`、`plan.md`；
- `docs/README.md`、`docs/zh/README.md`、`docs/01-getting-started.md`、`docs/zh/01-getting-started.md`、`docs/11-contract-first.md`、`docs/zh/11-contract-first.md`、`docs/15-production.md`、`docs/zh/15-production.md`、`docs/16-mcp.md`、`docs/zh/16-mcp.md`、`docs/api-freeze.md`、`docs/zh/api-freeze.md`、`docs/07-sessions.md` 中相关工具链/兼容表述；
- `bench/README.md`；必要时 `CHANGELOG.md` 只做最小、可解释的修订。

## 验收条件

- 当前文档不再把旧 Zebra、旧运行时、旧编译器或旧 Zod 作为需要迁移/兼容的对象，也不新增 migration guide 或兼容矩阵。
- 所有运行要求、Docker 示例、工具链命令和 tarball typecheck 说明与 01–03 的实际配置一致：Bun 1.4、Zod 4、tsgo。
- 英文和中文页面同步，导航和链接不指向删除或不存在的历史文档。
- `Standard Schema V1`、协议/安全语义和当前 API 细节仍准确保留。

## 验证命令

```sh
bun run docs:build
bun run lint
rg -n -i 'Bun (1\.1|1\.3)|zod v3|typescript [><=≥]|tsc --noEmit|v1-archive|2019|zebra v2|backward|backwards|向后兼容|迁移指南' \
  README.md CONTRIBUTING.md llms.txt docs bench/README.md
bun run bench:check
git diff --check
```

扫描命中需要逐项判断：协议中的 `Standard Schema V1`、历史 changelog 记录和安全行为不能被误删；但它们也不能继续被写成当前运行时支持承诺。

## 风险与处理

- 删除或重命名 API freeze 页面可能产生大量链接变更。先更新导航和交叉链接，再运行 docs build；不要留下断链。
- “兼容”一词有时描述当前 API alias 或安全行为，而非旧项目支持。只移除历史兼容承诺，不改变实际 API，除非用户另有要求。
