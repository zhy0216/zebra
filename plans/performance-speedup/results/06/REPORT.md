# Integrated request performance evaluation

**No production optimization was retained and no speedup was achieved.**
The integrated production revision is
`5530f7678a9df0c92fcdf9e99c268408c913a439`. All 80 production files are
byte-identical to baseline `a856cab47d4fd3102e976ce7a70166837837eea2`.
Task 06 adds results/reproduction documentation and updates `bench/README.md`;
it changes no source, tests, benchmark fixtures, dependencies or gate settings.

All 66 task-02–05 regression tests remain integrated (5 router, 9 metadata,
25 DI, 27 dispatch/middleware). The actual full integrated test runs passed
**1382/1382 on both Bun versions**: the coordinator's Bun 1.4.2 run at the same
revision is reused as explicitly authorized; task 06 ran the Bun 1.4.0 full suite.
Both have 136466 assertions across 119 files. These passes do not erase the
candidate compatibility failures or intermittent unchanged-store failures below.

## Candidate decisions

| Evaluation | Decision | Evidence and limits |
| --- | --- | --- |
| Router static index | Excluded; performance inconclusive | Both minimum router controls exhausted quiet timeouts. No candidate timing, HTTP comparison, registration time or measured memory benefit. [02 report](../02/README.md) |
| Lazy content-type lowercase derivation | Excluded; performance inconclusive | Both minimum request and both HTTP controls timed out; subsequent scheduled windows also launched no timing. Signal deferral was not implemented. [03 report](../03/README.md) |
| Guarded DI cache-hit return | Excluded; performance inconclusive | Both minimum DI controls and the already-active current comparison timed out. Unconditional cache shortcut was unsafe by inspection; guarded implementation had no measured benefit. [04 report](../04/README.md) |
| Dispatch forwarding wrappers | Excluded; performance inconclusive | Both minimum dispatch controls timed out. Dispatch-only candidate also encountered the unrelated store assertion in a focused check. [05 report](../05/README.md) |
| `Promise.resolve` compose shortcut | Rejected for behavior on both runtimes | Two native-promise custom throwing `then` getter tests failed on each runtime: 621 pass / 2 fail. Direct promise return lost the expected accessor error. Exact rejected patches and full failure logs are in [05](../05/README.md). |

All optimization-task started timing attempts produced **zero timed rows**.
There is no evidence that the first four candidates are faster, slower, or
ineffective; their performance remains inconclusive. Passing semantic checks
cannot supply missing performance evidence. No new controls or confirmations
were run to refill exhausted 02–05 allowances. No JSON/body native candidate was
reintroduced and prior native-evaluation conclusions remain unchanged.

## Source, runtime and environment

| Identity | Recorded value |
| --- | --- |
| Planning production baseline | `a856cab47d4fd3102e976ce7a70166837837eea2` |
| Immutable integrated task-01 harness commit | `609c1d298393c49b49e6c11537e55437c5f6a89f` |
| Integrated source/test revision validated | `5530f7678a9df0c92fcdf9e99c268408c913a439` |
| Production fingerprint, both roots, 80 files | `7a9eb1077326654812aabcad8519086ce61b28350a6160582ec01cbce90c9b73` |
| Harness/fixture aggregate SHA-256 | `b4a3feb23f5d26c8b6121d35e1b121b2b5ab6221b45a62ae4ddf42dd8a31a976` |
| Individual `bench/hot-path.ts` SHA-256 | `b21c8f82c483b0ef6614c69388e1ce2517ae25e83a8ce49b50a09907397a3a30` |
| Frozen `bun.lock` SHA-256 | `ece1a7458ab75446feadd1a013f9d6b8ca7b9d539ca39bc1384119591c2e31f1` |
| Bun 1.4.2 | `/home/ubuntu/.bun/bin/bun`, revision `744846f844374847c902b5e7fd59b4342a51ef99` |
| Bun 1.4.0 | `/tmp/zebra-performance-speedup-01/runtime/bun-1.4.0/bun`, revision `34cbb9a40b4bd1bd767d134a7065e66c2432a676` |
| Host | Linux x64, kernel `6.8.0-31-generic`, AMD EPYC, 8 logical CPUs, RAM 16760184832 bytes |
| Source root | `/home/ubuntu/.herdr/worktrees/zebra/herdr-plan-performance-speedup-06-results` |
| Independently installed frozen baseline | `/tmp/zebra-performance-speedup-01/baseline-a856cab` |
| Executed harness / protocol | `/home/ubuntu/workspace/zebra/bench/hot-path.ts` / `plans/performance-speedup/results/01` under that checkout |

