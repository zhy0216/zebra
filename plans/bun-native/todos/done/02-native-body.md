difficulty: medium
agent: inherit

# 请求体字节原生合并评估与优化

## T1 · 评估并优化已限额字节的最终合并

要做什么：

在 `readBody()` 逐块限额检查完成后，对照现有分配/循环 `set` 与 `Bun.concatArrayBuffers`。先验证返回 Uint8Array 的重载在锁定类型及最低 Bun 中可用，再根据 T2 的证据决定是否替换最终合并。只优化这一段，不重写流状态机或解析器。

预计修改的文件：

- `packages/core/src/http/body.ts`（限 `readBody` 最终合并）
- `packages/core/test/http/body.test.ts`（补视图、复制语义等缺口）
- `packages/core/test/http/request-helpers.test.ts`，仅在既有共享读取测试不足时补充。
- `packages/core/test/contract/body-read-composition.test.ts`，仅在缺少实际复用验证时补充。

验收条件：

- 空流、空 chunk、单 chunk、多 chunk、偏移 Uint8Array/Buffer 视图的结果逐字节一致，保留复制后的隔离性；不读取视图外数据，不 detach/修改输入。
- 声明长度和流式字节上限均保持；limit 等于实际长度成功，多 1 byte 仍 413，不能通过 maxLength 截断后伪装成功。
- 保留 `bodyUsed` / locked reader 的拒绝行为；失败 reader 的释放、`onReadError` 调用边界及超限后的非阻塞 cancel 不变。
- cancel 抛错、拒绝或永不完成时不覆盖/拖延 413；测试使用有界闩锁和资源清理，不增加不受控等待。
- `req.body/json/text/form` 共享读取与 `stream()` 独占行为、multipart 错误映射及现有 fuzz 测试通过。
- 无需修改 `request.ts`、response 模块、client、静态文件或包配置。
- Bun 1.4.0 与 1.4.2 均验证。若代表性负载无收益，保留原实现并交付“未采用”的测量证据。

前置依赖：无；源码采用决定依赖本文件 T2。

## T2 · 测量局部合并与完整请求体读取

要做什么：

新增独立 benchmark，预先固定空/单块、多块、偏移视图、小 JSON、较大正文等场景。分别比较等价的最终合并和完整 `readBody` before/after，保持相同限额、读取与错误处理。规划阶段的短探针已出现一种候选慢于原循环，必须保留所有代表性结果。

预计修改的文件：新增 `bench/native-body.ts`。不修改共享 benchmark 驱动、基线、README 或 01 的文件。

验收条件：

- `bun run bench/native-body.ts` 可执行并先断言输出字节正确；准确记录旧路径基线与复现参数。
- 预热后至少 7 轮交替顺序，输出所有样本、中位数、Bun、CPU/平台及消费校验值。
- 返回 Uint8Array 的候选和原实现分配/复制语义一致；计时不能只为其中一方排除转换或分配成本。
- 输入创建成本要么两方均包含，要么均排除；完整读取比较使用等价 reader/限额流程，不用不限额原生读取冒充等价优化。
- 在独占时段按同机同版本比较；只有稳定收益且其他代表性场景无可复现退化时保留源码优化。
- 记录未采用的场景或候选，不从输出中删去较慢数据，不重录 HTTP baseline。

前置依赖：无；与 T1 在同一 worktree 迭代，完成后把实际决定交给 03。

## 验证方式

```sh
bun test packages/core/test/http/body.test.ts packages/core/test/http/content-length.test.ts packages/core/test/http/request-helpers.test.ts packages/core/test/contract/body-read-composition.test.ts packages/core/test/fuzz/body.test.ts
bun run typecheck
bun run lint
bun run build
bun run test
bun run bench/native-body.ts
git diff --check
```

隔离 Bun 1.4.0 的行为检查按 plan 执行；最终两个版本全套门禁由 03/协调器复核。一个任务一个最终 commit；即使候选未采用，也交付 benchmark 和明确评估结论，不报告不存在的性能提升。

## 执行记录 · 测量准备（2026-09-07）

测量前状态：`READY_FOR_BENCH`。本节保留授时前的准备记录；最终状态、正式数据及门禁例外见下方“独占测量与最终结论”。`body.ts` 始终保留基线实现作为最终交付。

