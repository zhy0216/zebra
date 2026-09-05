# Repository improvements · 2026-09-05

## 意图

用户仅调用 `$auto-dev`，未指定功能需求，因此采用仓库探索模式：检查 Zebra 的现有实现与仓库校验，记录全部已确认改进点，将可保持 v1 API 兼容的修复拆成任务并交给 Herdr 执行。仓库是 Bun-first TypeScript monorepo，当前分支 `master`，分析基线 `eb94a2a`，12 个发布包均为 1.0.0。基础校验全部成功，但额外最小复现暴露请求体、生命周期、session、HTTP、MCP 和工程工具边界问题；通过测试不代表这些边界已有覆盖。

本次只提交本计划及 `todos/`；业务实现由新 OpenCode session 的 `$herdr-finish-plan repo-improvements` 完成。

## 目标 / 非目标

目标：

- 修复下表 F01–F35 的已确认问题，并为行为缺陷增加有意义的回归测试。
- 保持 `docs/api-freeze.md` 定义的 v1 API、Bun 1.4.0 最低要求、src-direct 发布策略及包之间的现有依赖边界。
- 补齐脚本、示例、benchmark 的验证入口，更新失真的项目介绍。
- 为依赖升级、Redis 持久化兼容问题保留清晰 roadmap，避免把 API / 数据迁移混入常规修复。

非目标：

- 当前 session 不实现业务代码；不发布 npm、不 push、不部署文档，不自动升级项目发布版本。
- R01–R03 仅进入 roadmap，不生成执行 todo。
- 不创建或重建 zvec-grep 持久索引。首次语义检索返回 `INDEX_MISSING`，随后使用已知文件名、配置键和函数名的 `rg` 检索与针对性源码读取。
- 不把已有明确测试的行为（例如未绑定 WS upgrade 依赖在请求期返回 500）误判为待改 API。
- 不以机器差异更新 `bench/baseline.json`。

## 仓库与校验基线

核心目录：

- `packages/core/src/{app,di,http,router,ws,contract}`：服务启动/停止、scope、路由、HTTP、WebSocket 和契约执行。
- `packages/{session,rate-limit,cors,redis,observability}`：中间件与存储。
- `packages/{contract,client,mcp,schema-zod,testing,zebra}`：契约、客户端、MCP、schema 转换、测试入口及 facade。
- `scripts/{release,verify-packages,check-coverage}.ts`、`bench/`、`.github/workflows/`：发布和验证。
- `examples/`、`docs/`、`llms.txt`：示例与双语文档。

2026-09-05 本地 Bun `1.4.0 (34cbb9a40)`：

| 命令 | 结果 |
| --- | --- |
| `bun run typecheck` | 12 个 package 全部成功；现有命令未覆盖 examples / scripts / bench，见 F34 |
| `bun x tsgo --noEmit -p tsconfig.json` | 成功；额外验证了 root 配置包含的 examples |
| `bun run lint` | `Checked 239 files in 1999ms. No fixes applied.` |
| `bun run build` | 12 个 package 全部成功 |
| `bun test` | `665 pass / 0 fail / 12658 expect() calls`，95 文件，7.92s |
| `bun run verify:packages` | 12 个 tarball 内容、干净安装、运行时 imports、安装后 types 全部成功 |
| `bun run docs:build` | 成功，3.60s |
| `bun test --coverage --coverage-reporter=lcov packages/core` + `bun run check:coverage` | `2307/2422 lines covered (95.25%), threshold 90%`；此值包含非 core/src 记录，见 F31 |
| `bun audit` | 失败，镜像证书校验错误，原文见附录 |
| `bun audit --registry https://registry.npmjs.org` | 失败，10 条 advisory：5 high、5 moderate |
| `bun audit fix --dry-run --registry https://registry.npmjs.org` | 确认 fast-uri / qs 可在现有范围修补；Vite / esbuild 受 VitePress 依赖范围阻挡，见 R01 |

`bench:check` 未在探索阶段运行：CI 已明确说明 baseline 绑定指定 Apple Silicon 硬件；本计划不从代码审查推断吞吐提升。涉及热路径的实现任务应运行本地 gate，保留原始结果并区分机器差异，禁止为通过而刷新 baseline。

测试中以下诊断来自已有的故障注入测试，不算失败：

