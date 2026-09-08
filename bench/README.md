# Zebra Benchmark

Zebra vs Hono vs Elysia — 路由吞吐 / 中间件链 / JSON 序列化对比，跑在真实 HTTP 服务器上（Bun `Bun.serve` + `fetch` 客户端并发打流，非 self-serving 计数）。

## 场景

| 场景 | 路径 | 说明 |
| --- | --- | --- |
| static | `/hello` | 静态路由，返回纯文本 |
| param | `/user/:id` | 参数路由，回显 `id` |
| wildcard | `/wild/a/b/c` | 通配路由，回显匹配尾巴 `a/b/c` |
| middleware | `/middleware` | 5 层中间件链 + 处理器 |
| json | `/json` | 返回 JSON 对象（`{"hello":"world","arr":[1..10]}`） |
| di | `/di` | 路由 DI 依赖解析（zebra 走 container；hono/elysia 无 DI，直接返回同 body 的 JSON） |
| static-file | `/static/hello.txt` | 真实文件静态服务（zebra `app.static()`，hono/elysia `Bun.file` handler） |
| post-json | `/post-json` (POST) | JSON body 解析后回显（zebra `req.json()`；hono `c.req.json()`；elysia 自动 body 解析） |

三个框架注册完全相同的路由集（见 `zebra-bench.ts` / `hono-bench.ts` / `elysia-bench.ts`），响应体做了一致性校验（200 + body 断言），不通过直接报错，避免假数据。

## 结果

### 当前基线（Bun 1.4.0，zebra）

环境：macOS (arm64, Apple Silicon 16 核) · Bun **1.4.0**（`bun --version` 记录）· 单进程本机回环 · 3000ms × 64 并发 · 3 次取中位数 · 录制命令 `BENCH_DURATION_MS=3000 bun run bench/bench-regression.ts --update`（即 `baseline.json`，`bun run bench:check` 以此为回归门槛）。

| scenario | req/s | p95 (ms) |
| --- | ---: | ---: |
| static | 86,364 | 1.21 |
| param | 84,332 | 1.24 |
| wildcard | 82,662 | 1.27 |
| middleware | 78,242 | 1.32 |
| json | 80,250 | 1.31 |
| di | 78,454 | 1.34 |
| static-file | 32,700 | 2.97 |
| post-json | 26,732 | 3.69 |

### 历史参考（Bun 1.3.14，跨框架对比，不作为当前基线）

环境：macOS 26.5 (arm64, Apple Silicon 16 核) · Bun **1.3.14**（`bun --version` 记录）· **elysia 1.4.29 / hono 4.13.1**（`bench/package.json` 精确锁版，结果随版本漂移时以锁定版本为准）· 单进程本机回环 · 1.5s × 64 并发（`BENCH_DURATION_MS` / `BENCH_CONCURRENCY` 可调）· 2026-08-09（zero-cost fast path 之后；下表数字先于版本锁定与中位数测量法，仅作历史参考）。

吞吐 req/s（数字越高越好）：

| scenario | zebra | hono | elysia |
| --- | ---: | ---: | ---: |
| static | 75,599 | 103,931 | 107,089 |
| param | 75,072 | 102,000 | 109,834 |
| wildcard | 75,498 | 100,944 | 108,505 |
| middleware | 73,650 | 93,832 | 106,666 |
| json | 74,230 | 92,524 | 104,653 |
| di | 70,310 | 78,802 | 103,118 |
| static-file | 31,296 | 37,037 | 39,962 |

延迟（完整输出，p50/p95/p99 ms，zebra）：

| scenario | zebra p50/p95/p99 |
| --- | ---: |
| static | 0.91 / 1.35 / 1.73 |
| param | 0.92 / 1.34 / 1.67 |
| wildcard | 0.94 / 1.34 / 1.65 |
| middleware | 0.96 / 1.35 / 1.65 |
| json | 0.94 / 1.37 / 1.67 |
| di | 1.01 / 1.41 / 1.73 |
| static-file | 2.39 / 3.00 / 3.41 |

zero-cost fast path 对比（改造前 / 后，zebra，1.5s × 64）：

| scenario | rps 前 → 后 | p95 前 → 后 |
| --- | ---: | ---: |
| static | 72,121 → 75,599 | 1.39 → 1.35 |
| param | 70,158 → 75,072 | 1.42 → 1.34 |
| wildcard | 71,964 → 75,498 | 1.39 → 1.34 |
| middleware | 67,842 → 73,650 | 1.45 → 1.35 |
| json | 70,564 → 74,230 | 1.41 → 1.37 |

