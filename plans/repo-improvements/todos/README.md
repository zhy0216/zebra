# repo-improvements 任务队列

来源：[plan.md](../plan.md)。35 个发现合并为 21 个任务；R01–R03 roadmap 不在此队列。

## 优先级

| 文件 | 优先级 | 难度 | 模型 | 说明 |
| --- | --- | --- | --- | --- |
| [01-runtime-dependencies.md](01-runtime-dependencies.md) | P1 | medium | flash | 更新 MCP 间接依赖的安全修补版本（F01） |
| [02-release-preflight.md](02-release-preflight.md) | P1 | hard | max | 发布脚本的前置校验与失败隔离（F02、F03） |
| [03-request-body.md](03-request-body.md) | P1 | medium | flash | 统一缓冲型请求体读取（F04） |
| [04-disposal.md](04-disposal.md) | P1 | hard | max | 清理失败时释放全部资源（F05） |
| [05-listen-concurrency.md](05-listen-concurrency.md) | P1 | hard | max | 防止并发启动遗失服务器（F06） |
| [06-static-http.md](06-static-http.md) | P1 | medium | flash | 静态资源条件请求与缓存隔离（F07、F08、F09） |
| [07-session-concurrency.md](07-session-concurrency.md) | P1 | hard | max | 消除 session lazy load 与 flush 的丢更新（F10、F11） |
| [08-memory-stores.md](08-memory-stores.md) | P1 | medium | flash | 有界回收全部过期内存项（F12、F13） |
| [09-client-request.md](09-client-request.md) | P1 | medium | flash | 修复客户端 headers 与 URL 构造（F14、F15、F16） |
| [10-mcp-bridge.md](10-mcp-bridge.md) | P1 | hard | max | 保持 MCP 工具声明与真实调用一致（F17、F18、F19、F20、F21） |
| [11-schema-intersections.md](11-schema-intersections.md) | P1 | hard | max | 生成可满足的 Zod intersection JSON Schema（F22） |
| [12-router-allow.md](12-router-allow.md) | P2 | medium | flash | 补全重叠路由的 Allow 方法（F23） |
| [13-rate-limit-options.md](13-rate-limit-options.md) | P2 | medium | flash | 拒绝非有限限流配置（F24） |
| [14-cors-vary.md](14-cors-vary.md) | P2 | medium | flash | 为 CORS 缓存变体提供完整 Vary（F25） |
| [15-observability.md](15-observability.md) | P2 | medium | flash | 修正指标分位数、容量与健康方法匹配（F26、F27、F28） |
| [16-forum-uniqueness.md](16-forum-uniqueness.md) | P2 | hard | max | 保证并发注册的用户名唯一性（F29） |
| [17-coverage-gate.md](17-coverage-gate.md) | P2 | medium | flash | 校验 coverage 门禁输入并限定统计范围（F30、F31） |
| [18-package-verification.md](18-package-verification.md) | P2 | medium | flash | 打包校验失败也清理临时项目（F32） |
| [19-benchmark-gate.md](19-benchmark-gate.md) | P2 | medium | flash | 让 benchmark 检查拒绝无效基线（F33） |
| [20-validation-scope.md](20-validation-scope.md) | P2 | medium | flash | 让仓库类型检查覆盖示例与工具脚本（F34） |
| [21-docs-inventory.md](21-docs-inventory.md) | P2 | easy | flash | 同步包清单、项目状态与贡献说明（F35） |

## 文件

1. [01-runtime-dependencies.md](01-runtime-dependencies.md) — medium → flash；依赖：无。
2. [02-release-preflight.md](02-release-preflight.md) — hard → max；依赖：无。
3. [03-request-body.md](03-request-body.md) — medium → flash；依赖：无。
4. [04-disposal.md](04-disposal.md) — hard → max；依赖：无。
5. [05-listen-concurrency.md](05-listen-concurrency.md) — hard → max；依赖 04-disposal。
6. [06-static-http.md](06-static-http.md) — medium → flash；依赖：无。
7. [07-session-concurrency.md](07-session-concurrency.md) — hard → max；依赖：无。
8. [08-memory-stores.md](08-memory-stores.md) — medium → flash；依赖：无。
9. [09-client-request.md](09-client-request.md) — medium → flash；依赖：无。
10. [10-mcp-bridge.md](10-mcp-bridge.md) — hard → max；依赖：无。
11. [11-schema-intersections.md](11-schema-intersections.md) — hard → max；依赖：无。
12. [12-router-allow.md](12-router-allow.md) — medium → flash；依赖：无。
13. [13-rate-limit-options.md](13-rate-limit-options.md) — medium → flash；依赖 08-memory-stores。
14. [14-cors-vary.md](14-cors-vary.md) — medium → flash；依赖：无。
15. [15-observability.md](15-observability.md) — medium → flash；依赖：无。
16. [16-forum-uniqueness.md](16-forum-uniqueness.md) — hard → max；依赖：无。
17. [17-coverage-gate.md](17-coverage-gate.md) — medium → flash；依赖：无。
18. [18-package-verification.md](18-package-verification.md) — medium → flash；依赖：无。
19. [19-benchmark-gate.md](19-benchmark-gate.md) — medium → flash；依赖：无。
20. [20-validation-scope.md](20-validation-scope.md) — medium → flash；依赖 02-release-preflight、17-coverage-gate、18-package-verification、19-benchmark-gate。
21. [21-docs-inventory.md](21-docs-inventory.md) — easy → flash；依赖 20-validation-scope。

## 依赖与并行

- 05-listen-concurrency 依赖 04-disposal。
- 13-rate-limit-options 依赖 08-memory-stores。
- 20-validation-scope 依赖 02-release-preflight。
- 20-validation-scope 依赖 17-coverage-gate。
- 20-validation-scope 依赖 18-package-verification。
- 20-validation-scope 依赖 19-benchmark-gate。
- 21-docs-inventory 依赖 20-validation-scope。

有序列表决定扫描优先级，不要求所有任务串行。最多 5 个 worktree；优先调度 P1，遇到依赖未满足就继续扫描无依赖任务。04/05、08/13 的依赖同时约束文件写入冲突。20 待脚本任务合并后补全类型检查，21 最后校正文档。

初始可以并行 01、02、03、04、06；完成后按列表选择其他就绪任务。09、10、11 分属 client / mcp / schema-zod，业务实现可并行；11独占新增mcp/test/schema-intersection.test.ts，10只改其mcp.test.ts和transport.test.ts，不共享新helper或改根依赖。任何新增共享文件先协调/更新依赖，不能并行改同一文件。

模型由 difficulty 决定：easy / medium → flash；hard → max。执行 orchestrator 按 auto-dev 使用 flash 启动，具体任务由 herdr-finish-plan 选模型。

## 共同要求

- 一个 todo 文件 = 一个 worktree = 一个最终 commit；先读对应 plan 发现和 docs/api-freeze.md。
- 新测试路径明确标记“新增”；无需创建其他任务未要求的公共抽象。
- 本轮不执行 roadmap，不发布 npm、不push、不部署、不更新真实benchmark基线。
- release脚本测试只在临时repo/命令替身中执行，不能对工作仓库调用真实release写入模式。
- 各文件列出独立校验命令；最终合并态运行 plan 中完整校验集。
- audit允许仅剩R01已记录的开发工具链告警；F01的6条必须消失，不能把残留告警写成全绿。
