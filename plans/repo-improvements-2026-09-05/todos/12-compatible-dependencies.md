difficulty: medium
agent: inherit

# 12 · 更新现有范围内的 Bun 类型与 Zod 解析

来源：plan.md F19。优先级：P2。一个独立 worktree，一个最终 commit。

## T1 · 定向更新依赖锁定版本

- 要做什么：核对本轮 registry 快照 @types/bun 1.4.1 与 Zod 4.5.4，阅读适用的官方变化说明，在现有 ^1.4.0 / ^4 范围内定向更新解析。保持 Bun runtime 1.4.0、全部 Zebra 包 1.0.0、源码发布策略和现有依赖范围。
- 预计修改文件：`bun.lock`；不应需要修改 manifest，如工具自动改了 package.json 中无关范围应恢复该自动更改。不要整仓 bun update 或强制 audit fix --latest。
- 验收条件：锁文件显示指定两项更新且只有必需相关解析变化；bun install --frozen-lockfile 可重复；未引入 Biome 2、VitePress/Vite/esbuild 的越界 override 或无关更新。新 Zod 的 JSON Schema、交集、可选 namespace、Ajv 校验和 server/client 回归全部通过；不以调整旧期望来掩盖冻结语义变化。
- 前置依赖：无；只改锁文件，不并行修改源码或测试。

## 校验与交付

运行 `bun install --frozen-lockfile`、`bun run typecheck`、`bun run lint`、`bun run build`、`bun run test`、`bun run verify:packages`、`DOCS_BASE=/zebra/ bun run docs:build`、`bun audit --registry https://registry.npmjs.org`、`git diff --check`。audit 允许仅余 plan 中 R01 的相同 4 条告警，须如实报告 exit 1。若依赖要求超出当前冻结语义，提供具体失败与影响，交协调器处理，不擅自修改别的任务文件或升级运行时。
