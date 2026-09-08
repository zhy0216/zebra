# JSON 原生响应评估结果 · 01

结论：**五个生产入口全部保留原源码，没有采用原生迁移。**
两个固定顶层 Problem+Json 候选的行为检查通过，但错误中间件局部成本在两版复跑中均退化；
完整错误 dispatch 的收益不稳定，WebSocket 响应构造的微小变化落在控制场景波动内。
helper、普通 handler、contract 的直接替换候选存在根值兼容差异，因此没有进入生产源码。
这仅否定本次直接替换及测量过的两个固定根值候选，不推断所有可能的兼容包装均不可行。

## 环境、命令与来源

- 工作分支：`herdr/plan-bun-native-01-native-json`；测量 HEAD 与比较基线均为
  `1418a2f3f8b3e0bae53490eb195811b34590e041`，包含已有 session 提交 `4466df7`。
- 测量时两处候选尚未提交。`candidate.patch` 保存完整生产 diff；每份 JSONL 的首行
  保存 baseline/current、coreDiff、全部 core 源码 SHA-256、benchmark 脚本 SHA-256。
  `provenance.json` 和原样保存的 `bench-measured.ts.txt` 使未提交候选及测量脚本可追溯。
- 日期：2026-09-07（America/Los_Angeles），UTC 日志为 2026-09-08；每次开始/结束时间及
  实际 argv 见同名 `.run.json`，版本/Bun 路径/CPU/平台见 JSONL 首行。
- 机器：AMD EPYC Processor；linux x64；8 logical CPUs。
- 已使用本 worktree frozen-lockfile 安装的依赖；未升级全局 Bun、依赖、锁文件或最低版本。

测量使用下列命令（当时工作树包含 `candidate.patch`，测量脚本默认 `current`）：

```sh
bun run bench/native-json.ts --baseline 1418a2f3f8b3e0bae53490eb195811b34590e041 --rounds 7 --iterations 10000 --warmup 2000
PATH=/tmp/zebra-bun-native-run/runtime/bun-linux-x64:$PATH bun run bench/native-json.ts --baseline 1418a2f3f8b3e0bae53490eb195811b34590e041 --rounds 7 --iterations 10000 --warmup 2000
```

`measure.py BUN_EXECUTABLE LABEL 15` 串行包装上述命令，保存完整 stdout 到 `LABEL.jsonl`、
stderr 到 `LABEL.stderr.txt`、负载到 `LABEL.load.jsonl`、命令/退出码到 `LABEL.run.json`。
各有效版本完整复跑两次，每次保留全部 23 场景、每场景 7 组交替顺序的 before/after 数据，
每实现每轮 10,000 次，预热 2,000 次。每次响应正文均 `.text()` 消费并全文对照预先生成的 JSON；
全部 644 组有效配对的消费校验和相等。每个场景另验证每实现 64 个输入的 status、content-type、
cookies 和正文。四份有效数据的 before/after 源码哈希和测量脚本哈希完全一致。

测量包括完整响应构造和真实 Zebra helper / 普通、helper、contract dispatch / error middleware /
error dispatch / WebSocket Problem helper。同一场景两侧使用相同路由、值、schema、Request 和选项。
输入、Request 及被抛出的 HttpError 在计时外准备；框架内部工作和正文消费留在计时内。
这些是**进程内构造/dispatch 成本，不是 HTTP 吞吐**。

## 时段与数据选择

- 开始时检测到另一个 workspace 的 Rust release 构建，随后是间歇运行的 Bun 测试、构建和 benchmark。
  只观察及等待，没有操作其他 workspace、分支或进程。
- Bun 1.4.2 的 run1/run2/run3 和 Bun 1.4.0 的 run2 虽已完整完成，但期间记录到其他 CPU 负载，
  **全部保留、全部排除采用判断**。具体 PID、时刻和 CPU 比例见 `.run.json` / `.load.jsonl`。
- 后续规则为连续 15 个两秒安静样本后启动；测量期间继续记录每两秒的进程 CPU 活动。
  其他进程达到单核 15% CPU 或存在活动 benchmark/build/test 命令时等待或标记干扰。
  四份有效复跑均没有记录到这些干扰。这是采样观察，不能证明采样间绝无短暂系统活动；控制场景仍有噪声。
- 曾考虑区分长时间空闲的测试进程，但在调整前外部测试已退出，未实际放宽最终规则。
  一个冗余等待记录器在正式计时前被取消，见 `bun142-run6-wait-only.json`；它没有测量数据，没有并行 benchmark。
- 有效数据：`bun142-run4.jsonl`、`bun142-run5.jsonl`、`bun140-run1.jsonl`、`bun140-run3.jsonl`。
  `selection.json` 保存机器可读选择；`summary.csv` 保存全部有效中位数、变化率和逐轮胜出次数。

