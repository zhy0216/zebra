difficulty: medium
agent: inherit

# 12 · 更新 Bun 类型与 Zod 解析

来源：plan.md F19。优先级：P2。一个独立 worktree，一个最终 commit。

**状态：已完成（2026-09-06）。** Bun 类型 1.4.1 已在首轮交付，本次完成 Zod 4.5.4 升级及新版 JSON Schema 适配，全部功能与工程验收通过；audit 仍为原有 4 条告警、exit 1。

## 本轮范围覆盖（2026-09-06）

用户明确要求完成本任务，并说明「不需要考虑向后兼容」。本轮据此采用 Zod 4.5.4 的原生 JSON Schema 格式，允许修改适配器、测试期望和相关文档，覆盖原任务「只改锁文件」「不得改变冻结输出」及遇到结构变化即阻塞的限制。验证以新版输出和实际校验行为为准。Bun runtime、Zebra 包版本、源码发布策略及依赖范围继续按原任务保持。

## T1 · 定向更新依赖锁定版本

- 要做什么：核对本轮 registry 快照 @types/bun 1.4.1 与 Zod 4.5.4，阅读适用的官方变化说明，在现有 ^1.4.0 / ^4 范围内定向更新解析。保持 Bun runtime 1.4.0、全部 Zebra 包 1.0.0、源码发布策略和现有依赖范围。
- 修改文件：`bun.lock`、`packages/schema-zod/src/index.ts`、schema-zod/MCP 的相关测试、双语 MCP 文档及本任务完成记录。不改 manifest，不整仓 bun update 或强制 audit fix --latest。
- 验收条件：锁文件显示指定两项更新且只有必需相关解析变化；bun install --frozen-lockfile 可重复；未引入 Biome 2、VitePress/Vite/esbuild 的越界 override 或无关更新。新 Zod 的 JSON Schema、交集、可选 namespace、Ajv 校验和 server/client 回归全部通过；使用有效及无效输入验证交集、catchall 与 union 约束。
- 前置依赖：无；本轮在独立 worktree 内串行完成。

## 校验与交付

运行 `bun install --frozen-lockfile`、`bun run typecheck`、`bun run lint`、`bun run build`、`bun run test`、`bun run verify:packages`、`DOCS_BASE=/zebra/ bun run docs:build`、`bun audit --registry https://registry.npmjs.org`、`git diff --check`，并执行 plan 中的 core 覆盖率和 benchmark 门禁。audit 允许仅余 plan 中 R01 的相同 4 条告警，须如实报告 exit 1。

## 首轮部分交付与阻塞记录（2026-09-05，历史）

**首轮部分完成：Bun 类型更新已验证；当时 Zod 4.5.4 因冻结 JSON Schema 输出变化延后，原验收未全部通过。** 协调器当时限定可集成范围为 Bun 类型更新，任务保留在 `todos/`，状态为 partial，Zod 为 deferred / blocked。以下记录保留首轮证据；当前状态见本轮完成记录。

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

## 本轮完成记录（2026-09-06）

续作基线为 `master` / `ecc31151aba0069633474f9ece7819bd44d9a4d8`，使用独立 worktree 完成实现和验证，交付为一个本地提交。用户已解除本任务的向后兼容限制，首轮冻结输出阻塞已解决。

### 交付变化

- `bun.lock` 相对续作基线只有 Zod 一条解析变化：`4.4.3` → `4.5.4`，使用 npm 官方 tarball 地址和现场核对的 SHA-512 完整性值。既有 `@types/bun` / `bun-types` 均为 `1.4.1`。
- 适配器采用 Zod 原生交集合并，删除重复的 `mergeObjectIntersection`；合并后的普通对象继续封闭额外字段。原生保留的 `allOf` 子树不再自行合并或加封闭约束，避免成员互相拒绝字段。
- 格式断言明确采用合并对象和简单 union/nullable 的 `type` 数组。带限制的 union 继续保留 `anyOf`；重叠字段及 catchall 冲突继续保留全部断言。
- Ajv 与 MCP dispatch 使用同一组有效/无效输入，覆盖嵌套交集、严格对象、注解导致未合并的交集、catchall 冲突、type 数组、受约束 union、nullable 对象及 transform/default 输入。补充 type 数组和 nullable 的 body namespace 必填回归，双语 MCP 文档说明新版格式。
- Bun runtime 仍为 `1.4.0`；全部 manifest、Zebra 包 `1.0.0`、依赖范围、源码发布方式与 benchmark baseline 均未改变。

本轮重新读取 [Zod 4.5.0 发布说明](https://github.com/colinhacks/zod/releases/tag/v4.5.0)的 #6461 / #6339、[Zod 4.5.4 发布说明](https://github.com/colinhacks/zod/releases/tag/v4.5.4)的 #6500，并核对 [npm 4.5.4 元数据](https://registry.npmjs.org/zod/4.5.4)及安装包的转换实现。

### 验证结果

只替换 Zod 锁定解析时复现首轮的三个格式失败：217 pass / 3 fail。完成适配后使用上方同一定向命令得到 245 pass / 0 fail，1,097 assertions，20 files。

| 命令 | 最终结果 |
| --- | --- |
| `bun install --frozen-lockfile` | exit 0；重复安装后锁文件 SHA-256 不变 |
| `bun run typecheck` | exit 0 |
| `bun run lint` | exit 0；256 files |
| `bun run build` | exit 0；全部 12 包 |
| `bun run test` | exit 0；1,244 pass / 0 fail，132,185 assertions，115 files |
| `bun run verify:packages` | exit 0；全部 12 包 tarball、独立安装、imports 与 types |
| `bun test --coverage --coverage-reporter=lcov packages/core` | exit 0；572 pass / 0 fail |
| `bun run check:coverage` | exit 0；2,384/2,417 行，98.63%，门槛 90% |
| `DOCS_BASE=/zebra/ bun run docs:build` | exit 0；双语文档及 Pages base |
| `bun audit --registry https://registry.npmjs.org` | **exit 1**；仍仅 R01 相同 4 条告警（1 high、3 moderate） |
| `bun run bench:check` | exit 0；其他重任务结束后独立运行，8/8 场景通过 |
| `git diff --check` | exit 0 |

审计仍为 esbuild `GHSA-67mh-4wv8-2f99`，Vite `GHSA-v6wh-96g9-6wx3`、`GHSA-4w7w-66w2-5vf9`、`GHSA-fx2h-pf6j-xcff`。本任务没有解决 R01。

benchmark 使用原命令及门槛，1000 ms、并发 64，结果如下：

| 场景 | req/s | p95 ms |
| --- | ---: | ---: |
| static | 91574 | 1.15 |
| param | 87603 | 1.19 |
| wildcard | 83475 | 1.26 |
| middleware | 79836 | 1.30 |
| json | 90384 | 1.16 |
| di | 76671 | 1.35 |
| static-file | 33155 | 2.88 |
| post-json | 28093 | 3.66 |

原始验证日志保存在 `/tmp/zebra-todo12-finish.b1udPG/`。锁文件 SHA-256 为 `ece1a7458ab75446feadd1a013f9d6b8ca7b9d539ca39bc1384119591c2e31f1`；未改动的 baseline SHA-256 仍为 `1e37941b73db6daae50170b62e220dcc5ccefe17f1452806eaddf73bd6e394ba`。