无 DI 的常规路由不再创建 Container child scope，`withResolvedDeps` 的 per-request 扫描/包装移到 boot 期预编译，因此吞吐整体提升约 5~9%、p95 下降 0.04~0.10ms；middleware 场景收益最大（+8.6%）。

> **中间件场景的可比性注意**：三框架的"5 层中间件"机制不完全等价——zebra 每请求走 compose 嵌套，hono 是预组合链，elysia 的 `onRequest` 是扁平 hook 链且**全局生效**（static 等场景也背着这 5 个钩子，实测近零成本）。因此 middleware 行的绝对数值不能跨框架直接解读，相对排序（zebra < hono < elysia）可信。
>
> **static-file 场景的可比性注意**：功能不等价——zebra 走完整的 `app.static()`（路径穿越/symlink 逃逸防护、weak ETag、条件请求、Range、缓存），hono/elysia 是裸 `Bun.file` handler，无任何安全检查。该行数字是"完整实现 vs 最小实现"的对比，不是同功能对比。

## 复现

```bash
# 1) 安装依赖（hono / elysia 作为 bench devDependencies，zebra 为 workspace 依赖）
bun install

# 2) 记录 Bun 版本
bun --version

# 3) 跑基准（默认 3s × 64 并发，可调）
bun run bench

# 或调参：
BENCH_DURATION_MS=2000 BENCH_CONCURRENCY=32 bun run bench

# 4) 性能回归门槛（zebra-only，默认 1s × 64 × 3 次取中位数，阈值：rps ≥ 基线 80% 且 p95 ≤ 基线 125%；基线按本机录制，仅在本地运行，不接入 CI——共享 CI runner 吞吐只有本机约一半且噪声大）
bun run bench:check

# 有意的性能改动后重录基线：
BENCH_DURATION_MS=3000 bun run bench/bench-regression.ts --update
```

脚本会依次启动每个框架的 server（随机端口），对每个场景先做响应正确性校验，再 warmup 500ms、计时打流，最后输出每场景 req/s 与 p50/p95/p99 延迟汇总表。

### 实现说明

- `bench.ts`：驱动。设置 `NODE_ENV=production` 后动态 import 各框架 server，用 `fetch` 并发打流（keep-alive 复用连接），`performance.now()` 计延迟。
- `runner.ts`：打流与场景校验的共享实现，`bench.ts` 与 `bench-regression.ts` 共用。
- `bench-regression.ts` + `baseline.json`：zebra-only 回归门槛，CI 可用；`--update` 重录基线。
- `zebra-bench.ts` / `hono-bench.ts` / `elysia-bench.ts`：各自注册同一组路由；zebra 的中间件链用空前缀 `group` 挂 5 层 `use()`，hono 用 `app.use("/middleware", …)` × 5，elysia 用 5 个 `onRequest` 插件。
- 结果表格数字会随机器/Bun 版本浮动，更新方式：跑 `bun run bench`，把「Summary (req/s)」与延迟行贴回本文件。

## Bun native 评估

2026-09-07（America/Los_Angeles；原始日志使用 UTC，日期为 09-08）完成 JSON
响应和受限请求体合并评估。**01、02 均未采用候选，最终全部 `packages/*/src/`
与 `1418a2f3f8b3e0bae53490eb195811b34590e041` 相同。** 这次交付是行为对照、
benchmark 和未采用证据，不代表生产路径迁移成功。

### 来源与复现

| 路径 | before | 测量的 after | 最终交付 |
| --- | --- | --- | --- |
| JSON | `1418a2f` | 同一基线上两个 Problem+Json 构造的未提交候选；[完整 patch](../plans/bun-native/results/01/candidate.patch) | `12e6b88e41198bae922a1d6ca9c6a68cc4f40a8f`，五个入口均保留原源码 |
| body | `1418a2f` | `f09288298b0bc895624aad49f159b959c168ec31` 中 benchmark 内置的 `Bun.concatArrayBuffers(chunks, size, true)` 候选 | `0c0d78ebe4329214d358a9b4428e8dcf1451d215`，生产仍分配 `Uint8Array(size)` 并逐块 `set()` |
| session | `216b94763b620a5d844620a579b3a03a0dc64691` 的 `createHmac` | `4466df7a74864ffde5d83ab0dcb6824f473bbd50` 的 `Bun.CryptoHasher` | 用户在本计划之前已有的实现，本轮仅复核 |

