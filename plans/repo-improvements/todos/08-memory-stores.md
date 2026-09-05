difficulty: medium

# 有界回收全部过期内存项

优先级：P1

来源：plan.md F12、F13

执行模型：flash

前置依赖：无

## T1 · 避免 sweep 永远重复头部

要做什么：两个MemoryStore都将每次最多512次扫描改为最终覆盖整张Map的增量方式，处理删除、插入、空表和回绕；仍保持单次扫描上限，避免一次请求全表扫描。

预计修改文件（本任务共享范围）：

- `packages/session/src/store.ts`
- `packages/rate-limit/src/store.ts`
- `packages/session/test/store.test.ts`
- `packages/rate-limit/test/store.test.ts`

验收条件：超过512条且头部长TTL持续存活时，过期尾部在有界次数后被清除；模拟时钟与插入/删除交错下无永久遗漏；正常lookup/counter逻辑不变。

前置依赖：无。

## T2 · 目标过期检查不依赖 sweep 命中

要做什么：session touch先确认目标是否已过期，过期按missing处理，不能续活；set遇到过期tombstone应按已过期处理。保持未过期tombstone防复活和销毁语义。

预计修改文件（本任务共享范围）：

- `packages/session/src/store.ts`
- `packages/rate-limit/src/store.ts`
- `packages/session/test/store.test.ts`
- `packages/rate-limit/test/store.test.ts`

验收条件：512长寿命项后第513项过期，touch后仍不存在；过期tombstone不因Map顺序阻止新set；未过期tombstone仍阻止复活。

前置依赖：无；与本文件前面条目一起完成、一起提交。

## 校验

```sh
bun test packages/session/test/store.test.ts packages/rate-limit/test/store.test.ts
bun run typecheck
bun run lint
bun test packages/session packages/rate-limit
```

按 plan 的公共约束保留 v1 API 与现有正常路径。只改本任务拥有的文件；需要扩大范围时先协调依赖。
