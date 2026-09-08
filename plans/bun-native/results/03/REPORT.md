# 03 · Bun 定位、最终复现与仓库验收

**01 JSON 与 02 请求体候选均未采用。** 本任务只更新文档和验收证据，生产源码没有
迁移。已有 session 原生 HMAC 来自用户此前的 `4466df7`，本轮只复跑并保留来源。

## 来源与记录格式

- 基线：`1418a2f3f8b3e0bae53490eb195811b34590e041`。
- 验收 checkout：`herdr/plan-bun-native-03-docs-and-validation`，父 HEAD
  `12e6b88e41198bae922a1d6ca9c6a68cc4f40a8f`，已包含 02 的
  `0c0d78ebe4329214d358a9b4428e8dcf1451d215`。首轮记录命令时文档/证据尚未提交；
  四页同步后的补充检查记录 HEAD 为 amend 前的唯一 03 提交
  `db8367f2c7e6173efd99f6af1ca399b390bf02dd`，同期四页和记录器修改尚未提交。
  本任务最终仍为一个提交。每条命令的实际 HEAD、前后工作树状态、文档和全部
  生产源码 SHA-256 在同名 `.run.jsonl` 中；首轮记录五份文档，`doc-sync` 补查
  扩展为全部九份。最终文档构建以最终九份文档字节为输入，不把旧构建当作补查。
- 环境：Linux x64，AMD EPYC Processor，8 个逻辑 CPU，kernel 6.8.0-31-generic。
  Bun 1.4.2 revision `744846f844374847c902b5e7fd59b4342a51ef99`，可执行文件
  `/home/ubuntu/.bun/bin/bun`；Bun 1.4.0 revision
  `34cbb9a40b4bd1bd767d134a7065e66c2432a676`，隔离文件
  `/tmp/zebra-bun-native-run/runtime/bun-linux-x64/bun`。
- [commands.csv](commands.csv) 索引命令、版本、HEAD、UTC 起止、退出码和原始日志。
  `record.py` 为每条命令将对应 Bun bin 目录前置到 PATH，覆盖所有 Bun 子进程。
  未更改全局安装、packageManager、engines、CI、依赖、锁文件或门槛。
- 每条命令的 stdout/stderr 原始字节均保存为 `.txt.gz`；metadata 同时保存压缩和
  解压后 SHA-256。`gzip -dc FILE.txt.gz` 可读取，压缩只避免日志尾随空格影响 diff。
  JSON/body 的解压 stdout 是完整 JSONL；原 session/HTTP gate 仅输出其既有汇总，
  不声称这些原脚本输出了逐轮样本。
- [medians.csv](medians.csv) 由 [summarize.py](summarize.py) 从原始输出计算，包含
  所有场景和受干扰运行；`eligible` 只按负载规则确定。原始 JSON/body 中位数、
  逐轮 checksum、计数及候选源码哈希均独立核对。

## 生产源码与边界

[source-proof.py](source-proof.py) 和 [输出](source-proof.stdout.txt.gz) 核对了全部
**80 个生产文件**：最终 checkout 与基线 archive 逐字节相等。全部 381 个 archive
原有文件在冻结安装后仍与 Git 导出一致。包 manifest、锁文件、API freeze、共享
HTTP 驱动和 `bench/baseline.json` 均保持原样；每个命令记录也附带空的生产 diff。
[baseline-archive.jsonl](baseline-archive.jsonl) 保存导出 commit、目录、tar 指纹和
所有文件指纹。使用 `git archive` 导出到普通临时目录，没有创建额外 worktree，
没有共用当前 checkout 的 node_modules 链接；baseline 有自己的冻结安装及
workspace 包链接。

README 与双语 docs 现在直接表述面向 Bun ≥ 1.4.0：HTTP/WebSocket 用 `Bun.serve`，
静态正文用 `Bun.file`，已有 session 用 `Bun.CryptoHasher`。静态元数据/路径/realpath
校验保留 `node:fs` / `node:path`，验签保留 `node:crypto.timingSafeEqual`。
JSON 和受限请求体合并保留原实现。浏览器侧 client/contract 保持 Web API 与纯 TS
边界，Bun target 的本地 dist 构建不等于浏览器 bundle，也不改变 src-direct 发布。
HTTP 产品指南的使用行为没有变化，不需要修改两份 `05-http.md`。