从仓库根运行，需要冻结依赖、Git 中可访问 `1418a2f`、`git archive`、`tar` 和
对应 Bun 可执行文件。JSON 脚本自动导出并清理临时源码，不修改 checkout。

```sh
bun install --frozen-lockfile
bun --version

# 默认重建被拒绝的两个 Problem+Json 候选；23 场景，每场景 7 轮
bun run bench/native-json.ts
# 明确参数，与默认测量相同
bun run bench/native-json.ts --baseline 1418a2f --candidate problem-native --rounds 7 --iterations 10000 --warmup 2000
# 最终原源码控制；四个 constructor 场景仍是原始 API 对照
bun run bench/native-json.ts --candidate current --check

# 11 个输入 × 局部合并/完整 readBody 两阶段，默认 9 轮
bun run bench/native-body.ts
NATIVE_BODY_ROUNDS=9 NATIVE_BODY_SCALE=1 bun run bench/native-body.ts
# 无计时的正确性检查
bun run bench/native-body.ts --check

bun run bench/session-sign.ts
bun run bench:check

# 最低版本：仅对当前命令及其子进程替换 PATH，不修改全局 Bun
PATH=/tmp/zebra-bun-native-run/runtime/bun-linux-x64:$PATH bun --version
PATH=/tmp/zebra-bun-native-run/runtime/bun-linux-x64:$PATH bun run bench/native-json.ts
PATH=/tmp/zebra-bun-native-run/runtime/bun-linux-x64:$PATH bun run bench/native-body.ts
PATH=/tmp/zebra-bun-native-run/runtime/bun-linux-x64:$PATH bun run bench/session-sign.ts
PATH=/tmp/zebra-bun-native-run/runtime/bun-linux-x64:$PATH bun run bench:check
```

隔离目录是本轮准备的位置；在其他机器上替换为自己的 Bun 1.4.0 bin 目录。
复现采用判断时，每版完整命令至少运行两次，不同时运行其他测量、构建或测试。
JSON 每方预热 2,000 次，每轮 10,000 次，交替顺序；所有响应以 `.text()` 消费并
逐次核对全文。body 每方两批预热，按输入大小选择迭代数，逐轮交替顺序，分配和
复制均在计时内，显式 GC 在计时外；完整读取包括 Request/Headers/stream 创建、
相同的声明/逐块限额及输出消费，不包括 JSON 解析。

### 环境与完整数据

01、02 均为 Linux x64、AMD EPYC Processor、8 个逻辑 CPU。
Bun 1.4.2 revision `744846f844374847c902b5e7fd59b4342a51ef99`；
Bun 1.4.0 revision `34cbb9a40b4bd1bd767d134a7065e66c2432a676`。
只与同机器、同 Bun 的 before 比较，不跨版本计算收益。

| 证据 | 每版有效复跑 | 每场景轮数 | 完整数据与所有中位数 |
| --- | ---: | ---: | --- |
| 01 JSON | 2 | 7 | [报告](../plans/bun-native/results/01/REPORT.md)、[summary.csv](../plans/bun-native/results/01/summary.csv)、[选择记录](../plans/bun-native/results/01/selection.json)、[原始数据目录](../plans/bun-native/results/01/) |
| 02 body | 2 | 9 | [全部场景中位数及配对波动](../plans/bun-native/results/02/report.md)、[命令/哈希 manifest](../plans/bun-native/results/02/manifest.json)、[原始数据目录](../plans/bun-native/results/02/) |
| 03 最终复核 | 见最终报告 | JSON 7 / body 9 / session 7 / HTTP 3 | [验收与性能报告](../plans/bun-native/results/03/REPORT.md)、[原始日志与负载记录](../plans/bun-native/results/03/) |

01 的 1.4.2 run4/run5、1.4.0 run1/run3 为有效数据。另四次完整测量受外部 CPU
负载干扰，原数据保留但排除采用判断；一个 wait-only 记录没有计时数据。
后续规则为连续 15 个两秒安静样本后启动，测量期间持续采样：其他进程达到单核
15% CPU 或存在 benchmark/build/test 工作负载就标记干扰，整次排除，不根据
快慢选择样本。02 每版两次全部保留，没有排除任何运行；其原始记录没有 01/03
这种连续负载采样，不能倒推为同等监测强度。03 沿用连续安静窗口和采样规则，
独立记录最终复跑。采样仍可能漏掉短暂进程活动，不能消除虚拟化、GC 和调度噪声。

