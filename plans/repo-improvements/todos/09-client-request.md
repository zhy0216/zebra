difficulty: medium

# 修复客户端 headers 与 URL 构造

优先级：P1

来源：plan.md F14、F15、F16

执行模型：flash

前置依赖：无

## T1 · 大小写无关覆盖 headers，并从原始模板构造路径

要做什么：用Headers合并默认和单次调用配置，调用配置大小写无关覆盖；只有不存在content-type时才自动设置。原始path模板一次插值，不能把id=*foo再解释成wildcard。正确连接baseUrl尾斜杠和/api前缀，保留已有参数/query/body编码。保持client零运行时依赖，不导入core/MCP工具。

预计修改文件（本任务共享范围）：

- `packages/client/src/client.ts`
- `packages/client/test/client.test.ts`

验收条件：Authorization覆盖为单个新值；已有Content-Type不追加；FormData/Blob/JSON原测试不回归；id=*foo正常发送并还原；/:id/*rest、缺参及特殊字符正确；baseUrl有/无尾斜杠和路径前缀都无意外双斜杠。

前置依赖：无。

## 校验

```sh
bun test packages/client packages/testing/test/test-client.test.ts
bun run typecheck
bun run lint
bun run build
```

按 plan 的公共约束保留 v1 API 与现有正常路径。只改本任务拥有的文件；需要扩大范围时先协调依赖。
