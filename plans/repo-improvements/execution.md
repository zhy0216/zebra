# repo-improvements 执行记录

日期：2026-09-05。分析基线 `eb94a2a`，计划提交 `c2b57a4`。

用户后续要求直接用 subagent 执行。3 个当前会话的 Codex subagent 与主 agent
在独立 worktree 中并行实现，逐项复核、合并回 `master`。21 个任务覆盖 F01–F35，
具体提交见 [任务完成表](todos/README.md#执行结果)。

## 实现与复核

- 请求体缓冲读取共享一次有限字节读取，stream 保持互斥；清理失败仍尝试全部资源，
  listen 的 boot/ready 阶段均防重复启动和停止后重新启动。
- 静态文件处理 If-Range、弱 If-None-Match 与 index 缓存隔离；Allow 汇总所有匹配分支。
- session 共享首次加载，串行持久化并保留写入期间的新修改；内存 store 的有界扫描
  最终覆盖尾部，过期目标独立检查；非法限流配置在写入前失败。
- client 与 MCP 使用正确的 Headers 覆盖和一次路径插值；MCP 保留取消信号，
  检查工具重名并改正 namespace 必填推断。Zod 普通对象交集在组合层闭合，
  复杂交集保留原生输入约束；实际 Ajv validator 与 dispatch 回归覆盖嵌套组合。
- CORS 补全缓存变体；指标按 nearest-rank 计算，容量有限，health 按 GET/HEAD 匹配。
  论坛在同步插入点保证用户名唯一，并发注册只保留获胜账户和密码。
- 发布脚本校验输入、版本和目标 Git 状态，并限定 release 提交范围；打包验证在
  pack/tar/install/import/typecheck 失败后清理临时项目且保留诊断。
  coverage 与 benchmark 门禁拒绝非法输入；根类型检查纳入示例、脚本与基准。
- 4 份入口文档逐项核对全部 12 个 package manifest，校正 facade、工作流、代码风格
  和双语请求体说明。

交叉审查发现 multipart 超限时底层 cancel 的拒绝或挂起可能覆盖/拖住 413；
该问题已由 `12d5559` 修复，并恢复 multipart 读取失败的既有 400 语义。
随后审查发现 HTTP 自动 session 保存绕过 flush 队列，同一 handle 写入期间的新修改
可能被 clearDirty 吞掉；该集成缺口由 `a964495` 修复，同时补全保存期间销毁的
正常/错误响应过期 cookie 行为。新增 7 个真实 HTTP 请求回归。

独立审查已完成，剩余范围无 blocking findings。MCP/schema 额外通过 12 组 Zod/Ajv
有效输入、5 类真实 SDK 调用及 cancellation 复核；工具脚本的异常输入探针正确失败，
且没有改动真实 baseline。文档复核还校正了双语 body() 的 urlencoded 普通对象与
其他内容类型 Uint8Array 返回说明。

## 校验

- 类型检查的编译文件列表确认包、示例、scripts、bench 的 218 个 TypeScript 文件
  无遗漏；在独立 worktree 给 example 与 script 各注入类型错误，根命令均失败，
  删除后成功。此数量是任务 20 当时的快照，后续新增回归也由相同 glob 自动纳入。最终独立复核确认 219 个文件无遗漏。
- 所有任务各自的针对性测试、类型检查与 lint 已通过。
- 官方 registry 审计仍退出非零：仅剩 R01 的 4 条文档工具链 advisory，
  其中 1 high、3 moderate；fast-uri/qs 的 6 条原有告警已消除。

最终合并态（代码 `a964495`，另有文档校对）结果：

| 命令 | 结果 |
| --- | --- |
| `bun install --frozen-lockfile` | 成功，依赖清单与锁文件一致 |
| `bun run typecheck` | 成功，根 tsgo 包含包、示例、脚本、基准及其测试 |
| `bun run lint` | 成功，251 个文件，无错误 |
| `bun run build` | 12 个包全部成功 |
| `bun test` | **921 pass / 0 fail**，17,348 个断言，107 个测试文件 |
| `bun run verify:packages` | 12 个 tarball 内容、独立安装、运行时导入和类型解析全部成功 |
| core LCOV + `bun run check:coverage` | **2303/2336 core/src 行，98.59%**，超过 90% 门槛 |
| `bun run docs:build` | 成功，双语文档构建 3.36 秒 |
| `bun audit --registry https://registry.npmjs.org` | 退出 1；仅余已记录 R01：1 high、3 moderate |
| `bun run bench:check` | 8 个场景全部通过 RPS ≥80%、P95 ≤125% 原基线门禁 |

性能门禁在其他测试和构建结束后独立运行，原始结果如下（未更新 baseline）：

```text
$ bun run bench/bench-regression.ts
# Zebra bench:check (Bun 1.4.0)
duration: 1000ms × concurrency 64

static          97960 req/s (113%)  p95 1.09ms (90%)  OK
param           94055 req/s (112%)  p95 1.13ms (92%)  OK
wildcard        92859 req/s (112%)  p95 1.15ms (91%)  OK
middleware      88966 req/s (114%)  p95 1.19ms (90%)  OK
json            83131 req/s (104%)  p95 1.25ms (95%)  OK
di              75636 req/s (96%)  p95 1.39ms (104%)  OK
static-file     33427 req/s (102%)  p95 2.94ms (99%)  OK
post-json       28852 req/s (108%)  p95 3.59ms (97%)  OK

OK: all zebra scenarios within thresholds
```

任务 worktree 与临时分支已在合并后清理，仅保留主工作树。21 个任务各有独立
实施提交；03 和 07 另有上述交叉审查补修提交，避免重写已合并历史。

## 保留的 roadmap

- R01：VitePress 所依赖的 Vite/esbuild 工具链迁移；当前审计尚未全绿。
- R02：Redis 跨请求原子性、销毁后的旧写入及 key 布局兼容迁移。
- R03：装饰器相关文件的 lint 工具兼容与忽略范围收敛。

本轮没有发布 npm、push、部署或更新真实 benchmark baseline。