[audit-source.py](audit-source.py) compares explicit source file sets/bytes against
Git archives of all three revisions and the frozen baseline, avoiding wildcard
Git pathspec omissions. [source-before.jsonl](source-before.jsonl) records every
source hash, all unchanged integrated test files, protected benchmark/package
files and the immutable recorder/series checks. Harness environment/final records
independently verify source-root absolute module paths and constant fingerprints.
The aggregate harness hash above is not the single driver-file hash.

The baseline and task-06 worktree have independent frozen installs. Minimum Bun
was first in PATH for every minimum check and scheduled window, including
subprocesses; neither global installation nor packageManager/engines changed.
The exact PATH, argv, cwd, times, HEAD and raw-log SHA-256 are retained in
[checks.jsonl](checks.jsonl) and [windows.jsonl](windows.jsonl).
No original scenario, baseline, 80% RPS / 125% p95 threshold or package version
changed. Public API/compatibility behavior remains the baseline behavior.

## Final bounded performance windows

The coordinator's final scheduling clarification superseded generic two-run
candidate confirmations: unchanged production gets **one fixed all-suite paired
attempt per runtime**, with no retry after a quiet timeout. No repeatability gain
claim is possible or needed. Historical gates each get a separate attempt and
allocation. [run-windows.py](run-windows.py) records this exact four-attempt
schedule; it calls the unmodified task-01 recorder and series. Each measure lock
hold covers one recorder attempt only and releases before the next allocation.

The immutable recorder requires 15 consecutive two-second quiet samples, with a
300-second maximum wait. Any sampled outside process >=15% of one core or a
competing workload resets quiet progress. Any such sample after timing begins
excludes the entire comparison. Outside processes were not stopped. A zero
`interferenceSamples` value counts the measured phase only; it does not prove a
quiet wait had no interference. All samples and actual statuses are preserved.

Both attempts exhausted the quiet window normally, without starting a timed
Bun process. No attempt was retried. All component costs, registration/memory
observations and all sixteen HTTP throughput/p50/p95/p99 cases are **unmeasured
on both runtimes**. There are zero completed paired rounds; no numeric gain,
latency, allocation estimate or nonregression result is substituted for missing data.

All times are UTC on 2026-09-08; CPU percentages are of one core.

| Attempt | Start–finish UTC | Actual result | Blocked quiet samples / total; peak outside CPU | Timed processes / rows |
| --- | --- | --- | --- | --- |
| `paired-142` | 08:28:43.164–08:33:43.698 | Quiet timeout; recorder exit 2 | 148/149; peak 248.41% | 0 / 0 |
| `paired-140` | 08:33:43.792–08:38:44.140 | Quiet timeout; recorder exit 2 | 148/149; peak 214.98% | 0 / 0 |

The longest quiet streak was one sample in each attempt; fifteen were required.
The complete original recorder bytes are archived in
[paired-142 status](paired-142/status.json.gz), [load](paired-142/load.jsonl.gz),
[paired-140 status](paired-140/status.json.gz), [load](paired-140/load.jsonl.gz).
No timing stdout/stderr was created because neither workload launched.


The attempted all-suite series uses five AB/BA/AB/BA/AB pairs, ten separate
baseline/after Bun processes, 100000 component iterations / 20000 warmup and
HTTP 1000 ms / 500 ms warmup / concurrency 32. Fixture divisors remain task 01's:
router lookup and warm/transient DI use full counts; constructors/metadata/cold
DI divide by 5, body/dispatch by 30, registration by 1000. Each component batch
consumes a checked checksum. HTTP uses real loopback sockets and fully consumes
and validates every response inside timing. JSON payload is 46 bytes.

| Performance scope | Fixtures / metrics | Final interpretation |
| --- | --- | --- |
| Router | 24 rows, including 10/100/1000-route registration; ns/op or ns/table, RSS/heap observations | Unmeasured on both runtimes; no index or allocation claim |
| Request | 5 constructor/metadata/body rows; ns/op | Unmeasured on both runtimes |
| DI | 9 value/warmed/cold/scoped/transient/graph rows; ns/op | Unmeasured on both runtimes |
| Dispatch | 10 booted direct-dispatch rows; ns/op | Unmeasured on both runtimes |
| Original HTTP | static, param, wildcard, middleware, json, di, static-file, post-json; req/s and p50/p95/p99 ms | All eight unmeasured on both runtimes |
| Targeted HTTP | async, query, metadata, class-warm, factory-warm, middleware-20, static-listeners, middleware-listeners; same metrics | All eight unmeasured on both runtimes |