### 01：JSON / Problem+Json 未采用

`json()`、普通 handler、contract 的直接 `Response.json` 替换存在根值兼容差异：
function/Symbol、函数 `toJSON`、无 JSON 表示的根值及 null body/空流等行为不能
直接等同。保留各自的 status、序列化错误映射和 Headers 副作用顺序。
两个固定顶层 Problem+Json 候选通过行为检查，但不满足性能条件。

下表为旧 / 候选中位耗时（ns/op），括号为候选耗时变化，**正数更慢**。
这是 01 已复核的两次有效运行，所有 23 场景及未修改控制见上方 CSV。

| 场景 | 1.4.2 run4 | 1.4.2 run5 | 1.4.0 run1 | 1.4.0 run3 |
| --- | ---: | ---: | ---: | ---: |
| 原始构造 Unicode | 2000 / 3107 (+55.33%) | 1998 / 3280 (+64.19%) | 2066 / 3174 (+53.67%) | 2027 / 3076 (+51.71%) |
| 错误中间件 + cookies | 6249 / 7020 (+12.33%) | 5552 / 6480 (+16.72%) | 6107 / 6456 (+5.72%) | 6362 / 6757 (+6.20%) |
| 完整错误 dispatch | 9545 / 10511 (+10.12%) | 9091 / 9813 (+7.95%) | 9967 / 9384 (−5.86%) | 11613 / 12461 (+7.30%) |
| WebSocket Problem 构造 | 2721 / 2649 (−2.65%) | 2615 / 2631 (+0.63%) | 2625 / 2626 (+0.06%) | 3843 / 3794 (−1.27%) |

错误中间件局部成本两版均反复退化；完整 dispatch 的收益不稳定。WebSocket 的
微小变化方向不一致，未超过未改控制场景的波动（四次控制的绝对变化中位数
分别为 1.07%、1.79%、3.61%、1.67%）。因此五个生产入口全部保留原源码。
此结论针对直接替换和测量过的两个候选，不否定未来所有可能的兼容实现。

### 02：受限请求体合并未采用

字节、偏移视图、复制隔离、限额、取消及共享读取语义验证通过；最终合并候选仍有
代表性退化。下表为旧 / 候选中位耗时（ns/op）；全部 22 场景中位数与 1,584 个
计时样本见 02 报告和原始 JSONL，收益与退化均保留。

| 阶段 / 场景 | 1.4.2 run1 | 1.4.2 run2 | 1.4.0 run1 | 1.4.0 run2 |
| --- | ---: | ---: | ---: | ---: |
| merge / 小 JSON 单块 | 72.1 / 247.0 (+242.4%) | 75.7 / 264.3 (+249.3%) | 84.3 / 258.0 (+206.2%) | 78.9 / 238.7 (+202.7%) |
| merge / 16 × 1 KiB | 2572 / 3636 (+41.4%) | 2305 / 3174 (+37.7%) | 3357 / 4771 (+42.1%) | 3087 / 4394 (+42.3%) |
| merge / 256 × 64 B | 9194 / 6137 (−33.3%) | 9060 / 5631 (−37.8%) | 10089 / 7277 (−27.9%) | 10186 / 6121 (−39.9%) |
| readBody / 单 byte | 4637 / 4844 (+4.5%) | 4355 / 4592 (+5.4%) | 4255 / 4386 (+3.1%) | 4180 / 4554 (+9.0%) |
| readBody / 1 MiB 单块 | 117469 / 104523 (−11.0%) | 111934 / 95491 (−14.7%) | 109708 / 94554 (−13.8%) | 109885 / 98382 (−10.5%) |

小 JSON 单块及 16 × 1 KiB 的局部合并，四次运行各自 9/9 配对均更慢。
256 × 64 B 局部合并和大正文完整读取有收益，但没有满足其他代表性场景不退化
的条件。部分完整读取小幅变化会反转，不能据此构造通用收益结论。

JSON 的进程内响应构造/dispatch、body 的局部合并/受限读取与下面的 HTTP gate
是不同测量范围，不能把 ns/op 比值写成 HTTP 吞吐倍率。

