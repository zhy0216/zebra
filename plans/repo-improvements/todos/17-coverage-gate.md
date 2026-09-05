difficulty: medium

# 校验 coverage 门禁输入并限定统计范围

优先级：P2

来源：plan.md F30、F31

执行模型：flash

前置依赖：无

## T1 · 可靠解析 LCOV 与阈值

要做什么：校验COVERAGE_THRESHOLD为[0,1]有限数（缺省0.9）；坏数据、无数据和无效范围非零退出。按SF只统计packages/core/src/**，包含packages/core/src/contract/**；排除packages/contract/src/**和packages/core/test/**，兼容LCOV绝对/相对路径的规范化。保留默认coverage/lcov.info入口，可通过导出纯解析函数/隔离fixture测试，不要覆盖当前仓库coverage文件做故障测试。

预计修改文件（本任务共享范围）：

- `scripts/check-coverage.ts`
- `scripts/test/check-coverage.test.ts（新增）`

验收条件：banana/NaN/Infinity/负数/>1拒绝；无LF/LH、LH>LF、重复或畸形记录按明确策略处理且不能抬高覆盖率；混合fixture只计packages/core/src源码（其中core/src/contract必须计入），其他package和test helper不计入；正好90%通过、低于失败、无core记录失败。实际core覆盖命令加gate通过，报告正确分母。

前置依赖：无。

## 校验

```sh
bun test scripts/test/check-coverage.test.ts
bun run typecheck
bun run lint
bun test --coverage --coverage-reporter=lcov packages/core
bun run check:coverage
```

按 plan 的公共约束保留 v1 API 与现有正常路径。只改本任务拥有的文件；需要扩大范围时先协调依赖。
