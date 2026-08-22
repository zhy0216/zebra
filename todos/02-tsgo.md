# P0 · 用 tsgo 取代 tsc

条目 id：`TSGO-1`

状态：`pending`

## 问题

当前 workspace 的类型检查脚本都调用 `tsc --noEmit`，根依赖还是 TypeScript 5.x；发布包 smoke test 也会临时安装并调用 `tsc`。目标是让 native TypeScript compiler `tsgo` 成为唯一、可复现的类型检查入口。

## 实现思路

1. 使用官方 `@typescript/native-preview` 包提供 `tsgo` binary，并将实际解析到的版本写入 `package.json`/`bun.lock`。不要依赖开发机全局安装的 tsgo；执行时通过 workspace 本地 bin 解析。
2. 逐个检查所有 workspace manifest，把 `typecheck` script 统一改为 `tsgo --noEmit`。保留根 `bun --filter='*' run typecheck` 的聚合语义，不要用脚本别名偷偷调用 tsc。
3. 更新 `scripts/verify-packages.ts` 的 fresh project：安装 `@typescript/native-preview` 与 `@types/bun`，用 `bun x tsgo --noEmit` 验证发布包的 `main`、`types` 和 `exports`。同时确认 smoke 项目不会因为包的 peer dependency 又解析回旧 TypeScript。
4. 先用 native compiler 跑完整 `tsconfig.json`，再按错误类别修复。当前全局 tsgo 预检已暴露示例 contract 类型推导、批量 implement 的 `@ts-expect-error` 差异和 facade 导出类型差异；这些必须逐项判断是代码问题、测试预期问题还是 tsgo 尚未支持的语义。
5. 修复时保持 `strict`、`noUncheckedIndexedAccess`、`exactOptionalPropertyTypes` 等约束，不用 `any`、`@ts-ignore`、删除 type test 或改回 tsc 掩盖问题。只有确认 native compiler 不支持某个选项时，才做最小配置调整并在代码/提交说明中记录原因。
6. 检查 VitePress、Biome 和发布脚本是否把 `typescript` 当作自己的 peer dependency。若必须保留传递依赖，说明它不是本仓库的类型检查器；否则删除根直接 `typescript` 依赖。
7. 工具链文档正文由 04 统一修改；本文件只改脚本、配置、验证工具和必要的 compiler-specific 注释。

## 涉及文件（初始所有权）

- 根 `package.json`；
- 各 `packages/*/package.json` 的 `typecheck` script；
- `scripts/verify-packages.ts`；
- `tsconfig.json`、`tsconfig.base.json` 或子项目 tsconfig（仅在 tsgo 必需时）；
- 受 tsgo 诊断直接影响的类型实现和 type tests；不修改与 compiler 无关的业务行为。

## 验收条件

- `rg` 在 active scripts、CI 检查脚本和工具链配置中找不到 `tsc --noEmit` 或 `bun x tsc` 作为本仓库检查器。
- `bun run typecheck` 使用 workspace 安装的 `tsgo` 并通过，且 `tsgo --version` 可从依赖重现。
- `bun run verify:packages` 在全新临时项目中安装 tarball 后，使用 `bun x tsgo --noEmit` 完成类型检查。
- 受影响的 type tests 没有被删除或放宽；`bun run build` 和相关测试通过。

## 验证命令

```sh
bun install --frozen-lockfile
bun x tsgo --version
bun run typecheck
bun run build
bun run verify:packages
```

## 风险与处理

- native compiler 仍处于 preview，诊断可能比 tsc 更严格或存在实现差异。每个差异都要留下最小代码证据；无法在本 todo 范围内解决时标为 `blocked`，不要悄悄回退。
- `@typescript/native-preview` 版本会快速变化。使用锁文件固定版本，并把最终版本写入实现报告，避免“latest”导致下次无法复现。