## Session 签名微基准

`session-sign.ts` 对比原先的 `node:crypto.createHmac` 和当前导出的 `sign` / `verify`
（`Bun.CryptoHasher`）。两者均使用 HMAC-SHA256、base64url，验签均保留
`timingSafeEqual`。这是用户在本轮之前的 `4466df7` 实现，本轮没有新增 session
优化，也不把它的数字用作 JSON 或 body 路径收益。

```sh
bun run bench/session-sign.ts
PATH=/tmp/zebra-bun-native-run/runtime/bun-linux-x64:$PATH bun run bench/session-sign.ts
```

脚本先校验签名兼容性；预生成 256 个 UUID 长度的输入，每方预热 20,000 次，
交替顺序测量 7 轮 × 100,000 次，取中位数。验签输入是预生成的有效 cookie，
不包含签名生成时间。原脚本输出环境、两阶段中位数和消费 checksum，
不输出逐轮样本；完整 stdout/stderr 在 03 目录保存，不能称为逐轮原始数据。
本轮每版一份无已记录干扰的完整复跑，环境同上；准确起止时间、命令与负载见
[03 最终报告](../plans/bun-native/results/03/REPORT.md)。

| Bun | helper | 原实现 ns/op | 既有 Bun.CryptoHasher ns/op | 耗时减少 |
| --- | --- | ---: | ---: | ---: |
| 1.4.2 | sign | 1267.4 | 700.6 | 44.7% |
| 1.4.2 | verify（有效 cookie） | 1597.1 | 981.1 | 38.6% |
| 1.4.0 | sign | 1261.0 | 787.1 | 37.6% |
| 1.4.0 | verify（有效 cookie） | 1529.3 | 1036.6 | 32.2% |

这里测量同步 helper 的耗时，包含字符串和编码处理，不代表 HTTP 吞吐提升。
`bun test packages/session` 覆盖旧签名、Unicode/长密钥、篡改拒绝，以及旧 cookie
经过 resolver 和 HTTP middleware 后保留原会话的行为；新 cookie 也与旧格式
逐字节比对。这些测试包含在本轮两版本全量验收中。

## 最终 HTTP gate 与仓库验收

最终复核见 [03 REPORT](../plans/bun-native/results/03/REPORT.md)。该报告逐条记录
Bun 版本、HEAD、文档/源码指纹、命令、退出码和原始日志，包括两版冻结安装、
typecheck、lint、build、全量 test、12 包 src-direct 验证、core 90% coverage gate、
带 `/zebra/` base 的最终双语 docs 构建、浏览器目标打包和性能命令。

02 的历史 Bun 1.4.0 peer-IP 测试失败已由 01 固定监听和请求到 `127.0.0.1`
解决，原断言及 XFF 保留；历史失败日志仍原样保留。最终状态以 03 复核为准。
HTTP gate 继续使用原来的 Apple Silicon 基线、80% rps / 125% p95 门槛以及默认
1s × 64 并发 × 3 次。跨机器失败必须完整报告，不能重录基线或降门槛掩盖。

03 的原 `bun run bench:check` 在 **Bun 1.4.2 和 1.4.0 均为 8 场景 FAIL、exit 1**，
两次均没有记录到测量期外部干扰。最终生产代码与 `1418a2f` 相同；同机原始源码
HTTP 对照、每场景 rps/p95、全部失败输出及测量限制均列于 03 报告。功能门禁
通过不代表该跨机器性能门槛通过，局部 helper 的收益也不能抵消这个失败记录。

## Request hot-path evaluation（2026-09-08 UTC）

**本轮没有实现生产性能提升。** 集成源码 `5530f7678a9df0c92fcdf9e99c268408c913a439`
的全部 80 个 `packages/*/src/` 文件与规划基线
`a856cab47d4fd3102e976ce7a70166837837eea2` 逐字节相同。新增 harness、66 个
兼容性回归测试和评估证据保留；原有 Apple Silicon 数据和 Bun native 结论仍适用
于各自历史评估，不作为本轮收益。完整命令、实际退出码及失败历史见
[集成报告](../plans/performance-speedup/results/06/REPORT.md)。

