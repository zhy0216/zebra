difficulty: medium

# 更新 MCP 间接依赖的安全修补版本

优先级：P1

来源：plan.md F01

执行模型：flash

前置依赖：无

## T1 · 修补 fast-uri / qs 并确认依赖范围

要做什么：使用官方 registry 重新核对 audit：当前 fast-uri 3.1.5 与 qs 6.15.3 分别有 4 条和 2 条 advisory。在现有上游 semver 范围内更新到修补版本（本次审计对应 3.1.6 / 6.16.0），仅保留必要 lock 变化。不要执行跨范围的 audit fix --latest，不调整 VitePress / Vite / esbuild；它们属于 R01。若工具顺带升级了文档依赖，恢复这些无关变更。

预计修改文件（本任务共享范围）：

- `bun.lock`

验收条件：fast-uri/qs 的 6 条 advisory 消失；MCP、schema、client 行为和12包打包检查通过；冻结安装成功。audit 若仅剩 R01 的4条开发工具链告警，应原样记录而非标为全绿。不新增或修改 package.json / 公共接口；无可兼容修补时明确证据，不强行 overrides。

前置依赖：无。

## 校验

```sh
bun install --frozen-lockfile
bun test packages/mcp packages/schema-zod packages/client
bun run typecheck
bun run lint
bun run build
bun run verify:packages
bun audit --registry https://registry.npmjs.org
```

按 plan 的公共约束保留 v1 API 与现有正常路径。只改本任务拥有的文件；需要扩大范围时先协调依赖。