## 全部场景中位数比较

以下为候选相对旧构造的耗时变化百分比：**正数更慢，负数更快**。
C 为源码未改的控制场景；R 为局部原生 API 对照，不能据此声称通用入口已迁移；F 为实际框架候选。

| 场景 | 类别 | 1.4.2 run4 | 1.4.2 run5 | 1.4.0 run1 | 1.4.0 run3 |
| --- | --- | ---: | ---: | ---: | ---: |
| `constructor/small` | R | +1.92% | +3.90% | +0.33% | +4.72% |
| `framework/helper/small` | C | +0.78% | +1.71% | +2.18% | +8.56% |
| `framework/dispatch-value/small` | C | -1.06% | -4.11% | -8.48% | +2.22% |
| `framework/dispatch-helper/small` | C | -1.09% | -7.86% | -9.78% | -1.57% |
| `framework/dispatch-contract/small` | C | +0.69% | -1.21% | -3.67% | -1.76% |
| `constructor/nested-array` | R | +3.09% | +2.35% | +5.43% | +3.02% |
| `framework/helper/nested-array` | C | -2.22% | +5.07% | +0.38% | +0.31% |
| `framework/dispatch-value/nested-array` | C | +0.39% | +4.41% | -1.55% | +0.92% |
| `framework/dispatch-helper/nested-array` | C | +0.59% | +1.86% | +0.56% | +0.34% |
| `framework/dispatch-contract/nested-array` | C | -0.44% | -0.26% | -5.46% | +3.74% |
| `constructor/unicode` | R | +55.33% | +64.19% | +53.67% | +51.71% |
| `framework/helper/unicode` | C | +5.32% | -0.69% | +2.59% | -3.44% |
| `framework/dispatch-value/unicode` | C | +0.73% | +2.18% | +5.68% | -3.69% |
| `framework/dispatch-helper/unicode` | C | -4.89% | -2.06% | -3.58% | -0.19% |
| `framework/dispatch-contract/unicode` | C | -7.94% | +1.08% | -3.80% | +0.56% |
| `constructor/problem` | R | +15.69% | +23.78% | +18.21% | +17.53% |
| `framework/helper/problem` | C | -3.53% | +5.80% | -3.64% | +0.07% |
| `framework/dispatch-value/problem` | C | -3.38% | +0.34% | -2.13% | -7.31% |
| `framework/dispatch-helper/problem` | C | -0.41% | +0.98% | -10.58% | -1.97% |
| `framework/dispatch-contract/problem` | C | +2.38% | -1.00% | -3.16% | +0.24% |
| `framework/middleware/problem-cookies` | F | +12.33% | +16.72% | +5.72% | +6.20% |
| `framework/dispatch-error/problem-cookies` | F | +10.12% | +7.95% | -5.86% | +7.30% |
| `framework/ws-problem/rejected` | F | -2.65% | +0.63% | +0.06% | -1.27% |

源码未改的 16 个控制场景，其耗时变化范围分别为：

| 复跑 | 控制场景范围 | 绝对变化的中位数 |
| --- | ---: | ---: |
| bun142-run4 | -7.94% ～ +5.32% | 1.07% |
| bun142-run5 | -7.86% ～ +5.80% | 1.79% |
| bun140-run1 | -10.58% ～ +5.68% | 3.61% |
| bun140-run3 | -7.31% ～ +8.56% | 1.67% |

没有按最佳单轮或四次复跑中的最佳数值判定收益。WebSocket 的四次变化为 -2.65%、+0.63%、
+0.06%、-1.27%，幅度和方向不足以从控制噪声中确认收益。错误中间件局部成本在四次复跑中
分别增加 12.33%、16.72%、5.72%、6.20%；完整错误 dispatch 在 1.4.2 两次均退化，
1.4.0 则一次更快、一次更慢。两候选均不满足稳定收益且无可复现退化的采用条件。

## 逐入口决定与兼容证据

| 入口 | 决定 | 证据 |
| --- | --- | --- |
| `http/response.ts::json` | 保留原源码 | 直接 `Response.json` 对 function/Symbol（含带 toJSON 的函数）抛错；对象 toJSON 返回无 JSON 表示的根值时会从 null body 变为空流。提前准备 Headers 还会改变序列化副作用顺序。 |
| `app/internals.ts::toResponse` | 保留原源码 | 保留上述根值边界、undefined→204 及 response_serialization 映射；benchmark 中为真实未改控制。 |
| `contract/implement.ts` | 保留原源码 | 保留自身 status/204、Response 直返/204 禁止直返、output validation 及 internal 错误映射；benchmark 中为真实未改控制。 |
| `middleware/error.ts` | 恢复原源码 | 候选行为通过；局部成本两版均反复退化，完整 dispatch 未显示稳定收益。 |
| `ws/upgrade.ts::wsProblemResponse` | 恢复原源码 | 既有拒绝行为通过；收益幅度未超过控制波动且方向不稳定。 |

