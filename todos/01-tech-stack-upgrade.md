# P0 · 技术栈整体升级

状态：`pending`

## 目标

把仓库统一到以下新基线：

- Bun `1.4.x`（最低支持版本为 `1.4.0`）；
- Zod `4.x`；
- TypeScript native compiler `tsgo`（通过官方 `@typescript/native-preview` 包提供）。

同时让 CI、打包冒烟测试、示例、基准和中英文文档都反映同一基线。这个仓库按新项目处理：不要为旧运行时、旧 Zod、旧 TypeScript 或旧 Zebra API 增加兼容分支、迁移层或迁移指南。

## 当前盘点（实现前先核对）

- 本机 `bun --version` 已为 `1.4.0`，但仓库仍在 README、贡献指南、生产文档、基准说明和 GitHub Actions 中写着 Bun `1.1.30`/`1.3`。
- 根 `package.json` 声明 `typescript: ^5.6.0`、`zod: ^3.24.0`；多个 workspace 和两个示例仍直接声明 Zod 3。
- 各 package 的 `typecheck` script 仍调用 `tsc --noEmit`；`scripts/verify-packages.ts` 还会在临时项目安装 `typescript` 并调用 `bun x tsc`。
- `packages/schema-zod/src/index.ts` 使用 `ZodTypeAny` 和 `zod-to-json-schema`。Zod 4 不再提供与 Zod 3 相同的 `ZodTypeAny` 导出，且旧转换器对 Zod 4 可能返回不完整 schema；不能只改 manifest 版本号。
- 现有适配器契约是：返回 draft-7 JSON Schema、移除顶层 `$schema`、支持按顺序匹配的手工 override，并按输入形状表达 `coerce`/`transform`。

## 约束与非目标

- 使用 Bun 作为唯一包管理器；依赖升级后重新生成并审阅 `bun.lock`，不得手工拼锁文件。
- `tsgo` 是唯一仓库级类型检查入口；不要保留“先 tsgo、失败再 tsc”的隐式 fallback。若某个工具仍需要 `typescript` 作为自身 peer dependency，必须证明它不是本仓库的类型检查器，并在变更说明中写清楚。
- 不顺手重构业务 API，不为旧版本保留代码路径，不升级与本任务无关的依赖。
- `Standard Schema V1` 是外部协议名称，不属于旧 Zebra 历史叙事；协议和安全语义不能因文案清理而删除。

## 条目

### T1 · 建立 Bun 1.4 运行时基线

涉及范围（可按实际依赖补充）：`package.json`、所有发布包的运行时元数据、`.github/workflows/ci.yml`、`.github/workflows/deploy-docs.yml`、README/贡献指南/入门与生产文档、`bench/README.md`、Docker 示例。

完成以下工作：

1. 选择并统一机器可检查的版本声明（根 `packageManager`/`engines.bun`，以及发布包需要暴露的运行时要求），明确最低 `1.4.0`。
2. 将 CI 的 full、floor、bench、coverage、文档部署 job 全部切到 Bun 1.4；删除仍以 1.1.30 或 1.3 为支持下限的注释、矩阵和步骤。
3. 将 Docker/部署示例和开发要求改为 Bun 1.4；审阅并固定与该运行时匹配的 `@types/bun`，检查 Bun 1.4 下 `bun install --frozen-lockfile`、`bun:test`、打包和文档构建行为。
4. 重新生成锁文件，确保锁文件由 Bun 1.4 产生且没有因为升级引入未声明的 workspace 依赖。
5. 基准说明中的运行时版本必须与可复现命令一致；如重新测量后数字变化，更新数字和测量条件，不要继续把 Bun 1.3 作为当前基线。

验收条件：

- CI、Docker、README、英文/中文文档和基准说明不再把 Bun `< 1.4` 描述为受支持版本。
- `bun --version` 为 `1.4.x` 时，安装、测试、构建和文档构建均能启动；版本声明与锁文件一致。

### T2 · 用 tsgo 替换 tsc

涉及范围：根 `package.json`、所有 workspace `package.json` 的 `typecheck` script、`scripts/verify-packages.ts`、`tsconfig*.json`（仅在 tsgo 必需时）、贡献指南/生产文档/llms 上的命令说明，以及 CI 相关注释。

完成以下工作：