```text
2026-09-05T11:30:43.024Z WARN [Better Auth]: Invalid password
[zebra/accessLog] writer threw:
error: writer exploded
[zebra/errorReporter] reporter threw:
error: reporter exploded
[zebra/health] probe threw:
error: db down
```

## 方案

### 执行原则

每个 todo 对应一个 worktree 和一个最终 commit；同一文件的相关缺陷合并，文件重叠的任务显式串行。默认只修复已损坏的输入组合和失败路径，不重构整个框架。并发相关任务使用可控 promise / 屏障和真实 transport 或服务器复现，避免以 sleep 概率测试代替确定性验证。

公共签名不收紧、不删除现有 exports，不把 EVAL 变成 `RedisLike` 的必选成员。Redis 数据布局调整需要兼容读取/迁移设计，连同原子性问题列入 R02。

所有脚本测试必须在专属临时仓库或注入的命令执行器中验证，不能对当前仓库做 release commit、tag、publish 或改写 baseline。模拟失败应保留可诊断的 stderr、失败退出码和资源清理。

### 核心设计方向

- HTTP 缓冲型 body API 共享一次有大小限制的原始读取；stream 维持清晰的单次消费边界。
- 清理阶段尽力完成全部资源释放后报告失败；启动/停止持有明确状态，不能遗失 server。
- session 首次加载共享 pending promise；持久化使用 revision 或等价机制避免异步 flush 吞掉新修改。
- 有界 Map 扫描必须最终覆盖所有条目；访问具体目标时独立检查 expiry。
- client / MCP 分别修复 Headers 合并和模板插值，保留包的零依赖/既有依赖策略。
- MCP 使用真实 SDK transport 验证 cancellation，schema 转换通过实际 validator 验证，而非只比较 JSON 形状。
- 工程脚本从输入、失败退出、清理和校验覆盖范围四方面补齐。

## 拆解：完整发现清单

行号为分析基线定位，执行时按符号查找。