## 两版常规门禁

以下全部为 03 本轮在合并后的 checkout 执行；准确 argv、PATH、状态和日志见
command index，同名 `bun142-*` / `bun140-*` 记录对应版本。所有命令严格串行。

| 命令 | Bun 1.4.2 | Bun 1.4.0 |
| --- | --- | --- |
| `bun install --frozen-lockfile` | exit 0 | exit 0 |
| `bun run typecheck` | exit 0 | exit 0 |
| `bun run lint` | exit 0 | exit 0 |
| `bun run build` | exit 0 | exit 0 |
| `bun run test` | 1306 pass / 0 fail，133065 assertions，115 files | 1306 pass / 0 fail，133065 assertions，115 files |
| `bun run verify:packages` | 12 包 pack/install/import/tsgo 通过 | 12 包 pack/install/import/tsgo 通过 |
| `bun test --coverage --coverage-reporter=lcov packages/core` | 622 pass / 0 fail，13752 assertions | 622 pass / 0 fail，13752 assertions |
| `bun run check:coverage` | 2389/2417 = 98.84%，原门槛 90%，exit 0 | 2389/2417 = 98.84%，原门槛 90%，exit 0 |
| `DOCS_BASE=/zebra/ bun run docs:build` | 首轮及四页同步后补查均 exit 0 | 首轮及四页同步后补查均 exit 0 |
| `bun run bench/native-json.ts --candidate current --check` | 23 场景检查通过，final/baseline 源码相等 | 23 场景检查通过，final/baseline 源码相等 |
| client 与 contract：`bun build ... --target browser --outfile ...` | 两包 exit 0 | 两包 exit 0 |
| browser bundle 静态检查 + Web-only VM 加载/调用 | exit 0 | exit 0 |
| `git diff --check` | exit 0，提交前另查完整暂存 diff | exit 0，提交前另查完整工作树 diff |

core LCOV 原始文件另存为 `bun142-coverage.lcov.info.gz` 与
`bun140-coverage.lcov.info.gz`。全量测试已覆盖 peer-IP 原断言和 XFF 行为，
02 历史最低 Bun 失败由 01 的 IPv4 监听/请求夹具修正解决；没有覆盖历史失败日志。

浏览器验证保存两版 client/contract 的输出 bundle（`.mjs.gz`）、大小、导出列表和
SHA-256。静态扫描未发现 Bun、bun:/node: 导入或 Node 运行时全局引用；模块没有
外部运行时 import。`browser-smoke.mjs` 使用 Node 24.20.0 的隔离 VM，只提供 Web
全局对象，加载两包并验证契约前缀、路径编码及客户端响应；VM 中 Bun/process/Buffer
均不存在。这是 browser target 和运行时依赖边界检查，不是实际浏览器端到端测试。
Node 的实验性 VM Modules 提示完整保留，不影响退出码。

首轮原范围 docs 构建分别为 7.42s / 7.64s、exit 0。当时额外检查了修改文档中的
89 个本地链接目标/Markdown 锚点，以及英文/中文 README 与首页共四份构建产物
的 `/zebra/assets/` base；README 产物含最终 Bun 最低版本和保留 API 的说明。
已有外部链接未重新抓取，未把 VitePress 的 ignoreDeadLinks 设置当作链接验收。
首轮构建及本地链接/产物检查日志以 `docs-build` 和 `docs-links-and-output` 标记；
这些历史输出不覆盖下面四页同步后的最终补查。

## 性能选择规则与复跑范围

协调器授予本计划独占时段；外部另一计划仍有独立负载，仅只读观察，没有控制它们。
沿用 01 的规则：连续 **15 个两秒安静采样**后启动；测量期间持续记录每个外部
繁忙 PID、进程名、CPU 比例、时间和系统 loadavg。其他进程达到单核 15% CPU 或
出现 benchmark/build/test 工作负载时，整次运行保留并排除，不按性能结果选择。
本命令的独立进程组（包括 Bun 子进程）从外部负载统计中排除。