| 候选 | 最终决定 | 性能结论 / 证据 |
| --- | --- | --- |
| Router static index | 未采用 | 最低版本两次有界控制均 quiet-timeout；[02](../plans/performance-speedup/results/02/README.md) |
| Lazy content-type metadata | 未采用 | 最低版本 request / HTTP 控制均耗尽；[03](../plans/performance-speedup/results/03/README.md) |
| Guarded DI cache return | 未采用 | 最低版本两次 DI 控制均 quiet-timeout；[04](../plans/performance-speedup/results/04/README.md) |
| Dispatch forwarding wrappers | 未采用 | 最低版本两次 dispatch 控制均 quiet-timeout；[05](../plans/performance-speedup/results/05/README.md) |
| `Promise.resolve` compose shortcut | 行为不兼容，拒绝 | 两个 native-promise 自定义 `then` getter 测试在两版 Bun 均失败；[05](../plans/performance-speedup/results/05/README.md) |

前四项性能证据不足，不能说已经证明更快、更慢或无效。所有候选均无计时行，
行为通过也不代替性能确认。最终原源码配对在两版 Bun 均 quiet-timeout、零计时行：组件成本及全部
16 个 HTTP 场景的 req/s、p50/p95/p99 均未测得。两版最终历史 gate 窗口也均
quiet-timeout，gate **NOT RUN**，不是通过或失败。Task 01 的历史 Bun 1.4.2
`bench:check` 实际 **8/8 场景 FAIL、exit 1**，仍完整保留于
[historical-142](../plans/performance-speedup/results/01/historical-142/)。

### 新 harness 与复现

新 harness 的 `router|request|di|dispatch|http|all` suites 区分组件成本与完整请求。
HTTP 包含全部原有八场景，另加 async、query、metadata、warmed class/factory、
20 层 middleware、static/middleware listeners 八场景；真实 loopback sockets，
每次计时请求都读取并核对完整 body，记录 req/s 和 p50/p95/p99。
`--check` 仅校验行为，不产生计时行。

环境：Linux x64 / AMD EPYC / 8 logical CPUs / 16,760,184,832 bytes RAM；
Bun 1.4.2 `744846f844374847c902b5e7fd59b4342a51ef99` 和隔离 Bun 1.4.0
`34cbb9a40b4bd1bd767d134a7065e66c2432a676`。固定 task-01 commit
`609c1d298393c49b49e6c11537e55437c5f6a89f` 的 harness/fixture aggregate SHA-256：
`b4a3feb23f5d26c8b6121d35e1b121b2b5ab6221b45a62ae4ddf42dd8a31a976`。
这是组合指纹，不是单个 `hot-path.ts` 的文件哈希。

先按 [独立复现步骤](../plans/performance-speedup/results/06/REPRODUCE.md) 从 Git
重建冻结安装的 baseline、集成源码和固定 harness，准备每个版本独立的 Bun bin
目录及串行锁。下面变量均为该步骤创建的绝对路径，不依赖本轮临时目录存活：

```sh
# 每个运行时均把其 bin 目录放在 PATH 首位，包括子进程。
export PATH="$BUN_BIN:$PATH"
python3 "$LOCK" check bun "$HARNESS" --source-root "$BEFORE" --suite all --check
python3 "$LOCK" check bun "$HARNESS" --source-root "$AFTER" --suite all --check

# 一次完整 all-suite 配对；不得把两次窗口合并成一个锁持有。
python3 "$LOCK" measure python3 "$PROTO/measure.py" --output "$OUT/paired" \
  python3 "$PROTO/series.py" --harness "$HARNESS" --before "$BEFORE" --after "$AFTER" --suite all

# 历史门槛使用原默认值，单独窗口；不更新 baseline 或 thresholds。
unset BENCH_DURATION_MS BENCH_CONCURRENCY
python3 "$LOCK" measure python3 "$PROTO/measure.py" --output "$OUT/historical" bun run bench:check
```

固定设置为 5 个 AB/BA/AB/BA/AB 配对、每方独立进程、组件 100000 iterations /
20000 warmup，HTTP 1000 ms / 500 ms warmup / concurrency 32。
[Task-01 protocol](../plans/performance-speedup/results/01/README.md) 规定连续
30 秒安静、最长等待 300 秒；测量时任何外部进程达到单核 15% CPU 或检测到竞争
workload，整次结果排除并保留。原有 1.4.2 variability envelopes 不放宽，1.4.0
没有有效 envelope。只有未来获准的生产候选评估才需要每版两次完整确认；本次
最终生产未改变，每版只允许一次配对尝试，不据此宣称 repeatability 或收益。
