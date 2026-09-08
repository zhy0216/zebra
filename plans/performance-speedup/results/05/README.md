# Dispatch forwarding evaluation

**No production optimization is adopted.** The middleware promise shortcut changes
observable error behavior on both supported Bun versions. The remaining dispatch
candidate is inconclusive: both allowed minimum-runtime dispatch controls exhausted
the quiet-window wait without starting any timed process. All production source is
restored to task-01 commit `609c1d298393c49b49e6c11537e55437c5f6a89f`.
The delivered change adds 27 compatibility tests and retains the rejected patches,
all attempts and complete check output. It does not claim a speedup or HTTP
nonregression. Final-source checks pass on Bun 1.4.2 and isolated Bun 1.4.0.

## Candidate decisions

The initial candidate removed forwarding async functions in ordinary dispatch,
called the terminal directly without middleware, and replaced async forwarding in
`compose` with `Promise.resolve` plus synchronous-throw conversion. It retained
awaited response conversion and the existing feature-aware scope/deadline logic.

The same two tests failed on both runtimes: **621 pass, 2 fail, 118999 assertions**
per run. When middleware or the terminal returns a fulfilled native promise with
a throwing own `then` getter, the shortcut returns that promise directly. Awaiting
it succeeds instead of observing the accessor error. The tests observed
`undefined` instead of the original error. This is an actual compatibility
regression, sufficient to reject the shortcut before timing.

`candidate-focused-142.log.gz` and `candidate-focused-140.log.gz` preserve those
complete runs. `candidate-initial.patch.gz` is the first production patch;
`candidate-initial-formatted.patch.gz` is the formatted version used in the tests.
`candidate-patches.jsonl` records the exact uncompressed patch hashes and parent.

Restoring `compose.ts` left a dispatch-only candidate, preserved in
`candidate-app-only.patch.gz`. Its Bun 1.4.2 focused suite passed all added tests
but stopped at an existing session-store assertion: **624 pass, 1 fail, 119001
assertions**. `MemoryStore > sweep is budget-bounded per call for large stores`
expected 1200 initial entries and received 1069 at `store.test.ts:207`.
Bun's **52.00 ms is total test duration**, not separately measured insertion/setup
time. The test uses a 50 ms TTL; expiry during insertion is an inference and the
cause remains unconfirmed. The full failure is in `candidate-v2-focused-142.log.gz`.
The batch stopped before remaining candidate checks; they are not reported as
passing. This candidate received no performance measurements and is not retained.

The coordinator reported that [task 04](../04/README.md) saw a similar worker
failure (755/1200, 61.36 ms total) with identical store source/test hashes, while
its unchanged-baseline store suite passed 33/33. This does **not** reproduce a
baseline failure or establish the cause here. No duplicate baseline investigation
was run. The supplied baseline log (33 pass, 0 fail, 132 assertions; 1037 ms
suite duration), command metadata and source identity are copied byte-for-byte
as `task04-baseline-store-142.log.gz`, `task04-baseline-store-142.jsonl` and
`task04-store-source-identity.jsonl`. `external-evidence.jsonl` records their
origin and hashes; the uncompressed baseline log SHA-256 is
`7323ddab6ed83284ba210f2411f5ecfe3ba2d7d97efe594fc8197c3b5e27270b`. Task 05's final focused and full suites subsequently passed on both
runtimes. Integration validation remains the coordinator/task-06 gate.

Initial style diagnostics and a driver bookkeeping error are also retained.
Intentional thenable tests needed narrow Biome suppressions. The original batch
then counted Bun's duplicate failure-summary lines twice; manual review confirmed
the two distinct compatibility failures before restoring `compose`. No failure
log was rewritten. `execution-notes.jsonl` records these details and the explicit
correction concerning the store test's total duration.

## Bounded controls and unmeasured cases

The full [task-01 protocol](../01/README.md) was read before any candidate timing.
Its existing eligible Bun 1.4.2 envelopes remain unchanged. No eligible Bun 1.4.0
envelope existed. Task 05 used exactly the allowed two prospective dispatch A/A
attempts, with the baseline selected for both sides and minimum Bun prepended to
PATH. Neither attempt obtained 15 consecutive quiet samples. Each had only one
consecutive quiet sample at most.

All times below are UTC on 2026-09-08. Outside CPU is percent of one core.