1. 将官方 `@typescript/native-preview` 加入可复现的开发依赖，使用其 `tsgo` binary；移除根直接依赖 `typescript`，除非某个非类型检查工具确实需要它并有明确说明。
2. 把每个 package 的 `tsc --noEmit` 改成统一的 `tsgo --noEmit`，保留现有 workspace 聚合脚本的行为。
3. 更新 `scripts/verify-packages.ts`：临时 smoke 项目安装 native compiler（而不是 `typescript`），并用 `bun x tsgo --noEmit` 检查已安装 tarball 的 `main`/`types`/`exports`。
4. 用项目 tsconfig 全量运行 tsgo。处理由 native compiler 暴露的真实类型问题（包括示例和 type-test），但不要用 `@ts-ignore`、放宽 strict 选项或改回 tsc 掩盖差异；只有确认是 tsgo 尚未支持的配置时才调整配置，并留下原因。
5. 文档中的“TypeScript ≥ 5.6”和直接 `tsc` 命令改为当前 `tsgo` 工作流；保留 TypeScript 配置选项的技术说明。

验收条件：

- `rg` 在 active scripts、CI 校验脚本和工具链文档中找不到作为本仓库检查器的 `tsc --noEmit`/`bun x tsc`。
- `tsgo --version` 来自 workspace 安装的依赖，版本写入锁文件；全量 `bun run typecheck` 通过。
- 新鲜临时项目安装发布包后，`bun run verify:packages` 的类型检查使用 tsgo 并通过。

### T3 · 统一 Zod 4 依赖图

涉及范围：根 manifest、`packages/client`、`packages/contract`、`packages/core`、`packages/mcp`、`packages/schema-zod`、`packages/testing`、`examples/contract-blog`、`examples/forum` 的 manifest，以及 `bun.lock`。

完成以下工作：

1. 将所有直接 Zod 依赖统一到 `4.x`，不要留下某个 workspace 仍声明 `^3.24.0`。
2. 审阅 `zod-to-json-schema` 的 Zod 4 支持；如果它不能满足当前 adapter 契约，切换到 Zod 4 原生 JSON Schema API 或其他明确支持 Zod 4 的实现，并移除不再使用的依赖。
3. 重新安装并检查依赖图：直接依赖、workspace tarball smoke 项目和 MCP/Better Auth 等 transitive peer 不应意外把仓库代码解析回 Zod 3。
4. 保持 `@zebra/core`、`@zebra/contract` 等运行时包不直接引入 Zod；Zod 只在示例、测试和 schema adapter 的边界出现。

验收条件：

- 所有直接 manifest 与锁文件显示 Zod 4；没有由本仓库直接声明的 Zod 3。
- `bun install --frozen-lockfile` 后，核心、契约、客户端、MCP、schema adapter、示例测试均使用同一 Zod 4 API。

### T4 · 迁移 `@zebra/schema-zod` 到 Zod 4 API

涉及范围：`packages/schema-zod/src/index.ts`、`packages/schema-zod/test/schema.test.ts`，必要时更新 MCP 相关测试/类型。

完成以下工作：

1. 移除对 Zod 3 专属 `ZodTypeAny` 的依赖，改用 Zod 4 支持的类型/API。
2. 选择一个真正能处理 Zod 4 的转换路径。若使用 `z.toJSONSchema`，明确使用 input/output 选项并处理 Zod 4 对 transform、coerce、default、optional、number 边界和 unsupported schema 的行为；若保留第三方转换器，必须用真实 Zod 4 runtime 验证其输出，不能只看 peer range。
3. 保留 `SchemaAdapter`、`SchemaOverride`、first-match 规则、draft-7 目标和顶层 `$schema` 删除行为。对于不能表达的 schema，要给出稳定、可测试的错误或手工 override 路径，不得静默返回空 schema。
4. 扩展测试覆盖：对象/嵌套对象、数组、union/enum/literal/record/nullable、coerce、default/optional、transform 的输入形状、手工 override、无 `$schema`，以及至少一个 MCP tool 的实际 `inputSchema`。
5. 若 Zod 4 的规范输出与旧测试的细节不同，按“输入 schema 用于 MCP/codegen、运行时校验仍由 Zod 执行”的契约重新定义断言，并在测试或文档中解释差异；不要为了通过测试硬编码旧转换器的错误结果。

验收条件：

- 任何 Zod 4 schema 都不会经过 Zod 3-only 类型断言或产生空 JSON Schema。
- adapter 单元测试与 `packages/mcp/test` 全部通过，输出满足 `SchemaAdapter` 的公开契约。

### T5 · Zod 4 类型、运行时和示例回归

涉及范围：`packages/{contract,client,core,mcp,testing}/src` 中与 Standard Schema 相关的注释/类型、对应 type tests 和 runtime tests、两个使用 Zod 的示例、必要的 docs snippets。

完成以下工作：

1. 将“zod v3 专属”的注释、类型假设和结构可赋值 workaround 改为 Zod 4/Standard Schema 现状；不要复制第二套 schema 协议。
2. 验证 params/query/body/output 的输入输出推导、coerce/transform、错误 issue path、客户端和测试工具在 Zod 4 下仍然成立。
3. 运行核心契约实现、批量实现、client/testing、MCP 和示例测试；新增必要的 type-level 断言，确保没有通过放宽类型而掩盖回归。
4. 检查构建产物和发布入口，确认 Zod 仍被隔离在声明它的包，不会意外成为 `@zebra/core` 的 runtime dependency。

