# 协调器独立验收

全部任务由 Codex / gpt-6-astra 执行，显式 YOLO；01 为 max，02/03 为 xhigh，协调器为 high。任务、提交与清理映射见 [integration.json](integration.json)。01、02 并行实现，性能时段串行；03 在二者合入并清理后启动。恢复次数均为 0。

| 记录 | 被验证的任务 HEAD | Bun | 协调器亲自执行的结果 |
| --- | --- | --- | --- |
| [integrate-02](integrate-02/results.json) | `0c0d78ebe4329214d358a9b4428e8dcf1451d215` | 1.4.2 | typecheck / lint / build / test（1273 pass）/ diff 全通过 |
| [integrate-01](integrate-01/results.json) | `12e6b88e41198bae922a1d6ca9c6a68cc4f40a8f` | 1.4.2 | typecheck / lint / build / test（1306 pass）/ diff 全通过 |
| [final-142](final-142/results.json) | `5c63074d5b90056724d5588755fdb39c4332153d` | 1.4.2 | 冻结安装、typecheck、lint、build、1306 tests、12 包验证、core coverage、coverage gate、docs build、diff：10/10 命令 exit 0 |
| [final-140](final-140/results.json) | `5c63074d5b90056724d5588755fdb39c4332153d` | 1.4.0 | 同上：10/10 命令 exit 0 |

两版最终全量测试均 1306 pass / 0 fail、133065 assertions；core coverage 测试均 622 pass / 0 fail，2389/2417 行 = 98.84%，90% 门槛不变。docs 构建显式 `DOCS_BASE=/zebra/`，各版构建后的 `check-docs.py` 均 exit 0；压缩的 `docs-links.jsonl.gz` 保存 134 个本地链接及六份构建产物检查和 favicon baseExceptions。此处是本地链接/产物检查，不是外部 URL 连通性或真实浏览器 E2E。

每个 `results.json` 逐条记录实际 HEAD、Bun、命令、时间、退出码与用时；相邻 `.txt.gz` 为未经内容改写的完整输出，含执行目录。原 worktree 在成功快进合并后已删除，日志中的目录仅用于追溯。最小版本通过隔离 Bun 1.4.0 目录前置 PATH，使全部子命令使用相同版本；没有修改全局 Bun。

[validation-runner.py](validation-runner.py) 为最终记录器。首次 final-142 执行在已通过前六条命令后，因记录器把 `packages/core` 用作日志文件名而触发 FileNotFoundError；coverage 命令尚未启动。修正日志路径分隔符并加入验证 HEAD/版本/已通过命令的 resume 后，从 coverage 继续，前六条结果与日志未重写。该问题来自本地记录器，不是仓库门禁失败。

性能证据由任务 agent 在独占时段完成，协调器独立审查原始数据、哈希、采用决定、同机基线与生产源码一致性；上述 docs/归档 rebase 后未重复计时。原 HTTP `bench:check` 两版各 8/8 FAIL，同机 `1418a2f` 原始基线也各 8/8 FAIL，失败输出完整保留于 [03 报告](../03/REPORT.md)，没有把性能门禁写成通过。client/contract 浏览器目标打包与 Web-only VM 冒烟证据同见 03。

每个任务在 rebase 后均只有一个提交。01 的队列 README 冲突保留双方归档/状态后解决；03 rebase 无冲突。协调器核对 01/02 完整结果未被后续任务改写，80 个生产源文件与 `1418a2f` 相同，保护的依赖/CI/基线未变。03 的 315 个证据文件通过 SHA-256 校验，完整输出保存在 `final-03-hashes.txt.gz`。

三个 todo 已归档到 `../../todos/done/`，三个本轮 agent 正常退出，workspace / worktree / 本地任务分支全部删除。仅保留原 checkout 和本轮证据；未操作其他任务资源，未 push、创建 PR、发布或部署。收尾仅新增本目录和计划/队列执行记录，不改变已验证的产品文档、源码或测试。