| Attempt | Start–finish | Result | Blocked load samples | Maximum outside CPU | Timed processes / rounds |
| --- | --- | --- | --- | --- | --- |
| `aa-140-dispatch-1` | 07:41:26.535–07:46:27.383 | quiet-timeout, exit 2 | 147 / 148 | 218.81% | 0 / 0 |
| `aa-140-dispatch-2` | 07:47:48.990–07:52:50.736 | quiet-timeout, exit 2 | 148 / 149 | 261.88% | 0 / 0 |

Each attempt’s full status/load records are retained as byte-preserving gzip files in
the attempt directories. The recorder's `interferenceSamples: 0` counts measured
interference; it does not mean the quiet wait was interference-free. No timed
phase began. No outside process was stopped and neither recorder was interrupted.

`minimum-control-decisions.jsonl` records both exclusions;
`minimum-envelopes.csv` contains only its header because no envelope was established.
`measurement-provenance.jsonl` records zero processes and zero round records.
There are no component cost or socket throughput/latency estimates to summarize.

| Required adoption evidence | Status |
| --- | --- |
| Bun 1.4.0 dispatch A/A | Both allowed attempts exhausted; unsupported |
| Bun 1.4.0 HTTP A/A | Unmeasured after required dispatch control failed |
| Dispatch confirmations 1 and 2, Bun 1.4.2 / 1.4.0 | All unmeasured |
| HTTP confirmations 1 and 2, Bun 1.4.2 / 1.4.0 | All unmeasured |
| Repeatable target gain above fixed variability | Not established |
| Repeatable HTTP throughput/p95 nonregression | Not established |
| Worker historical `bench:check` | Not scheduled; task 01 recorded it, task 06 owns final gate |

The coordinator's bounded stopping instruction applies: unsupported required
controls prevent adoption, so no extra HTTP, candidate or historical allocation
was scheduled. Task 01's unchanged historical gate failed all eight scenarios;
that historical machine-specific result is separate from this task's absence of
local dispatch and real HTTP performance evidence.

The unchanged series specifies five pairs in AB, BA, AB, BA, AB order, ten separate
Bun processes, 100000 component iterations and 20000 warmup iterations. HTTP uses
1000 ms measurement, 500 ms warmup and concurrency 32. The intended comparisons
cover all ten dispatch and sixteen HTTP fixtures: sync/async, 0/5/20 middleware,
listeners off/on, no-deps/DI and metadata-reading controls. No timed settings,
fixture, threshold or original scenario was changed. The unstarted confirmations
would require both runs to clear the fixed envelope and 10% component / 5% HTTP
target with at least four improving pairs each; a repeatable HTTP throughput or
p95 regression above 5% independently rejects adoption.

Every test/build/install/behavior workload used
`python3 /tmp/zebra-performance-speedup-f3263289/run-load.py check`.
Each control attempt used its own `run-load.py measure` allocation, released
between attempts. No lock wrappers were nested. The immutable recorder requires
30 quiet seconds, waits at most 300 seconds, and excludes a complete comparison
for any measured outside CPU >=15% or detected competing workload.
Each control decision was derived after its allocation released; no measurement
allocation was held solely for reporting.
`cancelled-waits.jsonl` records two owned, unstarted waits that were rescheduled;
neither consumed an attempt. `scheduling.jsonl` records the fairness adjustment
applied before this worker's first recorder started. No active recorder was
cancelled. Prepared `confirm.py` was never invoked.

## Final-source validation

All results below are actual task-05 checks. Full gates were run once per runtime
on the restored production source; no passing full gate was rerun.
`checks.jsonl` records exact commands, PATH, timestamps, exit codes, commit and
owned source/test hashes before and after each command. Every listed log is
retained in full as `<label>-142.log.gz` or `<label>-140.log.gz`.

