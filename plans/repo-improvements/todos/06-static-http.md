difficulty: medium

# 静态资源条件请求与缓存隔离

优先级：P1

来源：plan.md F07、F08、F09

执行模型：flash

前置依赖：无

## T1 · If-Range 和 If-None-Match

要做什么：按 RFC9110 实现 If-Range：不匹配或无效条件忽略 Range 并发送完整200；弱ETag不能强匹配，日期按规范处理。If-None-Match 使用弱比较，覆盖强/弱等价标签、列表和*。保留现有416、HEAD、ETag、Content-Range语义。

预计修改文件（本任务共享范围）：

- `packages/core/src/http/static.ts`
- `packages/core/test/http/static.test.ts`
- `packages/core/test/app/static.test.ts`
- `packages/core/test/fuzz/range.test.ts`

验收条件：Range bytes=0-1 加过期If-Range返回完整200；没有If-Range的有效Range仍206；有效/无效日期、弱标签有回归；等价强/弱If-None-Match返回304；不匹配仍200。参考 plan 中RFC链接。

前置依赖：无。

## T2 · 隔离不同 index 的热缓存

要做什么：缓存key必须反映最终资源或决定资源的配置，不能仅按目录路径缓存。复用现有 fixtures/static 的 index.html 与 hello.txt 验证冷/热路径。

预计修改文件（本任务共享范围）：

- `packages/core/src/http/static.ts`
- `packages/core/test/http/static.test.ts`
- `packages/core/test/app/static.test.ts`
- `packages/core/test/fuzz/range.test.ts`

验收条件：同root、requested=static，先index.html再hello.txt，第二次内容与MIME正确；相反顺序也正确；路径穿越、symlink、dotfile与缓存过期测试继续通过。

前置依赖：无；与本文件前面条目一起完成、一起提交。

## 校验

```sh
bun test packages/core/test/http/static.test.ts packages/core/test/app/static.test.ts packages/core/test/fuzz/range.test.ts packages/core/test/fuzz/path.test.ts
bun run typecheck
bun run lint
bun test packages/core
```

按 plan 的公共约束保留 v1 API 与现有正常路径。只改本任务拥有的文件；需要扩大范围时先协调依赖。