| ID | 位置与证据 | 改进建议 | 优先级 | 难度 | 任务 / 依赖 |
| --- | --- | --- | --- | --- | --- |
| F01 | `bun.lock:618,750`：fast-uri 3.1.5、qs 6.15.3，经 MCP SDK 间接引入；官方 audit 报 6 条 advisory | 在现有上游范围内更新锁定版本并验证 MCP 与打包；不能把依赖命中表述为 Zebra 已被证实可利用 | P1 | medium | 01，无 |
| F02 | `scripts/release.ts:348-390`：写文件/发布前无 dirty-tree 和 tag 冲突检查，最后 `git add -A`；命令失败检查在 commit 后合并判断 | 写入前检查工作区、tag 与参数；限定暂存范围，每个子命令失败立即停止，保留诊断；用隔离临时 repo 测试 | P1 | hard | 02，无 |
| F03 | `scripts/release.ts:8,83`：正则接受 `01.2.3`、`1.2.3-..`、`1.2.3-01` | 严格校验 SemVer 和 CLI 值，非法版本在写入前失败 | P2 | medium | 合入 02 |
| F04 | `core/src/http/request.ts:147,190`：`text()→body()`、`body()→json()` 对非空 JSON 第二次均得 null | 共享受限字节缓冲；覆盖顺序、并发、multipart 和 middleware→contract 组合 | P1 | medium | 03，无 |
| F05 | `core/src/di/container.ts:119`、`app/scope-registry.ts:110`、`app/internals.ts:272`：B.dispose 抛错后重复 dispose 调用记录为 [B,B]，A 从未释放 | 清理异常隔离、缓存/计时器移除和重复/并发 dispose 幂等；所有 shutdown 阶段最终执行 | P1 | hard | 04，无 |
| F06 | `core/src/app/app.ts:160`：并发 listen 两次均成功且端口不同，stop 后首个端口仍返回 200 | 启动互斥及 stop/listen 协调；测试 boot 等待、ready 失败和 server 回收 | P1 | hard | 05，依赖 04 |
| F07 | `core/src/http/static.ts:144`：Range 搭配过期 If-Range 仍返回 206 | 实现正确的 If-Range 判断；不匹配时完整 200，弱 ETag 不可强匹配 | P1 | medium | 06，无 |
| F08 | `core/src/http/static.ts:208,230,278`：同目录先 index.html 再 hello.txt，第二次仍返回 HTML | 缓存按最终资源或完整配置隔离；冷/热路径一致 | P2 | medium | 合入 06 |
| F09 | `core/src/http/static.ts:120`：If-None-Match 的强/弱等价标签未匹配 | 按弱比较处理候选标签、列表和通配符 | P2 | easy | 合入 06 |
| F10 | `session/src/session.ts:71-79`：首次并发 set(a)、set(b) 两次 get，最后仅 b 保留 | 首次 lazy load 共享 promise；并发修改都应用到同一 data | P1 | hard | 07，无 |
| F11 | `session/src/session.ts:102-105`：flush(a) 等待时 set(b)，落盘只有 a，却 dirty=false | revision / 串行 flush 防止丢更新；失败可重试，destroy 语义保留 | P1 | hard | 合入 07 |
| F12 | `session/src/store.ts:102`、`rate-limit/src/store.ts:106`：扫描一直从前 512 项开始，前 512 项持续存活时尾部无法被 sweep 回收；持续续期可导致长期滞留 | 有界增量游标或轮转扫描，覆盖 >512 项与删除/新增场景 | P2 | medium | 08，无 |
| F13 | `session/src/store.ts:82-87`：未被 sweep 到的过期第 513 项经 touch 复活；过期 tombstone 仍阻止 set | 目标 expiry 检查独立于 sweep，过期会话视为 missing | P1 | medium | 合入 08 |
| F14 | `client/src/client.ts:66,74`：大小写不同的 Authorization 合并成 `Bearer old, Bearer new`；Content-Type 也被追加 | 使用 Headers.set/has 合并和覆盖 | P1 | medium | 09，无 |
| F15 | `client/src/client.ts:5`：/x/:id 输入 id=*foo，插入值被再次当成 wildcard，抛 Missing required path parameter | 一次扫描原始模板，插入值不再解析 | P2 | medium | 合入 09 |
| F16 | `client/src/client.ts:56`：baseUrl 尾斜杠 + /x 产生 //x | 规范化连接边界，保留 /api 前缀和编码 | P2 | easy | 合入 09 |
| F17 | `mcp/src/bridge.ts:47,51`：与 F14 相同的 Headers 大小写合并缺陷 | 在 MCP bridge 独立修复并回归认证上下文传播 | P1 | medium | 10，无 |
| F18 | `mcp/src/bridge.ts:12`：与 F15 相同的插入值二次解析缺陷 | 对原始模板一次插值，保留 wildcard 行为 | P2 | medium | 合入 10 |
| F19 | `mcp/src/manifest.ts:98,109`：string body 的工具 schema 不要求 body，但省略调用返回 422 | 内部 JSON Schema 形态判断覆盖 scalar/array/anyOf/allOf/object，保留合法可选 query；不改公共接口、不调用 schema.validate 推断 | P2 | medium | 合入 10 |
| F20 | `mcp/src/adapter.ts:142`：SDK handler 忽略 extra.signal；真实 InMemoryTransport 取消后 req.signal.aborted=false | 传递 SDK signal，测试真实 tools/call→cancelled 链路 | P2 | hard | 合入 10 |
| F21 | `mcp/src/manifest.ts:29,40`、`adapter.ts:113`：同名工具列出两项却永远调用第一个 | 创建时校验全局唯一名，错误包含冲突路径 | P2 | easy | 合入 10 |
| F22 | `schema-zod/src/index.ts:73,81`：intersection 的 allOf 分支被逐一封闭，Zod 接受 {a,b} 而 SDK Ajv 拒绝 | 理解 allOf 的闭合语义，保留 ordinary object/record/union；用实际 validator 验证 | P1 | hard | 11，无 |
| F23 | `core/src/router/radix.ts:69`：GET /users/me + POST /users/:id，POST 实际可命中但 Allow 仅 GET | 汇总全部匹配分支并去重，保持正常路由优先级 | P2 | medium | 12，无 |
| F24 | `rate-limit/src/limiter.ts:49`、`middleware.ts:113`：NaN / Infinity 被接受，出现 allowed=true、resetAt=NaN | 入口与直接 store/checkLimit API 的有限数校验一致，非法配置在写 store 前失败 | P2 | medium | 13，依赖 08 |
| F25 | `cors/src/cors.ts:59,76`：denied/absent Origin 变体无 Vary；动态反射预检请求头无对应 Vary | 所有动态 Origin 变体及动态请求头反射正确声明 Vary，保留已有字段 | P2 | medium | 14，无 |
| F26 | `observability/src/metrics.ts:38`：宣称 nearest-rank，样本 1..11 的 P95 却为 10 | 正确 ceil rank，确定性测试空/小样本/P50/P95 | P2 | easy | 15，无 |
| F27 | `observability/src/metrics.ts:50,79`：NaN sample 上限后 1100 请求保留 1100 样本 | 校验有限整数容量并维持 bounded window | P2 | easy | 合入 15 |
| F28 | `observability/src/health.ts:42,54`：只匹配 path，POST /healthz 也被吞掉 | 保持 GET 探针，明确 HEAD，其他方法透传到业务路由 | P2 | easy | 合入 15 |
| F29 | `examples/forum/src/services.ts:83,175`：同名 register 在 hash await 后都成功，生成两个 id | 同步 store 插入时实施最终唯一性约束，失败保留既有 409 username_taken | P2 | hard | 16，无 |
| F30 | `scripts/check-coverage.ts:20,58`：COVERAGE_THRESHOLD=banana 输出 threshold NaN% 后 OK | 阈值必须为合法有限范围，非法配置失败；校验坏 LCOV 计数 | P2 | medium | 17，无 |
| F31 | `scripts/check-coverage.ts:40` / CI coverage：声称 core gate，实际加总 contract/src 和 core/test/fuzz/prng.ts | 明确并落实 core/src 范围，按 SF 过滤和验证记录，报告真实分母 | P2 | medium | 合入 17 |
| F32 | `scripts/verify-packages.ts:49,90,271`：try 中 fail 调用 process.exit，绕过 finally 删除临时目录 | 最外层设置退出码，内部 throw，成功/失败均清理，保留原错误 | P2 | medium | 18，无 |
| F33 | `bench/bench-regression.ts:46,51,66`：缺失场景 baseline 被当新基线跳过后仍报成功，数值输入未前置校验 | check 模式拒绝缺失/非法数据，只有显式 --update 可写 baseline；补纯比较测试 | P2 | medium | 19，无 |
| F34 | `package.json:16`、`examples/*/package.json`、`tsconfig.json`：workspace typecheck 仅执行12包；examples无脚本，scripts/bench未包含 | CI 使用能覆盖 packages/examples/scripts/bench 的稳定 typecheck 入口，基于已有 tsgo 配置扩展 | P2 | medium | 20，依赖 02、17、18、19 |
| F35 | `README.md`、`llms.txt`、`docs/{,zh/}README.md`、`CONTRIBUTING.md`：package表未反映12包，README仍写 C2–C4 待做，no semicolons 与 Biome/现状相反 | 以 manifest、facade exports、现有 workflow 校正清单/状态/命令/风格，不声称未验证的远端发布状态 | P2 | easy | 21，依赖 20 |

