difficulty: medium

# 打包校验失败也清理临时项目

优先级：P2

来源：plan.md F32

执行模型：flash

前置依赖：无

## T1 · 用可收尾的错误传播替代内部 process.exit

要做什么：内部失败throw或等价传播，最外层报告并设置失败退出码，让临时目录的finally在pack/tar/install/import/tsgo任一阶段失败时执行。保留原错误，清理失败不能遮蔽主要故障；子进程启动失败应可诊断。只作必要结构调整，不更改发布策略。

预计修改文件（本任务共享范围）：

- `scripts/verify-packages.ts`
- `scripts/test/verify-packages.test.ts（新增）`

验收条件：注入pack/install/typecheck等失败后退出非零，原始诊断保留，临时项目和tarballs均已清理；成功路径也清理；真实12包verify通过。测试用隔离fixture/替身，不能依赖网络失败或故意破坏当前包。

前置依赖：无。

## 校验

```sh
bun test scripts/test/verify-packages.test.ts
bun run typecheck
bun run lint
bun run build
bun run verify:packages
```

按 plan 的公共约束保留 v1 API 与现有正常路径。只改本任务拥有的文件；需要扩大范围时先协调依赖。
