difficulty: medium

# 统一缓冲型请求体读取

优先级：P1

来源：plan.md F04

执行模型：flash

前置依赖：无

## T1 · 让 body/json/text/form 共用一次受限读取

要做什么：修复 request.ts 中 body() 直接 parseBody(raw) 而其他 helper 独立 bytes() 的双消费链。将内容类型解析和 JSON/text/form 解析建立在同一次受限字节读取上，memoize pending read 与结果；保留 parseBody 公共签名、multipart 数量/单文件限制以及 contract 对 req.body 的验证后替换语义。不要把 stream 自动缓冲。

预计修改文件（本任务共享范围）：

- `packages/core/src/http/request.ts`
- `packages/core/src/http/body.ts`
- `packages/core/test/http/request-helpers.test.ts`
- `packages/core/test/http/body.test.ts`
- `packages/core/test/contract/body-read-composition.test.ts（新增）`

验收条件：JSON 的 text→body、body→json、并发 body/json/text 均保留内容；urlencoded、multipart 混用正确且只读一次原始流；413/400 和文件限制不回归；middleware 读取文本后 app.implement body 校验仍成功。stream 与其他读取互斥时行为明确，不能静默返回假空体。

前置依赖：无。

## 校验

```sh
bun test packages/core/test/http packages/core/test/contract packages/core/test/fuzz/body.test.ts
bun run typecheck
bun run lint
bun test packages/core
```

按 plan 的公共约束保留 v1 API 与现有正常路径。只改本任务拥有的文件；需要扩大范围时先协调依赖。