### Roadmap（不进队列）

| ID | 位置与证据 | 后续方向 | 优先级 | 难度 |
| --- | --- | --- | --- | --- |
| R01 | `package.json` 的 VitePress 1.6.4；`bun.lock:586,846,848` 的 esbuild 0.21.5 / Vite 5.4.21，共 4 条 dev-tool advisory；dry-run 明确受上游依赖范围限制 | 单独评估兼容的文档工具链迁移，验证插件/主题/双语/Pages，不在本轮强制覆盖不兼容的 Vite 主版本。升级完成后再建立无这些遗留 advisory 的审计门禁 | P1 | hard |
| R02 | `redis/src/rate-limit-store.ts:50-80`、`session-store.ts:53-94`、`redis-like.ts`：①owner SET count=1 暂停后5次 increment，恢复后下一 count=2 而非7；②TTL=100，t=10 destroy，t=20旧set完成，t=111旧认证数据复现；③a 与 a:start / a:tomb 互相破坏内部元数据 | 统一设计兼容原子能力、版本化无歧义 key 布局和迁移；不能直接要求所有现有 RedisLike 实现提供 EVAL。分别验证不丢计数、销毁后旧写永不可见、业务key与元数据隔离，加入受控命令交错和真实Redis集成测试。当前安全保证存在缺口，需要独立设计，不作为可无迁移直接修复处理 | P1 | hard |
| R03 | `biome.json:5-25`：decorators.ts 与多份 DI/lifecycle tests 完全忽略 lint/format | 单独评估对装饰器语法可用的 lint 工具/版本或更窄忽略规则，再消除整文件盲区；不混入功能修复的大面积格式变更 | P2 | hard |