每脚本每 Bun 版本只要求一份新增有效完整复现，复用已有有效运行。稳定采用判断
仍依据已独立复核的 01/02 每版两份有效数据：01 另外四份受干扰完整运行已排除，
02 四份全部保留。01 的最终默认 `problem-native` 模式在临时基线源码中重建被拒绝
候选，03 已核对其候选源码指纹与 01 测量时一致；`current --check` 则验证最终原码。

`bun142-session-sign-1` 是 wait-only：外部测试长时间存在，本任务在尚未启动计时
时停止自己的等待器及队列，先完成上述普通门禁，再以新标签恢复。没有 session
测量数据，没有与普通门禁重叠打流；等待日志及停止原因保留在该记录内。

### 本轮选择与全部数据

| 脚本 | Bun 1.4.2 有效运行 | Bun 1.4.0 有效运行 | 轮数 |
| --- | --- | --- | --- |
| native-json | bun142-native-json-1 | bun140-native-json-1 | 23 场景 × 7 配对轮 |
| native-body | bun142-native-body-1 | bun140-native-body-3 | 22 场景 × 9 配对轮 |
| session-sign | bun142-session-sign-2 | bun140-session-sign-1 | 2 阶段 × 7 轮 |
| 原 bench:check | bun142-bench-check-1 | bun140-bench-check-1 | 8 场景 × 3 轮 |
| 1418a2f HTTP 对照 | bun142-http-samples-baseline-1 | bun140-http-samples-baseline-1 | 8 场景 × 3 轮 |

所有有效运行的 `otherBusySamples` 都为空。以下四次测量已完整保存，但不参与
性能判断：

| 运行 | 外部繁忙采样数 |
| --- | ---: |
| bun140-native-body-1 | 7 |
| bun140-native-body-2 | 2 |
| bun142-native-body-2 | 2 |
| bun142-native-json-2 | 6 |

[selection.jsonl](selection.jsonl) 保存选择；每次 `.load.jsonl` 包含完整等待和计时阶段
采样，`.run.jsonl` 保存排除依据，解压 `.stdout.txt.gz` 得到未经改写的完整输出。
有效 JSON 两次共有 322 组配对轮，body 两次共有 792 个计时样本；有效和排除
数据都在 `medians.csv` 中保留，未删除任何较慢场景。

### 最终脚本复现中位数

下面只作复现摘要，**旧 / 候选 ns/op，括号为候选耗时变化，正数更慢**。
所有场景、控制及完整每轮数据见 `medians.csv` 与压缩原始 stdout。稳定的采用
结论仍依据 01/02 每版两份有效数据，不用这次单份复现重新筛选优化路径。

| 阶段 / 场景 | Bun 1.4.2 | Bun 1.4.0 |
| --- | ---: | ---: |
| json / constructor/unicode | 1886.1 / 3004.8 (+59.31%) | 2012.9 / 3103.8 (+54.19%) |
| json / framework/middleware/problem-cookies | 5915.7 / 6363.3 (+7.57%) | 5887.8 / 6461.2 (+9.74%) |
| json / framework/dispatch-error/problem-cookies | 10838.4 / 11828.9 (+9.14%) | 11892.7 / 12536.7 (+5.41%) |
| json / framework/ws-problem/rejected | 2574.0 / 2688.7 (+4.46%) | 3191.3 / 3302.4 (+3.48%) |
| merge / small-json-single | 86.1 / 280.7 (+225.94%) | 79.1 / 253.7 (+220.89%) |
| merge / 16x1KiB | 2500.2 / 4036.3 (+61.44%) | 2736.0 / 3314.7 (+21.15%) |
| merge / 256x64B | 8674.6 / 5750.4 (-33.71%) | 9097.9 / 5707.6 (-37.27%) |
| readBody / single-byte | 5500.0 / 6186.7 (+12.49%) | 4991.1 / 5210.2 (+4.39%) |
| readBody / large-single-1MiB | 179496.8 / 99022.8 (-44.83%) | 109440.7 / 96025.7 (-12.26%) |

### 既有 session 复核

