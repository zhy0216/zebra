difficulty: easy

# 同步包清单、项目状态与贡献说明

优先级：P2

来源：plan.md F35

执行模型：flash

前置依赖：[20-validation-scope.md](20-validation-scope.md)

## T1 · 以当前代码与工作流校正文档

要做什么：从12个package manifest和packages/zebra/src/index.ts核对包表与facade描述，补上遗漏的observability/redis/mcp/schema-zod等；更新README仍写C2–C4待做的陈旧状态，准确描述已有docs/bench/release工作流，不声称未经验证的npm远端发布。同步英文/中文索引，修正CONTRIBUTING的no semicolons和typecheck范围描述。

预计修改文件（本任务共享范围）：

- `README.md`
- `llms.txt`
- `CONTRIBUTING.md`
- `docs/README.md`
- `docs/zh/README.md`

验收条件：包清单与12个发布包一致；facade exports准确；贡献指南命令与20的实现一致；双语文档内部链接可构建，风格声明与biome相符。无需为文案新增自动化测试。

前置依赖：[20-validation-scope.md](20-validation-scope.md)。

## 校验

```sh
bun run docs:build
bun run lint
bun run typecheck
```

按 plan 的公共约束保留 v1 API 与现有正常路径。只改本任务拥有的文件；需要扩大范围时先协调依赖。
