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