before 是 `216b947` 的 createHmac 算法，after 是用户此前 `4466df7` 的现有导出。
每版一份完整有效运行，7 轮 × 100,000 次，每方预热 20,000 次。以下值取自原脚本
打印的中位数（已按一位小数舍入）；两次 checksum 均为 167040000。原脚本没有
输出逐轮样本，不额外改写共享脚本或把汇总冒充逐轮数据。

| Bun | helper | 旧 ns/op | 既有 Bun HMAC ns/op | 原脚本报告耗时减少 |
| --- | --- | ---: | ---: | ---: |
| 1.4.2 | sign | 1267.4 | 700.6 | 44.7% |
| 1.4.2 | verify valid cookie | 1597.1 | 981.1 | 38.6% |
| 1.4.0 | sign | 1261.0 | 787.1 | 37.6% |
| 1.4.0 | verify valid cookie | 1529.3 | 1036.6 | 32.2% |

### 原 HTTP gate：两版均失败，同机原始源码也失败

**最终原 `bun run bench:check` 在两版均为 exit 1、8/8 FAIL；同机 `1418a2f`
对照在两版也为 exit 1、8/8 FAIL。** 四次均无已记录测量期干扰，所有原始 stdout
和 stderr 已保留。以下每格为 rps / p95 ms，按原 gate 的输出精度展示全部场景。

| 场景 | 1.4.2 最终 | 1.4.2 原始基线同机 | 1.4.0 最终 | 1.4.0 原始基线同机 |
| --- | ---: | ---: | ---: | ---: |
| static | 38192 / 2.56 | 37973 / 2.12 | 32168 / 2.75 | 40736 / 2.45 |
| param | 34424 / 2.68 | 39601 / 2.23 | 35756 / 3.02 | 40923 / 2.38 |
| wildcard | 32959 / 2.57 | 37601 / 2.48 | 33556 / 3.33 | 35351 / 2.83 |
| middleware | 35790 / 2.46 | 35513 / 2.98 | 38068 / 2.70 | 36900 / 2.66 |
| json | 36973 / 2.52 | 37009 / 2.70 | 37336 / 2.97 | 31200 / 3.19 |
| di | 30654 / 3.36 | 31459 / 3.12 | 28300 / 3.62 | 30835 / 3.27 |
| static-file | 18500 / 4.84 | 15556 / 6.04 | 17847 / 5.05 | 16482 / 5.86 |
| post-json | 10782 / 9.37 | 12632 / 8.00 | 9096 / 12.13 | 10214 / 10.97 |

对照通过 [http-samples.mjs](http-samples.mjs) 调用 archive 中未修改的
`runRegression`、`runScenario` 和 Zebra server，使用现成的测量注入参数，完整
保留每场景三轮 rps/p50/p95/p99/requests。选取规则与原 gate 一致：按 rps 排序，
取中间样本的 rps **及该样本的 p95**；不是分别取 p95 中位数。采样日志输出在
计时外。正式最终 gate 使用原命令，不经过这个记录包装。

两侧均为默认 1000ms × 64 并发、每次 500ms 预热，所有八个场景，原 rps ≥ 80%
且 p95 ≤ 125% 门槛和 Apple Silicon `baseline.json`。没有执行 `--update`，没有
覆盖或重录 baseline。archive 的 facade 解析路径写入原始输出，明确指向
`/tmp/zebra-task03-baseline-tft0ugxq/packages/zebra/src/index.ts`。

复现对照可先 `git archive 1418a2f` 导出普通临时目录，在该目录执行冻结安装，
再按对应 Bun 的 PATH 运行 `bun run <本仓库>/plans/bun-native/results/03/http-samples.mjs <archive目录>`。
准确实际 argv 与 cwd 在两份 `http-samples-baseline-1.run.jsonl` 中。

全部生产源码和锁文件相同，而同机原始源码也远低于 Apple Silicon 门槛，说明
该跨机器门槛无法直接用于判定本轮生产改动回归。两次同机测量之间仍有明显
正负波动；这属于运行环境/测量差异，不能写成代码收益。对照不能单独量化硬件、
虚拟化、系统调度及测量顺序各自的贡献，也没有把失败改报通过。