| Check / log label | Bun 1.4.2 | Bun 1.4.0 |
| --- | --- | --- |
| Frozen install / `install` | Pass | Pass |
| Baseline all-suite harness behavior / `baseline-check` | Pass | Pass |
| Assigned focused suite / `final-focused` | 625 pass, 0 fail; 119005 assertions | 625 pass, 0 fail; 119005 assertions |
| Final all-suite harness `--check` / `final-harness` | 64 fixture checks pass | 64 fixture checks pass |
| `bun run typecheck` / `final-typecheck` | Pass | Pass |
| `bun run lint` / `final-lint` | Pass, 296 files | Pass, 296 files |
| `bun run build` / `final-build` | Pass | Pass |
| `bun run test` / `final-full-test` | 1343 pass, 0 fail | 1343 pass, 0 fail |
| `bun run verify:packages` / `final-packages` | 12 packages pass | 12 packages pass |
| Core coverage tests / `final-coverage` | 649 pass, 0 fail | 649 pass, 0 fail |
| `bun run check:coverage` / `final-coverage-gate` | 98.84%, threshold 90% | 98.84%, threshold 90% |
| `DOCS_BASE=/zebra/ bun run docs:build` / `final-docs` | Pass | Pass |
| Client/contract browser builds and Bun-reference scan / `final-browser-*` | Pass | Pass |

`git diff --check HEAD` also passes; `final-diff-all.log.gz` and its manifest
entry retain the result. Source/test bytes remained unchanged throughout all
final runtime checks.

The assigned focused command is:

```sh
bun test packages/core/test/app packages/core/test/middleware packages/core/test/contract packages/core/test/ws.test.ts packages/session/test packages/observability/test
```

The final commands were run by the named Python batch below so dormant lock waits
do not resemble active Bun workloads. Its children use the same inherited lock;
all minimum-runtime subprocesses inherit the minimum binary directory first in PATH.

```sh
python3 /tmp/zebra-performance-speedup-f3263289/run-load.py check \
  python3 plans/performance-speedup/results/05/run-checks.py final-complete 142
```

Added tests cover nested thenables, synchronous throws, rejected promises,
throwing accessors on thenables/native promises, awaited serialization, duplicate
`next()` during pending/throwing/rejected downstream work, short circuits, lazy DI,
original middleware function/index identity, live listeners before/after boot and
during dispatch, event-free eligibility after once listeners, and graceful drain
through handlers and completion hooks. Existing `fast-path`, `events`,
`response-completion`, `timeout`, HEAD/OPTIONS, error-cookie, session, contract and
observability tests remain intact. Normal streams, cancellation, disposal priority,
late rejections and scoped DI expectations are covered by those passing suites.

## Source and evidence provenance

Task branch: `herdr/plan-performance-speedup-05-dispatch`, based on
`609c1d298393c49b49e6c11537e55437c5f6a89f`. Both owned production files are
byte-identical to that commit, recorded in `final-source.jsonl`.
The final harness logs independently show all 80 production files with fingerprint
`7a9eb1077326654812aabcad8519086ce61b28350a6160582ec01cbce90c9b73` and an empty
production diff, matching baseline `a856cab47d4fd3102e976ce7a70166837837eea2`.

The independently installed, read-only baseline is
`/tmp/zebra-performance-speedup-01/baseline-a856cab`.
The immutable harness is `/home/ubuntu/workspace/zebra/bench/hot-path.ts`, with
recorder/series from `/home/ubuntu/workspace/zebra/plans/performance-speedup/results/01`.
Harness SHA-256:
`b4a3feb23f5d26c8b6121d35e1b121b2b5ab6221b45a62ae4ddf42dd8a31a976`.
`harness-verification.jsonl` verifies every constituent file against task 01.
The frozen lock SHA-256 is
`ece1a7458ab75446feadd1a013f9d6b8ca7b9d539ca39bc1384119591c2e31f1`.

Final harness headers record absolute imports from this worktree, the actual
runtime executables/revisions, and identical source/harness/lock fingerprints on
both versions. The current-runtime module diagnostic also explicitly verifies
workspace facade/direct core identity (`candidate-v2-identity-142.log.gz`).
Bun executables are `/home/ubuntu/.bun/bin/bun` (1.4.2) and
`/tmp/zebra-performance-speedup-01/runtime/bun-1.4.0/bun` (1.4.0).

`archive-evidence.py` compresses completed recorder files without altering their
uncompressed bytes and indexes all gzip evidence in `evidence-archive.jsonl`.
That index includes uncompressed lengths/SHA-256 and compressed SHA-256.
All logs and patches are explicitly retained in the task commit, including failed
and cancelled development attempts. No shared harness, fixture, baseline,
threshold, package, dependency, runtime configuration or other task source changed.
The remaining limitation is missing eligible performance evidence; the final
production source is unchanged. This is a completed rejected/inconclusive
evaluation, not an implemented optimization.
