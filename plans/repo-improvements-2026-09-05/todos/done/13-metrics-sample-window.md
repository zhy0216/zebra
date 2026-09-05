difficulty: medium
agent: inherit

# 13 · 降低精确指标采样窗口的重复排序成本

来源：plan.md F20。优先级：P2。一个独立 worktree，一个最终 commit。

## T1 · 优化有界窗口和精确分位数更新

- 要做什么：优化 metrics 内部 samples 的淘汰和 snapshot 的排序计算，避免每次 onSample 从头对 N 项排序；可使用环形时间窗口与精确有序索引/缓存，选择最小的内部实现。保留无 callback 的低成本路径，不能用近似分位数替代 nearest-rank。
- 预计修改文件：`packages/observability/src/metrics.ts`、`packages/observability/test/metrics.test.ts`；必要时新增包内私有 `packages/observability/src/latency-window.ts`，不增加 exports 或依赖。
- 验收条件：容量 0/1/N、超过容量后多次环绕、重复值、有序/逆序/随机样本、读多写少与每次回调均正确；latencySamples 按时间顺序，P50/P95 精确符合原算法；修改返回 snapshot 数组不污染后续结果。计数、bucket、onSample 次数及失败隔离保持原行为。
- 前置依赖：无。

## T2 · 用可重复的前后测量验证收益

- 要做什么：同机对基线与改后实现使用相同预热、10k+ 调用和容量进行多轮测量，至少包含无 callback、空 onSample、主动重复 snapshot。可以用临时脚本，报告方法及中位数，不提交新的脆弱绝对计时测试。
- 预计修改文件：同 T1；性能测量结果放在任务交付说明，不修改 bench/baseline.json。
- 验收条件：默认容量 1000 的每次 onSample 负载比基线有稳定可重复的改进；无 callback 路径没有明显退化，内存始终 O(capacity)。单元测试验证行为，性能证据验证收益；如果只有复杂度增加而没有收益，应缩小实现并报告，不宣称优化成功。
- 前置依赖：本文件 T1；外部依赖无。

## 校验与交付

运行 `bun test packages/observability`、`bun run typecheck`、`bun run lint`、`git diff --check`，以及上述独立性能对照。在空闲条件运行 `bun run bench:check`。R04 的 timeout/inFlight/errors 统计口径不属于本任务，不能顺手改变观测语义。

## 完成记录

- 状态：已完成，T1/T2 全部验收通过；2026-09-06 在协调器持有集成锁时归档，等待协调器仓库级校验与合并。
- 执行：Codex / `gpt-6-astra` / `xhigh`，任务 agent `zebra-0905-13` 亲自实现。
- 实现只修改 `packages/observability/src/metrics.ts` 和 `packages/observability/test/metrics.test.ts`，不增加 exports 或依赖，不改变 v1 签名、nearest-rank、计数、bucket、callback 时机和失败隔离；R04 未执行。
- 环形数组替代头部淘汰；两次 snapshot 之间没有写入时复用排序缓存，一次写入时二分定位并精确删除/插入，多次写入时在下次读取重新排序。无 callback 的写入始终 O(1)，不会因曾经读取 snapshot 而维护有序数组。
- 内存 O(capacity)：环形样本与私有有序数组各最多 capacity 项，淘汰值/游标为常数状态，写入计数封顶 2；没有累积的更新队列。返回数组与临时排序/拷贝数组也有 O(capacity) 上界。此结论来自存储结构，不以有限次数的堆测量推断无限运行。

### 行为验收

`bun test packages/observability`：93 pass / 0 fail，112,953 次断言。以原来的 FIFO 保留加全量数值排序为 oracle，覆盖容量 0/1/3/11/64/1000、超过三轮环绕、升序/降序/重复值/固定种子随机值、每次 callback、每请求主动读取、批量读取和读多写少。每次检查重复读取三次并修改返回的 samples、buckets、bounds，确认时间顺序、精确 P50/P95 和后续快照不受污染。额外覆盖 callback 抛错时成功/503 响应、原 handler 错误、计数、bucket 和 callback 次数保持正确。

### 前后对照方法

- 同机 Apple M3 Max、macOS 26.6.2 arm64、Bun 1.4.0（34cbb9a40）；协调器明确授予独占时段，其他仓库构建、测试和测量均已结束。正常 OS 后台进程保留。
- before 为 `fbb28c1796faf93959a703d5e97d56c53603f4bc` 的原始 metrics.ts，after 为本任务实现的字节相同副本。两种时钟模式各 11 轮，同轮交错 before/after，逐轮交替先后次序并轮换五个场景；每个计时块前执行完整 GC，GC 不计入耗时。
- 默认容量 1000；每组预热 10,000 次。两种无 callback 场景测量 100,000 次 middleware 调用；空 callback、每请求 snapshot 场景各测量 20,000 次 middleware 调用。重复 snapshot 场景先写满 1000 项、预热 10,000 次读取，再测量 20,000 次读取，无新增写入。
- 无 callback 第一种状态在计时前从未读取 snapshot；第二种状态在预热后、计时写入前主动读取一次，验证已有缓存不会增加之后无读取写入的成本。
- 复用 Response、async next 和 middleware 不使用的 request，排除请求构造和网络成本；snapshot 结果进入 checksum，计时后检查请求数、窗口长度、bucket 总数、errors 和 inFlight。
- 固定种子使用 LCG：初始 `0x5eed`，每项 `state = (Math.imul(state, 1664525) + 1013904223) >>> 0`，延迟 `(state % 10007) / 4` ms。只替换 middleware 的采样时钟，墙钟计时使用事先绑定的原生 performance.now。before/after 得到相同输入，每轮完整 snapshot 深比较全部通过。
- 真实时钟复核使用未替换的 performance.now；采样延迟自然不同，仅固定种子模式要求完整 snapshot 相等。命令依次为 `bun compare.ts seeded 11`、`bun compare.ts real 11`，均 exit 0，stderr 为空。