## 采用结论与限制

- **01 未采用**：三个通用 JSON 入口的直接替换存在根值/空正文兼容差异；两个
  固定 Problem 候选虽通过行为检查，但错误中间件局部成本在原四份有效复跑中
  增加 5.72%–16.72%，完整错误 dispatch 方向不稳定，WebSocket 的小幅变化没有
  超过控制噪声。参见 [01 报告](../01/REPORT.md) 和 [所有中位数](../01/summary.csv)。
- **02 未采用**：小 JSON 单块局部合并在原四份有效数据中增加 202.7%–249.3%，
  16 × 1 KiB 增加 37.7%–42.3%；256 × 64 B 和大正文完整读取有收益，但不满足
  其他代表性场景不退化的条件。参见 [02 全部正负结果](../02/report.md)。
- session 为 `4466df7` 既有实现的复核；局部 ns/op 不代表 HTTP 吞吐提升。
- 安静窗口和两秒负载采样可能漏掉短暂活动，不能消除虚拟化、调度、GC 和测量
  顺序影响。有限的同机运行不能给出普遍硬件倍率，也不能解释每个小幅变化的原因。
- 原始 HTTP gate 使用另一台 Apple Silicon 机器录制的基线；完整失败与同机基线
  对照均需保留，不降低门槛，不把功能门禁通过写成性能 gate 通过。
- 本任务不修改生产代码、测试预期或其他任务证据。归档前未修改共享队列、
  未执行 rebase；集成阶段按协调器明确授权收录归档/队列改动并 rebase 到 master。
  不执行 merge、push、PR、发布、部署或 worktree 清理。协调器仍须独立执行集成门禁。


## 首页与入门指南同步及最终补查

协调器已明确将 `docs/index.md`、`docs/zh/index.md`、`docs/01-getting-started.md`
和 `docs/zh/01-getting-started.md` 纳入 03；四页均已同步完成，没有待审批范围项。
两份首页 feature 只说明 Bun ≥ 1.4.0、Bun.serve / Bun.file 与 Web Standard
Request / Response；必要 Node API 清单保留在 README。两份入门指南的介绍、
最低版本及 CI 表述也已同步，区分固定的 `packageManager bun@1.4.0` 和 CI 浮动
`1.4` 系列。四页旧的“无 Node 兼容层”和“测试/CI 同固定 Bun”表述已消除。

[历史提案补丁](additional-docs-proposal.patch) 保留原字节，状态为**意图已应用**：
按协调器要求精简首页 feature，并同步入门指南首句；该文件是修订前参考，不能
再当作待应用补丁。首轮所有日志及性能数据保持原字节；
[原记录器](record-before-doc-sync.py.txt) 和
[原链接检查器](check-docs-before-doc-sync.py.txt) 留存以对应旧日志中的脚本指纹。
当前 [record.py](record.py) 的文档指纹清单覆盖全部九份文档；
[check-docs.py](check-docs.py) 增加首页导航/图片、本地站点路径以及入门指南产物检查。

本次仅按版本串行补查受影响项，命令标签均为 `bun142-doc-sync-*` /
`bun140-doc-sync-*`，准确命令、退出码和完整日志见 [commands.csv](commands.csv)。

| 补查命令 / 内容 | Bun 1.4.2 | Bun 1.4.0 |
| --- | --- | --- |
| `DOCS_BASE=/zebra/ bun run docs:build`，最终九份文档之后 | exit 0 | exit 0 |
| `python3 plans/bun-native/results/03/check-docs.py`，本地链接/锚点、六份双语产物及其本地导航/资源 | exit 0 | exit 0 |
| `bun run lint` | exit 0 | exit 0 |
| `git diff --check` | exit 0 | exit 0 |
| `sha256sum --check plans/bun-native/results/03/doc-sync-inputs.sha256` | exit 0 | exit 0 |

