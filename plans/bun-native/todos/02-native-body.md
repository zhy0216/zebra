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