下表单位为毫秒，before → after 为 11 轮耗时中位数；改善轮数逐对比较。

| 场景 | 测量操作数 | 固定种子中位数 | 改善轮数 | 真实时钟中位数 | 改善轮数 |
| --- | ---: | ---: | ---: | ---: | ---: |
| 无 callback | 100,000 | 13.865 → 11.180 | 11/11 | 14.304 → 11.550 | 11/11 |
| 读取后无 callback | 100,000 | 13.015 → 11.099 | 10/11 | 13.983 → 11.496 | 11/11 |
| 空 callback | 20,000 | 1839.841 → 46.033 | 11/11 | 1248.837 → 45.009 | 11/11 |
| 每请求 snapshot | 20,000 | 1849.387 → 43.784 | 11/11 | 1281.263 → 44.640 | 11/11 |
| 重复 snapshot | 20,000 | 1282.409 → 20.507 | 11/11 | 849.529 → 16.942 | 11/11 |

空 callback 两种时钟的中位数比分别为 39.97x、27.75x，改善在全部配对轮次中复现。固定种子「读取后无 callback」第 6 轮为 12.496791 → 12.703333 ms，单轮 **+1.65%**；其余 10 轮和真实时钟 11 轮均改善。保留此波动事实，不把单轮波动称为优化或明显退化。

局限：这是局部 middleware/snapshot 成本测量，不是生产 HTTP 吞吐倍率承诺。有序数组移动和快照拷贝仍为 O(capacity)，多次写入后首次读取仍需全量排序；没有提交绝对计时测试，也没有修改真实 benchmark baseline 或门槛。

完整脚本、before/after 源码、方法、每轮数据、中位数及日志保留于：

```text
/var/folders/b6/161n55hx7f7d9lqmqq8h13lw0000gn/T/zebra-metrics-13-7_y96kh6/
```

其中 `compare.ts`、`before.ts`、`after.ts` 为测量输入，`seeded.jsonl` / `real.jsonl` 各包含 55 组逐轮配对和 5 组汇总，`seeded.stderr.log` / `real.stderr.log` 保留 stderr，`report.md` 记录完整交付，`bench-check.log` 为初次仓库 benchmark，`observability-tests.log` 为初次最终定向测试。

### 串行集成验证

已无冲突 rebase 到 `master` 的 `e12e007d593d7c4058517185983aa2c1fb2ce83e`。实现和测试字节均未变化；metrics.ts SHA-256 为 `1a334b9685adcd0476e282b4489eee9eb289165a2bcbb85c3438b6f7f700b123`，与已审查的 after.ts 相同。协调器已独立复核源码、脚本、全部原始数据并重算中位数，因此按授权沿用前后微基准证据。

- `bun install --frozen-lockfile`：exit 0，独立 worktree 的依赖同步到 master 锁文件。
- `bun test packages/observability`：exit 0，93 pass / 0 fail，112,953 次断言。
- `bun run typecheck`：exit 0。
- `bun run lint`：exit 0，256 files，No fixes applied。
- `git diff --check`：exit 0。
- 空闲条件原样 `bun run bench:check`：exit 0，8/8 场景通过，默认 1000 ms、并发 64，每场景 3 次按 req/s 取中位数；无环境覆盖、baseline 更新或门槛修改。

| 场景 | req/s | p95 ms |
| --- | ---: | ---: |
| static | 91773 | 1.15 |
| param | 90227 | 1.17 |
| wildcard | 92641 | 1.16 |
| middleware | 89056 | 1.19 |
| json | 89657 | 1.17 |
| di | 75858 | 1.34 |
| static-file | 32407 | 2.90 |
| post-json | 26873 | 3.71 |

上述新日志位于同一目录的 `rebased-observability-tests.log`、`rebased-typecheck.log`、`rebased-lint.log`、`rebased-bench-check.log`。benchmark baseline 前后 SHA-256 均为 `1e37941b73db6daae50170b62e220dcc5ccefe17f1452806eaddf73bd6e394ba`。全部测量进程结束后已立即通知协调器。无剩余 blocker；本阶段只归档本 todo 并更新 README 的任务 13 两处，保留任务 12 部分完成／延后状态与原路径，不修改 plan.md。
