# 05 · v1.0 发布准备

设计来源：`docs/superpowers/specs/2026-05-16-zebra-v2-design.md` §9 Phased Delivery（v1.0 行）。

## C1 · API 冻结评审 {#c1}

- 全包导出面审查：`packages/core/src/index.ts` 及各包 `index.ts`，对照 README「Public API surface」与 llms.txt，补缺、清理不稳定项
- 冻结清单写入 `docs/`（API 稳定承诺 + 版本策略：什么级别变更需要 major）
- 各包版本统一推进到 v1.0.0

涉及文件：`packages/*/src/index.ts`、`README.md`、`docs/`。

## C2 · 文档站点 {#c2}

- 静态文档站点（方案不限：VitePress / 纯静态生成均可，先写设计再动手）
- 内容源自现有 README、llms.txt、design specs；覆盖：快速上手、DI、路由/中间件、contract-first、会话/CORS/限流/WS 各包、迁移指南
- 部署方式：静态托管即可，不要求 Server 渲染

涉及文件：`docs/` 站点目录（新建）、README 加链接。

## C3 · Benchmark 页 {#c3}

- 对标 Hono / Elysia 的基准脚本（`bench/` 目录）：路由吞吐（静态/参数/通配）、中间件链、JSON 序列化
- 结果表格 + 复现说明写入 `bench/README.md`，发布到文档站点
- 用真实 `bun run` 可复现，记录 Bun 版本

涉及文件：`bench/`（新建）、`docs/` 站点。

## C4 · 发布流程 {#c4}

- 版本号统一管理与发布脚本（`scripts/release.ts` 之类）：各包同步 bump、生成 changelog、`bun publish` 顺序（contract → client → core → testing → zebra，facade 最后）
- npm 包 `files` 字段与构建产物检查（dist 输出、types 声明）

涉及文件：`scripts/`、各 `package.json`。

## Done criteria

- 所有包 `v1.0.0` 发布，`bun run typecheck && bun run test` 全绿
- README Status 标 v1.0