R02 内各问题的原始优先级：计数覆盖 P1/hard、destroy 后复活 P1/hard、limiter key 冲突 P1/medium、session key 冲突 P2/medium。统一设计涉及持久化布局和 API 兼容，整体提升为 hard。

### 顺序与并行

完整顺序：01 → 02 → … → 21，按 README 有序列表调度；箭头不表示所有任务串行。唯一强依赖：

- 04 → 05：共同涉及 `app/internals.ts` 和生命周期清理测试。
- 08 → 13：共同涉及 `rate-limit/src/store.ts`。
- 02、17、18、19 → 20：先确定新增脚本/测试结构，再补全 typecheck。
- 20 → 21：文档记录最终校验入口。

其余文件互不重叠的任务可并行。最多 5 个执行 worktree，优先 P1；不能并行两项会修改同一文件的任务。所有与 static.ts 有关的发现已并入 06，MCP 三文件集中在 10，session handle 集中在 07。实现中若新增共享文件，先更新依赖关系再调度。

11 的真实 validator 回归独占新增 `packages/mcp/test/schema-intersection.test.ts`，使用 MCP 已有 SDK 的 `@modelcontextprotocol/sdk/validation/ajv`；10 使用 `mcp.test.ts` 和新增 `transport.test.ts`。11 不改任何 package.json 或 bun.lock，维持与 01/10 的写入边界。F19 不承诺穷尽任意自定义 schema 的省略语义。

## 校验与验收

各 todo 必须运行其指定的模块测试和 `bun run typecheck` / `bun run lint`；涉及公共导出/依赖/发布验证时运行 build 与 verify:packages。最终合并态完整运行：

```sh
bun install --frozen-lockfile
bun run typecheck
bun run lint
bun run build
bun test
bun run verify:packages
bun test --coverage --coverage-reporter=lcov packages/core
bun run check:coverage
bun run docs:build
bun audit --registry https://registry.npmjs.org
```

最终 audit 允许仅剩已记录的 R01 开发工具链 advisory；F01 的 fast-uri/qs 6条必须消失，并报告其他新告警，不能忽略或降低等级来伪造通过。当前不存在可据此断言的 Zebra SSRF 漏洞；依赖风险的实际可达性需分开判断。

每个修复须在修复前能触发对应边界、修复后通过；现有 665 个测试不能回退。无需为单纯文档修改新增测试。脚本测试不得对当前工作区执行真实 release/publish/tag。热路径变更按需运行 `bun run bench:check`，保留结果，不自动刷新 baseline。

## 风险与假设

- 探索模式默认优先兼容的正确性和工程修复；没有新增产品功能目标。
- v1 API freeze 是实现约束。若修复确实需改变已文档化公共语义或迁移数据，转入 roadmap 并明确原因，不能悄悄改合同。
- CORS 已有测试断言 denied 响应无 Vary；修复缓存变体时需更新该缺陷断言，仍保持 denied Origin 不获得 Access-Control-Allow-Origin。
- metrics 的 percentile 按源码明确声明的 nearest-rank 修正；不另换统计定义。
- Redis roadmap 涉及存量认证数据，不能只改 key 前缀就宣称兼容。
- scripts/release.ts 的版本更改需在临时仓库测试；不把未经复现的 lockfile CI 故障当成确定缺陷。
- 当前依赖镜像证书错误是环境结果；使用官方 registry 完成只读审计，不关闭 TLS 校验、不改全局 registry。
- 基础测试的覆盖率并未覆盖本计划新增的交错行为；不能仅以已有覆盖率替代回归验证。
- 当前工作区开始时干净；提交前再次检查，若出现用户其他改动按 auto-dev 规则停止，不代为 stash / commit / discard。
- Herdr 环境已验证可用；计划提交后再启动执行 agent，当前 session 不等待实现完成。

## 外部依据与审计原文