Task 01's only eligible control was one complete Bun 1.4.2 five-pair A/A run.
Its existing envelopes remain unchanged: router 8.12–85.69%, request
31.02–46.48%, DI 14.26–45.22%, dispatch 21.95–80.30%, HTTP throughput/p95
5.00–29.77%. Across all 112 metrics including HTTP p50/p99, 53 exceed 20%.
Both complete minimum-runtime A/A runs were excluded for outside load; they
establish no minimum envelope. See [protocol](../01/README.md) and
[variability.csv](../01/variability.csv). No cross-runtime envelope was borrowed.
No eligible envelope or threshold was replaced or loosened.

Without a retained change, component-vs-HTTP interactions cannot establish an
optimization benefit. Missing timings are not zero change, zero latency or a
passed HTTP nonregression test. No repeatable >5% regression has been established
by the final check; this is not measured proof of HTTP nonregression. Exact
production equality establishes the absence of an implementation delta.

## Historical gate

`bun run bench:check` retains its original default **1000 ms × 64 concurrency ×
three median-selected runs**, 500 ms warmup, original eight scenarios and Apple
Silicon baseline. Its historical baseline was recorded on a different macOS
arm64 / 16-core machine at 3000 ms × 64 with Bun 1.4.0. The stricter new harness's
full-body consumption and concurrency differ, so its numbers cannot replace the
historical gate or be compared as like-for-like throughput.

Both final historical attempts exhausted their quiet waits without launching
`bun run bench:check`. Neither gate passed or failed; recorder exit 2 records a
quiet timeout, and no gate exit code exists. No final scenario throughput or
p95 values were measured. All times below are UTC on 2026-09-08.

| Attempt | Start–finish UTC | Gate status | Recorder exit / gate exit | Blocked samples / total; peak outside CPU |
| --- | --- | --- | --- | --- |
| `historical-142` | 08:38:44.226–08:43:44.471 | **NOT RUN** | 2 / none | 149/149; peak 214.90% |
| `historical-140` | 08:43:44.562–08:48:44.832 | **NOT RUN** | 2 / none | 149/149; peak 214.95% |

Both windows had zero quiet samples in succession and no measured phase.
Complete records: [current status](historical-142/status.json.gz),
[current load](historical-142/load.jsonl.gz),
[minimum status](historical-140/status.json.gz),
[minimum load](historical-140/load.jsonl.gz).
[measurement-summary.jsonl](measurement-summary.jsonl) distinguishes recorder
exits, workload launch/exit, timed rows and actual gate status for all four attempts.


Task 01's original Bun 1.4.2 historical gate **actually failed all eight scenarios,
exit 1**, with three measured outside-load samples. Preserve that failure and
its noise separately from the machine mismatch and any final NOT RUN statuses:
[original status](../01/historical-142/status.json),
[full failed output](../01/historical-142/stdout.log),
[load samples](../01/historical-142/load.jsonl).
Neither machine mismatch nor noise converts the failure to a pass or identifies
a production regression. Task 03's historical142 quiet timeout also remains
NOT RUN. No gate was rebaselined or rerun to seek a favorable outcome.

## Integrated correctness and delivery checks

Every install/test/build/behavior workload ran under
`python3 /tmp/zebra-performance-speedup-f3263289/run-load.py check`.
Every timed attempt used its `measure` mode. No wrappers were nested.
All repository checks finished before this worker began final timing attempts.
Documentation/type/style checks run after final documentation edits in a new
check allocation. Shared baseline/runtime resources remain coordinator-owned.

