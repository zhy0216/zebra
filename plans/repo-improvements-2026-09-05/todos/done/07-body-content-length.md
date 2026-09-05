difficulty: medium
agent: inherit

# 07 · 严格校验缓冲读取的 Content-Length

来源：plan.md F13。优先级：P2。一个独立 worktree，一个最终 commit。

## T1 · 使用 HTTP 数字语法而非 JavaScript 数值语法

- 要做什么：修复 http/body.ts 的 assertDeclaredSize，使空字符串、小数、指数、十六进制和带正负号的值成为 400 invalid_content_length。有效的十进制零与前导零保持可用；超大数字不发生溢出/精度截断后误放行，明显超过 limit 时在读取前返回 413。
- 预计修改文件：`packages/core/src/http/body.ts`；新增 `packages/core/test/http/content-length.test.ts`。
- 验收条件：1.5、0x10、1e1、+1、空值、负数、混入空格/字母失败；缺失 header 仍按流字节数限制；合法小值和前导零通过；极长但语法合法的十进制值超过有限上限时为 413，不分配相应大小内存。实际 bytes 超过 header 或 limit 时仍检查真实字节限制，不把 header 当作可信的内存分配大小。
- 前置依赖：无。

## T2 · 保持共享 body 读取与错误类别

- 要做什么：确认 json/text/body/form 通过共享 readBody 一致处理非法声明长度，不影响现有 multipart 400/413 与 cancel 拒绝/挂起的保护。
- 预计修改文件：同 T1，仅新增测试文件，不编辑 06 所有的 HTTP 文档。
- 验收条件：同请求多个缓冲 helper 得到一致的错误且不重复读取；合法 multipart/urlencoded/JSON 不回归；声明超限在底层 reader 获得前失败。该任务不重写 Bun 传输层，也不将发现描述成已经证明的网络请求走私。
- 前置依赖：本文件 T1；外部依赖无。

## 校验与交付

运行 `bun test packages/core/test/http packages/core/test/contract/body-read-composition.test.ts`、`bun run typecheck`、`bun run lint`、`git diff --check`。保持 body helper 的公共签名、流互斥与原始错误政策。

## 完成记录 · 串行集成

- 状态：T1、T2 已完成，验收通过；在协调器持有集成锁并授权后归档，待协调器仓库级校验与合并。
- 执行 agent / model / effort：`codex` / `gpt-6-astra` / `xhigh`。
- 集成基线：已 rebase 到 `c96f0cbea26e00ca8f2c6c0554adb7b18c6be828`，无冲突；本任务实现无需额外修复。
- 实现文件：`packages/core/src/http/body.ts`、`packages/core/test/http/content-length.test.ts`；公共签名、流互斥和原始错误政策保持不变。

### 验收证据

- T1：空值、小数、指数、十六进制、正负号及混入空白或字母的声明返回 `400 invalid_content_length`；零、小值及两万个前导零通过。超大十进制值、`2 ** 53` 附近及 `Number.MAX_VALUE` 附近的精度边界返回 `413 payload_too_large`，测试确认获取 reader 次数为零。
- T1：缺失或低报声明长度时仍累计真实流字节；两段 UTF-8 数据合计 6 字节，在 4 字节上限失败、6 字节上限通过。合法大声明仅缓冲实际的 3 字节，不按声明长度分配内存。
- T2：JSON、urlencoded、multipart 和二进制请求中的四个缓冲 helper 复用同一声明错误，重复调用不获取 reader；合法 JSON、urlencoded、multipart 保持一次读取。既有 multipart 400/413、取消拒绝/挂起保护、流互斥、原始错误与契约组合测试全部通过。
- 验证范围是应用层缓冲读取，没有据此推断 Bun 网络传输层请求走私。

### Rebase 后校验

| 命令 | 结果 |
| --- | --- |
| `bun install --frozen-lockfile` | exit 0；当前 worktree 独立依赖，无变更 |
| `bun test packages/core/test/http packages/core/test/contract/body-read-composition.test.ts` | exit 0；132 pass / 0 fail，721 expect()，8 files；含本任务新增 34 tests |
| `bun run typecheck` | exit 0 |
| `bun run lint` | exit 0；253 files，No fixes applied |
| `git diff --check`、`git diff master..HEAD --check` | exit 0 |

本 todo 未运行 audit 或 benchmark；仓库级验证与空闲窗口性能门禁由协调器执行。无剩余 blocker。