静态条件请求依据：[RFC 9110 If-Range](https://www.rfc-editor.org/rfc/rfc9110.html#name-if-range)、[If-None-Match](https://www.rfc-editor.org/rfc/rfc9110.html#name-if-none-match)。

依赖 advisory 的修补范围由当前 registry 审计与官方维护者公告交叉核对：[fast-uri](https://github.com/advisories/GHSA-5jgf-p345-68v8)、[qs](https://github.com/advisories/GHSA-x5fp-wj9c-mxmx)、[esbuild](https://github.com/advisories/GHSA-67mh-4wv8-2f99)、[Vite](https://github.com/advisories/GHSA-fx2h-pf6j-xcff)。fast-uri 3.1.6 和 qs 6.16.0 是此次审计对应的修补版本；执行时再验证上游元数据与兼容性。

```text
$ bun audit
bun audit v1.4.0 (34cbb9a40)
error: POST https://registry.npmmirror.com/-/npm/v1/security/advisories/bulk - UNKNOWN_CERTIFICATE_VERIFICATION_ERROR

$ bun audit --registry https://registry.npmjs.org
esbuild@0.21.5
  vitepress > @vitejs/plugin-vue > vite > esbuild
  moderate: esbuild enables any website to send any requests to the development server and read the response (<=0.24.2) - https://github.com/advisories/GHSA-67mh-4wv8-2f99

fast-uri@3.1.5
  workspace:@zebra-web/mcp > @modelcontextprotocol/sdk > ajv > fast-uri
  high: fast-uri vulnerable to host confusion via skipped IDN canonicalization on scheme-relative references (>=3.1.3 <3.1.6) - https://github.com/advisories/GHSA-5jgf-p345-68v8
  high: fast-uri vulnerable to server-side request forgery via malformed IPv6 normalization (>=3.0.0 <3.1.6) - https://github.com/advisories/GHSA-f65p-4m7j-42xc
  high: fast-uri vulnerable to server-side request forgery via repeated hostname percent-decoding (>=3.1.2 <3.1.6) - https://github.com/advisories/GHSA-fph4-wmhf-6fwf
  high: fast-uri vulnerable to host confusion via percent-encoded scheme normalization (>=3.0.0 <3.1.6) - https://github.com/advisories/GHSA-jqff-g426-hqxp

qs@6.15.3
  workspace:@zebra-web/mcp > @modelcontextprotocol/sdk > express > body-parser > qs
  moderate: qs array-limit bypass via bracket-key comma parsing (>=6.14.2 <=6.15.3) - https://github.com/advisories/GHSA-x5fp-wj9c-mxmx
  moderate: qs: Denial of Service via Attacker Controlled isBuffer (>=2.2.5 <6.16.0) - https://github.com/advisories/GHSA-4mjr-xmp4-gh2g

vite@5.4.21
  vitepress > @vitejs/plugin-vue > vite
  moderate: launch-editor: NTLMv2 hash disclosure via UNC path handling on Windows (<=6.4.2) - https://github.com/advisories/GHSA-v6wh-96g9-6wx3
  moderate: Vite Vulnerable to Path Traversal in Optimized Deps `.map` Handling (<=6.4.1) - https://github.com/advisories/GHSA-4w7w-66w2-5vf9
  high: vite: `server.fs.deny` bypass on Windows alternate paths (<=6.4.2) - https://github.com/advisories/GHSA-fx2h-pf6j-xcff

10 vulnerabilities (5 high, 5 moderate)

$ bun audit fix --dry-run --registry https://registry.npmjs.org
fixing:
  ^ fast-uri 3.1.5 -> 3.1.6
  ^ qs 6.15.3 -> 6.16.0
  ^ vite 5.4.21 -> 6.4.3

blocked by a dependent's range:
  ^ esbuild 0.21.5 -> 0.25.0
    vite@5.4.21 depends on esbuild@^0.21.3
  ^ vite 5.4.21 -> 6.4.3
    vitepress@1.6.4 depends on vite@^5.4.14

Would fix 6 vulnerabilities in 3 packages (checked 320) [889.00ms]
4 vulnerabilities remaining

$ COVERAGE_THRESHOLD=banana bun run check:coverage
[check:coverage] 2307/2422 lines covered (95.25%), threshold NaN%
[check:coverage] OK
```