| Check | Bun 1.4.2 | Bun 1.4.0 | Durable evidence |
| --- | --- | --- | --- |
| `bun install --frozen-lockfile` | Pass, exit 0 | Pass, exit 0 | `install-142/140.log.gz` |
| Full integrated `bun run test` | **1382 pass, 0 fail**, exit 0; coordinator run reused | **1382 pass, 0 fail**, exit 0; actual task-06 run | [current log](coordinator05-test.log.gz), [current manifest](coordinator05-manifest.json.gz), [minimum log](full-test-140.log.gz) |
| `bun run build` | Pass, exit 0 | Pass, exit 0 | `build-142/140.log.gz` |
| `bun run verify:packages` | 12 packages pass, exit 0 | 12 packages pass, exit 0 | `packages-142/140.log.gz` |
| Core coverage tests | 688 pass / 17046 assertions, exit 0 | 688 pass / 17046 assertions, exit 0 | `coverage-142/140.log.gz` |
| `bun run check:coverage` | 2389/2417 lines, 98.84%, exit 0 | 2389/2417 lines, 98.84%, exit 0 | `coverage-gate-142/140.log.gz`; threshold stays 90% |
| Immutable all-suite `--check`, baseline and integrated roots | 64 fixture checks per root pass, exit 0 | 64 fixture checks per root pass, exit 0 | `baseline-harness-*` / `integrated-harness-*.log.gz` |
| Client / contract browser target bundles | Pass, zero Bun references, exit 0 | Pass, zero Bun references, exit 0 | `browser-client-*`, `browser-contract-*`, `browser-scan-*.log.gz` |
| Final `bun run typecheck` / `bun run lint` | Pass, exit 0 / 0 | Pass, exit 0 / 0 | `final-typecheck-*` / `final-lint-*.log.gz` |
| Final `DOCS_BASE=/zebra/ bun run docs:build` | Pass, exit 0 | Pass, exit 0 | `final-docs-142/140.log.gz`, after the final doc edit |
| `git diff --check HEAD` | Pass, exit 0 | Pass, exit 0 | `final-diff-142/140.log.gz`; staged final delivery check also retained |

The current full test reuse is based on the actual unchanged integrated revision
and test bytes, not just matching production: [source-before.jsonl](source-before.jsonl)
verifies every integrated test file against `5530f767`. Its full log contains all
66 new regressions. No passing current full test was repeated unnecessarily.
Minimum-runtime worker focused 625/625 passes are retained as history but did not
replace the required actual integrated 1382-test minimum run.

The core coverage runs include all 66 new regressions. Builds preserve src-direct
publication: package verification packs/installs/imports/typechecks all 12
packages; client/contract browser output is scanned for `Bun` and `bun:`.
Browser bundle hashes are in scan logs. Existing router/fuzz/WebSocket, metadata
snapshot/signal/body, DI scope/cycle/cache/disposal, pipeline/thenable/timeout/
HEAD/OPTIONS/cookie/listener/drain coverage runs in the full suites. This task
changes no test expectation or ordinary product behavior.

## Failures retained and triage

These outcomes are historical gates, not all-green candidate validation. All
store failures below occurred at the initial size assertion expected **1200**,
**before the explicit 80 ms sleep**. The test sets a 50 ms real-time TTL and awaits
1200 `set` calls; `set` uses `Date.now()` and sweeps expired entries. Expiry during
insertion is consistent with the source and observations, but insertion duration
was not measured. Listed milliseconds are **total individual-test duration**,
not insertion time. CPU contention, scheduling, GC and clock effects were not
independently attributed; the exact cause remains unconfirmed.

| Run | Actual outcome | Store entries / total test duration | Evidence |
| --- | --- | --- | --- |
| Coordinator03 initial full | **1329 pass, 1 fail**, exit 1 | 597 / 1200; 84.77 ms | [original full log](coordinator03-first-test.log.gz), [manifest](coordinator03-first-manifest.json.gz) |
| Task03 focused triage on task source | 33 pass, 0 fail | Assertion passed | [log](store03-triage-task-store.log.gz) |
| Task03 focused triage on frozen baseline | 33 pass, 0 fail | Assertion passed | [log](store03-triage-baseline-store.log.gz), [commands](store03-triage-commands.json.gz) |
| Coordinator03 one justified full retry | 1330 pass, 0 fail, exit 0 | Passed | [log](coordinator03-retry-test.log.gz), [manifest](coordinator03-retry-manifest.json.gz) |
| Task04 current candidate full | **1340 pass, 1 fail** | 836 / 1200; 65.35 ms | [log](../04/repository-142-02.log.gz) |
| Task04 one store-file rerun | **32 pass, 1 fail** | 755 / 1200; 61.36 ms | [log](../04/store-rerun-142-01.log.gz) |
| Task04 unchanged-baseline focused run | **33 pass, 0 fail** | Assertion passed | [baseline log](../04/baseline-store-142.log.gz), [manifest](../04/baseline-store-142.jsonl), [source identity](../04/store-source-identity.jsonl) |
| Coordinator04 integrated full | 1355 pass, 0 fail, exit 0 | Passed | [log](coordinator04-test.log.gz), [manifest](coordinator04-manifest.json.gz) |
| Task05 dispatch-only candidate focused | **624 pass, 1 fail**; remaining batch checks did not run | 1069 / 1200; 52.00 ms | [log](../05/candidate-v2-focused-142.log.gz) |
| Task05 rebased current focused | **624 pass, 1 fail**, exit 1 | 795 / 1200; 74.27 ms | [log](worker05-integration-focused-142.log.gz), [summary](worker05-integration-summary.json.gz) |
| Task05 rebased minimum focused | 625 pass, 0 fail, exit 0 | Passed | [log](worker05-integration-focused-140.log.gz) |
| Coordinator05 integrated current full | 1382 pass, 0 fail, exit 0 | Failed focused scope included and passed | [log](coordinator05-test.log.gz) |
| Task06 integrated minimum full | 1382 pass, 0 fail, exit 0 | Passed | [log](full-test-140.log.gz) |