验收条件：

- 受影响的 type tests、runtime tests、examples 和 `bun run build` 全部通过。
- 代码和注释中不再把 Zod 3 当作当前支持版本；Standard Schema V1 等外部协议名称保持准确。

### T6 · CI、发布 smoke test 和工具链验证闭环

涉及范围：CI YAML、`scripts/verify-packages.ts`、`package.json` scripts、必要的基准/文档构建配置。

完成以下工作：

1. 确认每个 CI job 都使用 Bun 1.4 并执行同一套 `bun install --frozen-lockfile`；不留下只在旧 Bun 上运行的隐藏路径。
2. 确认 `verify:packages` 的 fresh project 能安装所有 tarball、运行 import smoke、用 tsgo 做类型检查，并通过 Zod 4 的 schema/MCP import。
3. 若 Bun 1.4 改变测试、覆盖率或 benchmark 行为，更新注释和阈值/基线，但只接受有日志证据的变化。
4. 不引入 tsc fallback；CI 失败时修复真实类型/配置问题，不能降低 strictness 或跳过 workspace。

验收条件：

- CI 配置静态检查显示没有旧 Bun floor、旧 compiler 或旧 Zod 依赖路径。
- 本地与 fresh install 两条路径的结果一致。

### T7 · 文档改成当前项目基线

涉及范围（先全量搜索，再按实际命中更新）：`README.md`、`CONTRIBUTING.md`、`llms.txt`、`SECURITY.md`、`plan.md`、`CHANGELOG.md`（仅在出现当前支持误导时处理，历史记录不要重写）、`docs/README.md`、`docs/zh/README.md`、`docs/01-getting-started.md`、`docs/zh/01-getting-started.md`、`docs/11-contract-first.md`、`docs/zh/11-contract-first.md`、`docs/15-production.md`、`docs/zh/15-production.md`、`docs/16-mcp.md`、`docs/zh/16-mcp.md`、`docs/api-freeze.md`、`docs/zh/api-freeze.md`、`docs/07-sessions.md` 中相关工具链/兼容表述，以及 `bench/README.md`。

完成以下工作：

1. 文档只描述当前项目：删除旧 Zebra/v1/v2/archive/2019/迁移/向后兼容叙事和不再适用的历史链接；不要新增 migration guide 或兼容矩阵。
2. 把运行要求统一写成 Bun 1.4、Zod 4（在需要直接使用 schema 的地方）和 tsgo；命令、Docker tag、CI 说明、tarball typecheck 说明必须一致。
3. 将英文和中文文档同步更新，尤其是入门、生产部署、MCP/schema adapter、贡献指南和 llms context；不得只改英文。
4. `docs/api-freeze` 若继续保留，改写成当前 API/约束说明，不再声称对旧项目或旧 API 的稳定/向后兼容承诺；若移除，则同步导航、交叉链接和中文页面。保留 `Standard Schema V1` 等协议版本号及必要的安全行为说明。
5. 清理示例注释和文档中的 `zod v3`、`tsc`、Bun 1.3/1.1.30 版本文字；基准结果要么在 Bun 1.4 下重测并标注条件，要么删除过时的硬编码结果并保留可复现命令。

验收条件：

- 对 active 文档执行版本/历史扫描时，不再出现把旧 Zebra 或旧工具链作为当前支持对象的表述。
- 英文/中文页面、导航和链接均能通过 `bun run docs:build`；文档中的命令可按当前脚本执行。

### T8 · 最终仓库级校验与交接证据

主代理在所有实现与独立复核完成后执行，不由局部 agent 代替：

```sh
bun --version
tsgo --version
bun install --frozen-lockfile
bun run typecheck
bun run lint
bun run build
bun test
bun run verify:packages
bun run docs:build
bun run bench:check
git diff --check
```

如果 benchmark 基线因 Bun 1.4 变化，保存命令、版本和关键输出后再更新基线。最终报告必须列出每个 T 条目的实现文件、独立复核结论、完整校验命令和剩余风险；未完成或证据不足的条目不得标记为 done，也不得把文件移入 `todos/done/`。

## 实现分组与依赖

- **组 A（串行）**：T1 → T2 → T3 → T6。它们共同修改 manifest、锁文件、CI 和验证脚本，不能并行编辑同一文件。
- **组 B**：T4 → T5。依赖 T3 的 Zod 4 依赖图；只修改 schema/contract/client/MCP 代码与测试。
- **组 C**：T7。可在组 B 完成后并行复核，但文档版本必须以组 A/B 的最终命令和 API 为准。
- T8 只能在 A/B/C 全部完成、独立复核通过后执行。
