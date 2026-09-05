difficulty: medium

# 让 benchmark 检查拒绝无效基线

优先级：P2

来源：plan.md F33

执行模型：flash

前置依赖：无

## T1 · 分开 check 与 update 模式的数据契约

要做什么：普通check对缺少任一SCENARIOS项、非有限或无效rps/p95基线前置失败，不能临时生成baseline并报成功。校验BENCH_DURATION_MS/BENCH_CONCURRENCY有效正数/整数策略；只有显式--update可生成并写基线。保留现有阈值和三次中位选择。抽出纯比较/输入校验便于确定性测试。

预计修改文件（本任务共享范围）：

- `bench/bench-regression.ts`
- `bench/test/bench-regression.test.ts（新增）`
- `bench/regression.ts（仅有必要时新增）`

验收条件：缺失scenario和NaN/Infinity/非法零分母不会通过；边界rps=80%、p95=125%判定与原规则一致；普通check从不写baseline；模拟--update写临时路径正确；异常时server关闭。不得修改当前bench/baseline.json，也不通过放宽阈值解决机器差异。

前置依赖：无。

## 校验

```sh
bun test bench/test/bench-regression.test.ts
bun run typecheck
bun run lint
```

实现后可运行 bun run bench:check 记录当前机器结果。若现有硬件基线不适用，保留失败原文；本任务验收以确定性比较/输入测试为核心，不能更新真实baseline。