The task03 [investigation](store03-triage-REPORT.md.gz) and
[byte audit](store03-triage-byte-audit.json.gz) prove unchanged store/test bytes
across baseline, task-01 and integrated revisions. It found no metadata-test
clocks, globals or import interaction; the failed store test was reported before
the nine added metadata tests. Both isolated source-root runs passed, followed
by the single coordinator-authorized full retry. Its report is a preserved
historical integration-hold snapshot; the later retry/integration results above
record the subsequent outcome without rewriting it.

Task04's independent baseline-focused run also passed. Thus **a baseline failure
was not reproduced**. Source equality and wall-clock sensitivity support keeping
these as known intermittent unchanged-test failures; neither proves a particular
cause or erases failed gates. Store source SHA-256 is
`343aef568179ab1db9e1ea16c7cf7ad26a2b2a5489fb180aed03e26cf6d8c23d`;
test SHA-256 is `1f663f6355337c9bf00175bcb807b47de9cc5fb51d8b389c49a52c6990a62b1a`.
This task independently verified both and made no store correction or retry.

Separately, task05's initial compose compatibility regressions are actual
candidate defects, with two failures on **both** runtimes. The rejected compose
patch is not retained in production. Task02/03 candidate full gates passed on
both versions; task04 minimum candidate full passed; task05 restored-source full
passed on both. Those records do not relabel the failed candidate/focused gates
or stand in for the final integrated minimum full test.

## Evidence retention, reproduction and handoff

[REPRODUCE.md](REPRODUCE.md) rebuilds independent frozen archives and runtime
selection without relying on shared `/tmp` resources surviving cleanup. It
preserves one absolute committed harness, source-root identities, immutable
recorder/series, quiet rules, paired settings and original historical defaults.
The user-facing benchmark guide links these commands and accurately scopes the
negative/inconclusive result while retaining every prior historical section.

[external-evidence.jsonl](external-evidence.jsonl) records origin paths and raw
hashes for compact integration records copied into this directory, including
`/tmp/zebra-performance-speedup-05-integration-d04aeaf`, coordinator
`verify-05-5530f767`, coordinator03 original/retry, coordinator04 and the task03
store investigation. They are retained as gzip preserving every uncompressed
byte. The original task reports and their raw failures remain in results/02–05.
The coordinator may separately archive its full review records under
`results/coordinator` after integration; this report does not depend on future
files or temporary paths for its claims.

[source-after.jsonl](source-after.jsonl) repeats the byte audit after all windows;
production, integrated tests, timed harness, original benchmark files and locks
remain unchanged. [evidence-index.jsonl](evidence-index.jsonl) indexes every
retained validation/measurement artifact with compressed and uncompressed hashes.
`archive-evidence.py` archives completed recorder files as gzip without changing
their raw bytes, avoiding ignored logs or diagnostic formatting changes.
[delivery-audit.jsonl](delivery-audit.jsonl) verifies log hashes, local links,
exclusive file ownership and byte-for-byte preservation of the historical
benchmark README prefix. Final documentation/type/style/whitespace exits are
recorded in [checks.jsonl](checks.jsonl); no passing full test was repeated.
The task-06 todo is archived in `todos/done/`; only its README status is updated.
Task 06 alone owns this report directory, `bench/README.md`, and its queue status
and todo archival. Other README pending statuses remain historical integration
snapshots for coordinator reconciliation. Saved `agent: inherit` and Codex
routing are unchanged. No master switch/edit, rebase, merge, push, PR, stash,
subagent or shared-resource cleanup was performed. The coordinator owns final
review/integration and later cleanup.

The material remaining limits are inconclusive performance, the historical
machine-specific failed gate, and the unresolved cause of intermittent
wall-clock-sensitive store assertions. Completion means a validated, documented
rejected/inconclusive evaluation; it is not an implemented optimization.