链接检查验证六份产物均含 Bun ≥ 1.4.0、静态资源使用 `/zebra/` base、所有本地
输出链接存在，并检查四份新同步页面不再含旧表述。记录保存每份构建产物 SHA-256；
未重新抓取已有外部链接。指纹补查使用固定输入清单，最终 [SHA256SUMS](SHA256SUMS)
另覆盖全部证据（自身除外）。没有重复全量测试或任何性能测量，原 HTTP gate
失败及同机基线对照结论保持不变；协调器集成门禁仍由协调器独立执行。

补查的 `bun142-doc-sync-links` 首次 exit 1：新增的全路径 base 断言发现六页
既有 favicon 均为 `/favicon.svg`，不在 `/zebra/` 下。
[该次检查器](check-docs-strict-base.py.txt) 和失败日志原样保留。现有
`docs/.vitepress/config.mts:114` 显式设置该根路径；配置与 `1418a2f` 字节相同。
最终检查将此项逐页记录为 `baseExceptions`（`withinDocsBase: false`），验证
`dist/favicon.svg` 文件存在，但不将其报告为带 base 的 URL；其他本地导航和
资源仍须符合路径/文件检查。最终两版 `doc-sync-links-final-pass` 均 exit 0，
上述静态资源 base 结论仅适用于 `/zebra/assets/`，不包含这个已记录的 favicon。
本轮未改配置；部署仅暴露 `/zebra/` 时该根路径图标仍可能无法加载。

`bun142-doc-sync-links-final` 另有一次 exit 1：检查器未把 `./zh/README` 这类
VitePress 相对无扩展名链接映射为 `.html`，已修正检查器的路径解析，文档链接
无需改动。[该版检查器](check-docs-before-relative-links.py.txt) 与失败日志保留。

`bun142-doc-sync-links-verified` 另有一次 exit 1：双语 docs README 的既有仓库
相对链接在构建后越出站点目录。两处均已改为 origin 所指仓库的 README URL，
修改仍在原授权文件范围内。该次使用下述可见文本修正前的检查器，失败日志原样保留；修正后
两版均以 `doc-sync-build-final` 完成最终构建，再执行 `doc-sync-links-final-pass`。
较早的 `bun142-doc-sync-build` 仅对应修正这两个链接之前的九份文档字节。

`bun142-doc-sync-links-complete` 的 exit 1 来自检查器把 `<script>` 中全站配置
当成页面可见文本，从而匹配到共享配置中的 `Bun-first`。已修正可见文本提取，
排除 script/style 数据；四页源码与可见产物均使用同步后的措辞，不修改共享
配置。[修正前检查器](check-docs-before-visible-text.py.txt) 对应这次和上次失败，
日志均保留。上述检查器修正无需重建文档，最终检查使用同一份最终构建产物。


## 集成阶段归档复核

协调器已将 [03 todo](../../todos/done/03-docs-and-validation.md) 移至 `todos/done`，
修复其 plan/results 相对链接，并更新 [队列 README](../../todos/README.md)。
本任务复核并收录这些授权改动；链接检查器同步归档路径并忽略已删除的旧路径。
九份站点文档和 docs 配置未变，复用两版 `doc-sync-build-final` 的最终构建，
不重复构建、全量测试或性能测量。favicon 根路径继续作为未修改配置的已知限制。

归档补查标签为 `bun142-archive-*` / `bun140-archive-*`：执行
[verify-archive.py](verify-archive.py) 核对文档/产物指纹、历史快照和 01/02 完整性，
再执行 `check-docs.py` 验证归档链接、队列链接及六份既有产物，最后检查 diff。
每条命令的 HEAD、版本、工作树状态、退出码及日志见 [commands.csv](commands.csv)。
rebase 目标为 master `12e6b88e41198bae922a1d6ca9c6a68cc4f40a8f`；
协调器随后独立执行两版全套非性能门禁。

`doc-sync-inputs.sha256` 是归档前固定输入清单，原字节保留，不作为归档后工作树
清单直接执行。`verify-archive.py` 对其中已迁移/修改的三个输入使用保留的
[旧 todo](todo-before-archive.md.txt)、[旧报告](report-before-archive.md.txt) 和
[旧检查器](check-docs-before-archive.py.txt) 核验，其余输入仍核对原路径；
全部原始日志保持不变。当前完整证据使用更新后的 `SHA256SUMS` 核验。