- 新增 `bench/native-body.ts`：冻结 `1418a2f` 的声明长度检查及完整 `readBody` 作为 before；after 仅替换最终合并为 `Bun.concatArrayBuffers(chunks, size, true)`。独立比较局部合并和完整读取，未改变 reader、限额或错误流程，未使用无限额原生读取。
- 预先固定 11 个场景：空流、空 chunks、单 byte、小 Unicode JSON 单块/含空块的多块、16 × 1 KiB、256 × 64 B、偏移 Uint8Array/Buffer 16 × 1 KiB、1 MiB 单块、64 × 16 KiB。局部两方均排除输入创建，完整读取两方均计入 Request/Headers/stream 创建；均计入输出分配、复制和消费。
- 默认 9 轮，预热顺序 legacy/native/native/legacy，每轮交替先后；输出 JSONL 包含所有原始样本、中位数、逐对变化、迭代/预热次数、输入长度/偏移/声明/上限、Bun revision、CPU/平台和消费 checksum。`NATIVE_BODY_ROUNDS` 最低 7，`NATIVE_BODY_SCALE` 可等比例延长测量。不会过滤较慢场景或修改 HTTP baseline。
- `body.test.ts` 新增 17 个用例（文件合计 29）：视图外 sentinel 与整个 backing buffer 检查、双向修改隔离、不 detach、0/精确限额/超 1 byte、声明错误与 used/locked 的 callback 边界、失败 reader 释放与 callback 抛错、cancel 同步抛错/拒绝/挂起。挂起 cancel 使用 250 ms 有界闩锁，finally 清理 timer 并释放取消 Promise。
- 既有 `request-helpers.test.ts` 已断言共享 reader 只获取一次及 `stream()` 独占，contract composition 已验证 middleware/handler 实际复用，所以没有修改这两个文件。
- 锁定 `bun-types@1.4.1` 的 `bun.d.ts:2328` 声明 `asUint8Array: true` 返回 `Uint8Array<ArrayBuffer>`；[官方参考](https://bun.com/reference/bun/concatArrayBuffers) 同样提供该重载，兼容结论以下述本地执行为准。

测量前行为和普通门禁：

| 校验 | 结果 |
| --- | --- |
| `bun install --frozen-lockfile` | 通过；锁文件未修改 |
| `bun run bench/native-body.ts --check` | Bun 1.4.2：11 场景字节、复制、隔离和限额断言通过；不计时 |
| `PATH=/tmp/zebra-bun-native-run/runtime/bun-linux-x64:$PATH bun run bench/native-body.ts --check` | Bun 1.4.0：相同 11 场景通过；不计时 |
| 本文件验证命令中的 5 个定向测试文件 | 旧实现和临时采用候选最终合并分别在 Bun 1.4.0、1.4.2 运行，四次均 99 pass / 0 fail、1,229 assertions；覆盖 multipart、共享读取和 fuzz |
| `bun run typecheck` | 旧实现和临时候选均通过，确认锁定类型；候选检查后恢复旧实现 |
| `bun run lint` | 通过，258 files |
| `bun run build` | 通过 |
| `bun run test` | Bun 1.4.2：1,273 pass / 0 fail、132,386 assertions、115 files |
| `git diff --check` | 通过 |

本阶段日志保存在 `/tmp/zebra-native-body-02/`，文件名包括 `baseline-1.4.2.log`、`baseline-1.4.0.log`、`candidate-1.4.2.log`、`candidate-1.4.0.log`、`typecheck.log`、`candidate-typecheck.log`、`lint.log`、`build.log`、`test.log`。

测量前约定的准确命令（后续已在独占时段按相同参数各执行两次，保存所有结果）：

```sh
NATIVE_BODY_ROUNDS=9 NATIVE_BODY_SCALE=1 bun run bench/native-body.ts
PATH=/tmp/zebra-bun-native-run/runtime/bun-linux-x64:$PATH NATIVE_BODY_ROUNDS=9 NATIVE_BODY_SCALE=1 bun run bench/native-body.ts
```

环境：当前独立 worktree，已安装的锁定依赖，本机 Bun 1.4.2 与协调器准备的隔离 Bun 1.4.0；不需要外部服务。两版本及复跑依次执行，测量期间其他任务停止构建、测试和性能负载。最终合并态全套门禁仍由 03/协调器复核。

## 独占测量与最终结论（2026-09-07 America/Los_Angeles）

**T1/T2 评估完成，候选未采用。** 保留原 `Uint8Array(size)` + 循环 `set()`；没有生产源码性能变更。候选通过两个支持版本的行为检查，但在代表性场景有可复现退化，不满足采用条件。

测量 HEAD：`f09288298b0bc895624aad49f159b959c168ec31`（唯一任务 commit amend 前）；基线 `1418a2f`。最终 benchmark 和生产源码与测量 HEAD 完全一致。完整结果、所有场景中位数和配对波动见 [results/02/report.md](../../results/02/report.md)；准确四条命令、UTC 起止、运行时路径、退出码和 SHA-256 见 [manifest.json](../../results/02/manifest.json)。测量阶段未更改共享 README、队列 README、锁文件、HTTP baseline，未 rebase、merge 或操作其他分支；后续集成阶段按协调器授权归档、更新队列并 rebase。

| 正式运行（均 rounds=9、scale=1） | Bun revision | 退出码 | 原始 JSONL |
| --- | --- | --- | --- |
| Bun 1.4.2 run 1 | `744846f844374847c902b5e7fd59b4342a51ef99` | 0 | [443 条](../../results/02/bun-1.4.2-run-1.jsonl) |
| Bun 1.4.2 run 2 | 同上 | 0 | [443 条](../../results/02/bun-1.4.2-run-2.jsonl) |
| Bun 1.4.0 run 1 | `34cbb9a40b4bd1bd767d134a7065e66c2432a676` | 0 | [443 条](../../results/02/bun-1.4.0-run-1.jsonl) |
| Bun 1.4.0 run 2 | 同上 | 0 | [443 条](../../results/02/bun-1.4.0-run-2.jsonl) |

四次串行占用协调器明确授予的独占时段，测量窗口 UTC `2026-09-08 01:01:35`–`01:02:48`；Linux x64、AMD EPYC Processor、8 个逻辑 CPU。共保存 1,584 个计时样本，所有正式运行先通过 11 场景正确性断言；四次最终 checksum 都是 `15796464236`，stderr 均为空。原始结果未过滤或覆写。

采用决定的证据：

- 小 JSON 单块的局部合并耗时在四次运行增加 **202.7%–249.3%**；16 × 1 KiB 增加 **37.7%–42.3%**；这两个场景所有 36 个配对均更慢。空流、单 byte、小 JSON 多块和偏移视图也有一致的局部退化。
- 单 byte 的完整读取在两个版本的两次运行都退化：1.4.2 为 **+4.5% / +5.4%**，1.4.0 为 **+3.1% / +9.0%**；29/36 个配对更慢。1.4.2 小 JSON 单块完整读取两次为 **+7.2% / +7.1%**。
- 同时保留受益场景：256 × 64 B 局部合并改善 **27.9%–39.9%**；1 MiB 单块完整读取改善 **10.5%–14.7%**，64 × 16 KiB 改善 **8.4%–15.8%**。这些结果未抵消其他代表性场景的退化，不能据此全面替换。
- 小幅完整读取结果存在复跑反转，例如 1.4.2 的 16 × 1 KiB 为 **−3.9% / +2.2%**；1.4.0 空流为 **+10.7% / −7.5%**。报告保留配对中位数与范围，不将这种波动写成收益，也不从阶段成本推导 HTTP 吞吐倍率。

逐条验收：

| 条件 | 结论与证据 |
| --- | --- |
| T1：空流/空 chunk/单块/多块/偏移 Uint8Array 与 Buffer、复制隔离、不越界/修改/detach | 通过。新增字节与 backing buffer sentinel、双向修改隔离测试；两版本旧/候选定向测试四次均通过，正式 benchmark 各次也先独立逐字节断言 |
| T1：声明长度、流式上限、精确成功与超 1 byte 413 | 通过。`body.test.ts` 新增有/无及虚报声明、精确限额、追加一 byte 用例；既有 content-length 测试通过。候选仅在读完且逐块限额通过后传实际 size |
| T1：bodyUsed/locked、reader 释放、onReadError 边界 | 通过。声明/reader 获取失败不调用 callback，读取失败只调用一次、callback 抛错也释放 reader；已消费/锁定保留 TypeError |
| T1：cancel 抛错/拒绝/挂起不覆盖或拖延 413 | 通过。3 个新增用例以 250 ms 有界 deadline 验证，finally 清理 timer 并释放 pending cancel；既有 multipart 和共享读取取消测试通过 |
| T1：共享 body/json/text/form、stream 独占、multipart 映射、fuzz | 通过。五个定向文件 99 pass；既有共享 reader 次数和 contract middleware/handler 复用断言充足，无需扩展这些共享文件 |
| T1：范围与支持版本 | 请求体相关行为在 1.4.0、1.4.2 通过；未改生产源码、request/response/client/静态文件或配置。额外最低版本全量检查发现既有 peer-IP 断言问题，详见下表，未宣称该全量门禁通过 |
| T1：收益不足时保留旧实现 | 已执行。正式数据说明稳定退化，候选未采用；`git diff --exit-code 1418a2f -- packages/core/src` 为 0 |
| T2：独立可执行 benchmark、输出前字节正确、准确 before 基线 | 通过。`bun run bench/native-body.ts` 四次 exit 0；before 冻结 1418a2f 的完整检查/reader 代码 |
| T2：至少 7 轮、预热、交替、所有样本与环境/消费 | 通过。9 轮，各版本完整两次；1,584 样本、88 summaries、四份环境记录与 checksum，已复核原始样本、中位数、交替顺序和 SHA-256 |
| T2：等价分配/复制、输入与完整流程计时 | 通过。两方均排除字节输入创建；局部均计入分配/复制，完整均计入 Request/Headers/stream、同等声明和实际限额、相同错误/释放流程及消费，无无限额读取替代 |
| T2：独占同机同版本、采用条件、慢数据保留 | 通过。协调器发放时段后才测量，四次完全串行，按同版本 before/after 判定未采用；保留全部正负结果，无 baseline 重录 |

测量后普通校验均在同一 `f092882` HEAD 加证据文件的 worktree 执行；生产源码及 benchmark 未变。[validation.json](../../results/02/validation.json) 记录准确命令、版本、起止、退出码和日志 SHA-256，日志随证据提交；含尾随空格的原始构建/全量测试输出用 gzip 无损保存，确保保留原始字节且通过 diff whitespace 检查。

| 命令 | Bun 1.4.2 | 隔离 Bun 1.4.0 |
| --- | --- | --- |
| 上方验证方式的 5 个定向测试文件 | exit 0；99 pass / 0 fail、1,229 assertions | exit 0；99 pass / 0 fail、1,229 assertions |
| `bun run typecheck` | exit 0 | exit 0 |
| `bun run lint` | exit 0 | exit 0 |
| `bun run build` | exit 0 | exit 0 |
| `bun run test` | exit 0；1,273 pass / 0 fail、132,386 assertions | **exit 1；1,272 pass / 1 fail**、132,386 assertions；既有 peer-IP 测试断言不接受 IPv4-mapped IPv6 |
| `bun test packages/core/test/app/dispatch.test.ts`（针对失败复核） | 无需重复 | **exit 1；10 pass / 1 fail**，同一个 peer-IP 断言 |
| `bun run plans/bun-native/results/02/peer-ip-repro.ts` | exit 0；localhost 为 `::1` | exit 0；localhost 为 `::ffff:127.0.0.1`；Zebra 与原生 requestIP 一致 |
| `git diff --check` / `git diff --cached --check` | 均 exit 0，提交前再次执行 | 不依赖 Bun |

最低版本所有命令前缀均为 `PATH=/tmp/zebra-bun-native-run/runtime/bun-linux-x64:$PATH`，确保脚本子进程使用最低版本。类型重载、两版本候选行为和原实现行为仍然通过。

交给 03/协调器的门禁例外：`packages/core/test/app/dispatch.test.ts:74` 只允许 `127.0.0.1` / `::1`，在本机 Bun 1.4.0 的 localhost IPv4-mapped IPv6 结果上稳定失败；[行为复现脚本](../../results/02/peer-ip-repro.ts) 同时比较 Zebra 与直接 `Bun.serve().requestIP()`，证明二者结果一致。`git diff --exit-code 1418a2f -- packages/core/src packages/core/test/app/dispatch.test.ts` 为 0，失败路径与本任务无源码差异。该现有断言在 02 范围外，未修改或跳过它，未伪报最低版本全量通过；由协调器决定后续处理。除此之外没有本任务未完成项。最终集成记录应写“请求体合并已评估、未采用”，队列归档已由协调器串行完成。
