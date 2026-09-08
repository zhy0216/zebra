# Cached DI resolution evaluation

**Rejected as inconclusive; no production optimization is retained.** Both
permitted Bun 1.4.0 DI controls exhausted their quiet-window attempts without
starting timed work. The required minimum-runtime envelope and confirmations
could not be established. The already-active Bun 1.4.2 candidate attempt also
finished normally as a quiet timeout. There is no measured speedup or HTTP
nonregression claim. Remaining cases are explicitly unmeasured.

`container.ts` is restored byte-for-byte to the production baseline. The task
retains 25 useful behavioral tests, the evaluated nine-line [candidate patch](candidate.patch),
and complete check/status/load evidence. Saved routing remains `agent: inherit`,
Codex / gpt-6-astra / max. Integration remains coordinator-owned.

## Candidate and compatibility

The candidate returned cached class/factory instances early only when the
resolution stack was empty. It still looked up the current binding first,
preserved the value-binding terminal path, used the original scope owner and
`binding.identifier` cache key, and used `Map.has` for falsy results. Nested
resolutions retained the original diagnostic path.

An unconditional cache return before cycle detection is unsafe: a lazy factory
can restore a snapshot containing an instance for its active frame, or change
its saved builder from transient back to singleton while an old cache exists.
The new tests demonstrate the existing `CircularDependencyError` behavior and
paths for these cases. The unconditional alternative was excluded by inspection;
only the guarded candidate was behavior-checked. No timing supports its adoption.

The new tests pass on original and candidate production and cover cached
`undefined`, `null`, `false`, `0`, objects and promises; constructor/factory
frequency; root/nearest-scope ownership; missing scopes and transients; request
isolation; rebind, local shadowing, mutable builders and snapshots; cold/lazy
cycles, distinct same-name tokens, unbound paths and stack restoration; cached
aliases/dependencies during concurrent disposal and newly resolved resources.
Existing focused DI/app tests cover the remaining disposal, boot and session
controls. No app, router, scope-creation, session-lifetime or public API code changed.

## Source and protocol provenance

Starting HEAD: `609c1d298393c49b49e6c11537e55437c5f6a89f` on
`herdr/plan-performance-speedup-04-di`. Candidate production was uncommitted;
its exact diff/hash is retained in `candidate.patch` and `candidate-source.jsonl`.

| Source | Production SHA-256 |
| --- | --- |
| Baseline `a856cab47d4fd3102e976ce7a70166837837eea2` | `7a9eb1077326654812aabcad8519086ce61b28350a6160582ec01cbce90c9b73` |
| Guarded candidate, only `di/container.ts` changed | `16970be75a0c2d9bb95124a6f322a31e123735602a89f35f282825b899349b92` |
| Final, restored production (all 80 files) | `7a9eb1077326654812aabcad8519086ce61b28350a6160582ec01cbce90c9b73` |

Shared baseline: `/tmp/zebra-performance-speedup-01/baseline-a856cab`, independently
frozen-installed by task 01 and used read-only. Harness:
`/home/ubuntu/workspace/zebra/bench/hot-path.ts`; protocol:
`/home/ubuntu/workspace/zebra/plans/performance-speedup/results/01`.
The full [task-01 README](../01/README.md) was read before timing attempts.
The timed files match `609c1d2` byte-for-byte, with required harness SHA
**`b4a3feb23f5d26c8b6121d35e1b121b2b5ab6221b45a62ae4ddf42dd8a31a976`**.
Lock SHA: `ece1a7458ab75446feadd1a013f9d6b8ca7b9d539ca39bc1384119591c2e31f1`.
No harness, fixture, original scenario, threshold, package, dependency, runtime
installation, lockfile or shared resource was changed.

Behavior records retain resolved source-root paths, source/harness fingerprints,
runtime and hardware (Linux x64, eight logical AMD EPYC CPUs, 16,760,184,832 bytes
RAM). Current executable: `/home/ubuntu/.bun/bin/bun` (1.4.2,
`744846f844374847c902b5e7fd59b4342a51ef99`). Minimum executable:
`/tmp/zebra-performance-speedup-01/runtime/bun-1.4.0/bun` (1.4.0,
`34cbb9a40b4bd1bd767d134a7065e66c2432a676`), with its directory prepended to PATH
for subprocesses. Both roots pass all-suite harness behavior on both versions.

## Bounded measurement outcome

Every measure hold covered one complete comparison or one quiet-window attempt
and released the lock afterward. The immutable recorder required 15 consecutive
two-second quiet samples, with a 300-second maximum wait. Any outside process
using >=15% of one core or a detected competing workload reset quiet progress.
Outside processes were never stopped. All three recorders finished normally.

| Attempt | Intended Bun | Outcome | Quiet samples / samples with outside load | Timed rows |
| --- | --- | --- | ---: | ---: |
| `aa-140-di-1` | 1.4.0 | Quiet timeout | 149 / 149 | 0 |
| `aa-140-di-2` | 1.4.0 | Quiet timeout; allowance exhausted | 147 / 147 | 0 |
| `candidate-142-di-1` | 1.4.2 | Already-active recorder allowed to finish; quiet timeout | 147 / 147 | 0 |

No attempt started a timed Bun process, so no paired timings, process medians,
component gains or HTTP statistics exist. The status field `interferenceSamples`
counts measurement-phase interference only; its zero value does **not** mean the
quiet phase was uncontaminated. All 443 retained quiet samples detected outside
load. Each directory contains the complete `status.json` and `load.jsonl`;
stdout/stderr files are not created by the recorder until a quiet window succeeds.