`response.test.ts`、`dispatch.test.ts`、`contract/implement.test.ts`、`middleware/error.test.ts`
保留本次行为对照：字符串/null/布尔/数字/嵌套对象/数组/Unicode、undefined/function/Symbol、
函数/对象 toJSON 和空根值、getter/toJSON 次数、循环/BigInt/抛错映射、Headers 三种形式、
显式 content-type/status/statusText、独立 Set-Cookie、不修改调用方 Headers，以及无正文 status 边界。
新增测试是兼容证据；最终生产源码相对基线没有变化，没有新增公开 API 或私有 helper。

## 最终 HEAD 复现

最终脚本默认 `--candidate problem-native`，在第二份基线临时源码里只替换两个固定顶层
Problem 构造，执行真实框架路径。它不修改 checkout，不把原始不兼容 API 用于三个通用入口。
默认模式的全部候选源码哈希已与测量时源码逐文件核对相等。只改变了默认模式及帮助文本，
计时循环、输入和路线构建与归档测量脚本相同。`--candidate current` 可单独检查最终原源码控制。

```sh
# 每版完整复跑两次；在无人构建/测试/benchmark 的时段执行，保存完整 stdout。
bun run bench/native-json.ts --baseline 1418a2f --rounds 7 --iterations 10000 --warmup 2000 --candidate problem-native
PATH=/tmp/zebra-bun-native-run/runtime/bun-linux-x64:$PATH bun run bench/native-json.ts --baseline 1418a2f --rounds 7 --iterations 10000 --warmup 2000 --candidate problem-native

# 无计时的行为检查；这两种模式在最终原源码上都可执行。
bun run bench/native-json.ts --check
bun run bench/native-json.ts --candidate current --check
```

需要 Git 中存在基线 commit、tar、冻结依赖安装和相应 Bun 执行文件；无需额外 worktree 或网络。

## peer-IP 原始失败与夹具修正

Bun 1.4.0 的原始基线测试得到 IPv4-mapped IPv6 地址 `::ffff:127.0.0.1`，未满足原有回环地址断言。
`peer-ip-original-bun140.txt` 保存原始基线 10 pass / 1 fail 的结果。
按协调器要求，仅将该测试的监听 hostname 和 fetch 地址都固定为 `127.0.0.1`。
真实 HTTP 请求、`x-forwarded-for: 203.0.113.66`、原来的全部断言和清理流程保持不变，
没有修改生产网络语义。两版单文件均 13 pass / 0 fail、89 assertions，见
`peer-ip-fixed-bun142.txt` / `peer-ip-fixed-bun140.txt`。

## 仓库验证

候选状态的两版根 typecheck、lint、build、test 全部通过，全量各 1,289 pass / 0 fail、132,910 assertions。
完整日志见 `candidate-*`。Bun 输出中含有行末空格的 build/test 日志以 `.txt.gz` 无损保存，
既保留原始字节又满足仓库 diff 检查；可用 `gzip -dc FILE.txt.gz` 读取。
最终恢复源码后的两版必要定向检查及根门禁也全部通过，结果如下。


| 最终命令 | Bun 1.4.2 | Bun 1.4.0 |
| --- | --- | --- |
| todo 定向测试，加 `app/timeout.test.ts` | 369 pass / 0 fail，5,654 assertions | 369 pass / 0 fail，5,654 assertions |
| `bun run typecheck` | exit 0 | exit 0 |
| `bun run lint` | exit 0 | exit 0 |
| `bun run build` | exit 0 | exit 0 |
| `bun run test` | 1,289 pass / 0 fail，132,910 assertions | 1,289 pass / 0 fail，132,910 assertions |
| 最终默认候选模式 `--check` | 23 场景通过 | 23 场景通过 |

最终门禁日志为 `final-targeted-*`、`final-typecheck-*`、`final-lint-*`、`final-build-*`、
`final-test-*`；最终行为检查为 `final-check-*`。类型/样式/构建/全套测试命令在最低版本
均通过 `PATH=/tmp/zebra-bun-native-run/runtime/bun-linux-x64:$PATH` 运行，包括它们的 Bun 子进程。
`git diff --check` / 暂存 diff 检查均通过；所有 core 生产源码与 `1418a2f` 完全一致。
`SHA256SUMS` 校验本目录交付的证据文件原始字节；在仓库根目录执行 `sha256sum -c plans/bun-native/results/01/SHA256SUMS`。

本任务不包含 rebase、merge、push、PR、队列归档或共享 README 修改；最终仅创建一个任务 commit。
