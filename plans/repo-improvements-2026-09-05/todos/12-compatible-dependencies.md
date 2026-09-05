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

## 部分交付与阻塞记录（2026-09-05）

**部分完成：Bun 类型更新已验证；Zod 4.5.4 因冻结 JSON Schema 输出变化延后，原验收未全部通过。** 本任务仍为 partial；Zod 更新为 deferred / blocked。协调器已独立复核并限定本次可集成范围为 Bun 类型更新，本文件保留原需求及原路径，不归档到 `done/`。

执行配置：agent `codex`，model `gpt-6-astra`，effort `xhigh`，由同一任务 agent 实现和复验。Bun runtime 始终为 `1.4.0`。

### 实际依赖变更

`bun.lock` 仅有两条解析变化：

| 依赖 | 原解析 | 交付解析 | 原因 |
| --- | --- | --- | --- |
| `@types/bun` | `1.4.0` | `1.4.1` | 现有 `^1.4.0` 范围内的指定更新 |
| `bun-types` | `1.4.0` | `1.4.1` | `@types/bun@1.4.1` 的必需精确依赖 |

Zod 恢复原 `4.4.3` 解析、下载地址和完整性值，manifest 中 `^4` 不变。全部 Zebra 包保持 `1.0.0`、源码发布策略及 v1 exports / 签名 / 语义不变；未修改源码或测试期望。`@types/node@25.8.0`、Biome `1.9.4`、VitePress `1.6.4`、Vite `5.4.21`、esbuild `0.21.5` 均未更新，未增加 override。

### Zod 候选失败与旧解析对照

以下全量数据来自 rebase 前的任务工作树，基线为 `fbb28c1796faf93959a703d5e97d56c53603f4bc`。双更新候选仅包含上述两条 Bun 类型解析及 `zod@4.5.4`，从未提交。

| 候选 | 定向回归 | `bun run test` |
| --- | --- | --- |
| Bun 类型 `1.4.1` + Zod `4.5.4` | exit 1；217 pass / 3 fail，804 assertions，20 files | exit 1；1151 pass / 3 fail，18,880 assertions，114 files |
| Bun 类型 `1.4.1` + 原 Zod `4.4.3` | exit 0；220 pass / 0 fail，812 assertions，20 files | exit 0；1154 pass / 0 fail，18,888 assertions，114 files |

三个既有失败断言均位于 `packages/schema-zod/test/schema.test.ts`：

- `:69`，`object intersections close the combined shape and retain member assertions`：原期望保留的 `allOf` 成员消失，输出变为合并后的对象。
- `:124`，`mixed intersections preserve explicit strict and catchall constraints`：期望的 `out.allOf` 变为 `undefined`；断言首先在 strict 对象案例失败，独立探针同时记录了 catchall 交集的结构变化。
- `:136`，`unions, enums, literals, records and nullable are expressed`：首个 string / number union 断言期望 `anyOf`，实际为 `type` 数组。该测试尚未执行 nullable 断言；独立探针确认 nullable 同样由 `anyOf` 变为 `type` 数组。

两版 Zod 的同输入 HTTP 探针状态相同：strict 对象交集均为 `200`，带数值 catchall 而 `b` 为字符串的交集均为 `422`。已确认的是 JSON Schema 结构差异，不能把上述证据表述为 HTTP 状态回归。双更新候选的其余定向回归（包括 Ajv 校验、可选 namespace、server / client）通过，但不能据此掩盖三个冻结输出断言失败。只恢复 Zod 解析、不改源码或旧期望后，定向及全量测试全部通过。

定向命令：

```sh
bun test packages/schema-zod/test packages/mcp/test packages/core/test/contract packages/client/test packages/contract/test packages/testing/test
```

两种候选的 `bun install --frozen-lockfile`、`bun run typecheck`、`bun run lint`、`bun run build`、`bun run verify:packages`、`DOCS_BASE=/zebra/ bun run docs:build` 均为 exit 0；打包验证覆盖全部 12 个包的 tarball、独立安装、imports 和 types。仅 Bun 类型候选重复 frozen install 后锁文件 SHA-256 不变，`git diff --check` 为 exit 0。

两种候选的 `bun audit --registry https://registry.npmjs.org` 均为 **exit 1**，仅余 R01 相同的 4 条工具链告警（1 high、3 moderate），没有解决 R01：

- esbuild `0.21.5`：moderate，`GHSA-67mh-4wv8-2f99`。
- Vite `5.4.21`：moderate，`GHSA-v6wh-96g9-6wx3`；moderate，`GHSA-4w7w-66w2-5vf9`；high，`GHSA-fx2h-pf6j-xcff`。

### 官方依据与集成边界

- [Zod 4.5.0 官方发布说明](https://github.com/colinhacks/zod/releases/tag/v4.5.0)包含对象交集合并（#6461）和简单 `anyOf` union 压缩为 `type` 数组（#6339），与本次实测结构变化对应。
- [Zod 4.5.4 官方发布说明](https://github.com/colinhacks/zod/releases/tag/v4.5.4)记录循环遍历触发 default factory 的修复（#6500）；[npm 官方 4.5.4 元数据](https://registry.npmjs.org/zod/4.5.4)确认指定版本及完整性值。
- [Bun 1.4.1 官方类型变化说明](https://bun.com/blog/bun-v1.4.1#typescript-types)记录 DOM `Event.composedPath()`、Node process listener 及 fetch protocol 类型修复；本次没有升级 Bun runtime。
- [npm 官方 @types/bun 1.4.1 元数据](https://registry.npmjs.org/@types/bun/1.4.1)声明精确依赖 `bun-types@1.4.1`；[bun-types 1.4.1 元数据](https://registry.npmjs.org/bun-types/1.4.1)仍声明 `@types/node: "*"`。交付的两项完整性值均与官方 registry 一致。

原始失败日志、双更新候选锁文件、旧解析对照和官方页面快照保存在本机 `/tmp/zebra-todo12-validation.uJhzHa/`，汇总为该目录的 `report.md`；上述关键证据已同时记录于本文件。

串行集成基线为 `master` / `2b8ea7970b862cf0d96f53de8ea72f31a7bdaa0b`。本任务分支已无冲突 rebase 到该提交；本阶段复验 frozen install、上述定向测试、typecheck、lint 和 `git diff --check` 均为 exit 0，定向仍为 220 pass / 0 fail。新集成态的全部仓库门禁、docs 和 audit 由协调器随后执行；本阶段不重跑全量或 benchmark，不改变 Zod deferred / blocked 的结论。
