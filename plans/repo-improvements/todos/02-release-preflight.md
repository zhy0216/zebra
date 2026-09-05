difficulty: hard

# 发布脚本的前置校验与失败隔离

优先级：P1

来源：plan.md F02、F03

执行模型：max

前置依赖：无

## T1 · 在任何写入/发布前完成检查

要做什么：梳理 dry-run、prepare、publish、publish-only 的控制流。prepare/local publish 必须提前检测工作区未提交内容、已有目标 tag；已有 tag 在 publish-only 模式是正常发布来源，不能误拒绝。参数冲突、缺值、无效 SemVer 提前失败。不要改变已有合法命令用法或去掉 publish-only 的版本核对。

预计修改文件（本任务共享范围）：

- `scripts/release.ts`
- `scripts/test/release.test.ts（新增）`
- `scripts/release-helpers.ts（仅有必要时新增）`

验收条件：dirty tracked/untracked/staged 改动和重复 tag 均在写文件或调用发布命令前被拒绝；publish-only 可以处理已存在的 release tag；dry-run 不写文件/commit/tag/publish。拒绝 01.2.3、1.2.3-..、1.2.3-alpha..1、1.2.3-01、1.2.3+..，接受合法 prerelease/build（build 数字标识可有前导零）。

前置依赖：无。

## T2 · 限定暂存范围并保留失败诊断

要做什么：将 git add -A 改为明确的本次发布文件清单，逐个检查子命令结果，add 失败绝不能继续 commit，commit 失败不能 tag。保留 subprocess error/stderr，使 typecheck/test/publish 失败可定位；不要把 lockfile 元数据假设当成CI故障。用临时 git fixture 或命令替身覆盖各阶段。

预计修改文件（本任务共享范围）：

- `scripts/release.ts`
- `scripts/test/release.test.ts（新增）`
- `scripts/release-helpers.ts（仅有必要时新增）`

验收条件：测试证明 unrelated 文件不被提交；add/commit/tag/verify/publish 的失败退出正确且后继危险动作未执行。所有测试仅在临时 repo / 替身中运行，绝不对当前仓库创建 release commit/tag 或访问真实 publish。

前置依赖：无；与本文件前面条目一起完成、一起提交。

## 校验

```sh
bun test scripts/test/release.test.ts
bun run typecheck
bun run lint
bun test
```

按 plan 的公共约束保留 v1 API 与现有正常路径。只改本任务拥有的文件；需要扩大范围时先协调依赖。
