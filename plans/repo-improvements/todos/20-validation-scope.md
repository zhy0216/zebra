difficulty: medium

# 让仓库类型检查覆盖示例与工具脚本

优先级：P2

来源：plan.md F34

执行模型：flash

前置依赖：[02-release-preflight.md](02-release-preflight.md)、[17-coverage-gate.md](17-coverage-gate.md)、[18-package-verification.md](18-package-verification.md)、[19-benchmark-gate.md](19-benchmark-gate.md)

## T1 · 建立完整且可验证的 typecheck 入口

要做什么：基于现有tsgo和strict配置，让bun run typecheck覆盖12包src/test、examples的src/test/client-demo，以及scripts/bench与新增脚本测试。可用root配置和独立tools配置组合，避免跳过workspace无脚本目录；保留已有包局部命令与类型断言。不要关闭strict/扩大any/忽略文件来通过。若新纳入脚本报错，在对应已合并任务代码上做最小类型修复并明确文件范围。

预计修改文件（本任务共享范围）：

- `package.json`
- `tsconfig.json`
- `tsconfig.tools.json（仅有必要时新增）`

验收条件：检查编译文件列表能证明所有上述目录被包含；在隔离副本给example及script各注入类型错误均使根命令失败，移除后成功；现有@ts-expect-error类型测试依然生效；CI既有bun run typecheck无需额外人工步骤即可覆盖全部。无需添加测试镜像脚本列表，可用一次性负向验证。

前置依赖：[02-release-preflight.md](02-release-preflight.md)、[17-coverage-gate.md](17-coverage-gate.md)、[18-package-verification.md](18-package-verification.md)、[19-benchmark-gate.md](19-benchmark-gate.md)。

## 校验

```sh
bun run typecheck
bun run lint
bun run build
bun test
```

与所有脚本结构任务有显式依赖；若需修改其他仍在执行任务拥有的源文件，先等待其合并，不并发覆盖。根package.json的校验入口由本任务负责，不涉及依赖版本或bun.lock。