The minimum HTTP A/A controls, all minimum candidate comparisons, the second
current DI comparison, and all dispatch/HTTP comparisons remain **unmeasured**.
Thus warmed values/classes/factories/request/session scopes, cold construction,
transients and graphs have behavior evidence only; booted singleton/value routes
have behavior evidence only. The required two complete five-pair confirmations
and HTTP nonregression evidence were not obtained. No further cases were run
once the bounded minimum-runtime failure prevented adoption, following the
coordinator's stopping instruction.

`variability-142.csv` is an unchanged byte copy of task 01's eligible controls;
its envelopes were not replaced or loosened. `variability-140.csv` has no data
rows, and `controls-frozen.jsonl` records zero eligible minimum envelopes. No
current-runtime envelope was transferred to the minimum runtime.
`measurement-provenance.jsonl` indexes every attempt; `summarize.py` validates
and summarizes all available rows without dropping individual pairs.

The commands actually invoked were `measurements.py controls-140` and
`measurements.py candidate-142`. That driver called the shared `run-load.py
measure` once per immutable `measure.py` / `series.py` invocation; the exact
commands are retained in each status file. Preset series arguments remained five
AB/BA/AB/BA/AB pairs, 100000 iterations, 20000 warmup, HTTP 1000/500 ms and
concurrency 32. These settings never reached execution. The outer schedulers
were paused to prevent queuing further cases, then retired after their existing
children exited; those scheduler exits (143) are **not interrupted recorders**.
`scheduling.jsonl` retains the scheduling changes. Reports were prepared outside
measurement allocations. No historical gate was scheduled: task 01 owns the
existing `bench:check` evidence and task 06 owns the final gate.

## Checks

`checks.py`, `repository-checks.py` and `final-checks.py` were each invoked under
`python3 /tmp/zebra-performance-speedup-f3263289/run-load.py check`. Each manifest
records exact command, cwd, PATH, executable, HEAD, container hash (after the
initial reference run), exit, timestamps and raw-log SHA-256. All diagnostics
are retained byte-for-byte as `.log.gz`; read with `gzip -cd <file.log.gz>`.

`reference-142` tested the unchanged production with the 25 added tests.
The candidate was applied while `reference-140` was still queued; that run
checks candidate focused behavior plus the unchanged baseline harness. Its
manifest records the candidate container hash. Later candidate/minimum checks
cover the other source root. Passing full gates were not repeated.

| Candidate check | Bun 1.4.2 | Bun 1.4.0 |
| --- | --- | --- |
| Frozen install | Pass | Pass |
| Assigned focused suite | 106 pass; 419 assertions | 106 pass; 419 assertions |
| All-suite harness behavior, both roots | Pass | Pass |
| Typecheck / lint | Pass / pass | Pass / pass |
| Build / package verification | Pass / pass | Pass / pass |
| Full repository tests | **1340 pass, 1 fail** | 1341 pass, 0 fail |
| Core coverage / coverage gate | 98.84% / pass | 98.84% / pass |
| Docs build | Pass | Pass |
| Browser client/contract builds and Bun-reference scans | Pass, zero references | Pass, zero references |

The current-runtime full test failure is retained in `repository-142-02.log.gz`:
`packages/session/test/store.test.ts`, `sweep is budget-bounded per call for large
stores`. This unchanged test configures a **50 ms TTL**, fills 1200 entries via
awaited `set` calls, and asserts size 1200 **before** its explicit 80 ms sleep.
That assertion received 836. Bun reported **65.35 ms total test duration**; the
filling phase was not timed independently. Each `set` sweeps entries using
`Date.now()`. Expiry during insertion is an inference supported by that code and
failure, not a measured loop duration or proof of one particular host cause.
The store imports no DI code. `store-source-identity.jsonl` proves both the store
and its test match `a856cab` and the shared archive byte-for-byte.

The one worker store-file rerun also failed: **32 pass, 1 fail**, receiving 755
entries, with **61.36 ms total test duration** (`store-rerun-142-01.log.gz`). The
same focused suite was then executed on the unchanged shared baseline using
the same Bun 1.4.2 executable under the check lock: **33 pass, 0 fail**
(132 assertions, 1037.00 ms total suite duration, exit 0). The exact command was
`/home/ubuntu/.bun/bin/bun test packages/session/test/store.test.ts`, with cwd
`/tmp/zebra-performance-speedup-01/baseline-a856cab`. Stable evidence for other
tasks: [raw baseline log](baseline-store-142.log.gz),
[command/result manifest](baseline-store-142.jsonl), and
[unchanged source identities](store-source-identity.jsonl).
Store bytes were verified unchanged before and
after that read-only run. This does **not** establish a reproduced baseline
failure; the cause of the differing outcomes remains unconfirmed. The
wall-clock-sensitive assertion and every actual outcome are reported without
relabeling the failed full gate. Neither unrelated file was edited, and no
further store or full-suite reruns were made.

After restoring production, `final-source-142.jsonl` and
`final-source-140.jsonl` record **106 focused tests / 419 assertions passed**,
all-suite harness behavior passed, typecheck passed, lint passed and
`git diff --check` passed on each runtime. `final-source.jsonl` verifies the
restored production fingerprint. `delivery.jsonl` and `delivery-final.jsonl`
record passing unstaged and staged whitespace checks under the check lock.
`delivery-audit.json` verifies the retained diagnostic hashes, unchanged harness,
production, lockfile and current-runtime envelopes, and the permitted file scope.
The final change is the regression tests and
evaluation evidence only; task 04 is completed as a rejected evaluation, not an
implemented speedup. Remaining risks for coordinator review are the unmeasured
performance matrix and the unresolved current-runtime store-test discrepancy.
