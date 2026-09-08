# Router lookup evaluation

**Decision: exclude the static index; performance evidence is inconclusive.**
Both allowed Bun 1.4.0 router A/A attempts timed out before a benchmark started.
There is no eligible minimum-runtime router envelope, so the candidate cannot
meet the adoption criteria. The final production source is restored byte-for-byte
to the planning baseline. Five useful compatibility/fuzz tests remain. This task
makes no router speedup, HTTP nonregression, or registration-cost claim.

## Candidate and compatibility

The candidate added a map from normalized, still-encoded fully static paths to
existing radix terminal method tables. Successful static hits returned fresh
null-prototype parameters; absent paths or methods fell back to the original
radix walk. The original slash regexp, percent decoding, wildcard handling and
`allowedMethods` traversal were preserved. No request-path cache was added.

Source inspection bounds additional keys by successful static registrations.
The unchanged 10/100/1000-route fixtures would add 8/98/998 path keys and terminal
table references, without duplicating handler tables. This is a storage-bound
inspection, **not a retained-memory or allocation measurement**. Registration
ns/table, RSS and heap costs remain unmeasured because no timed process started.
Cheaper edge trimming and percent-decode skipping were not pursued without
independent evidence. The entire production patch was removed.

The retained tests cover:

- Raw encoded spelling/case, encoded separators, malformed static/captured
  escapes, interior empty segments and leading/trailing slash equivalence.
- Method fallback from a static path to method-specific parameters or wildcards,
  custom methods, empty wildcards, precedence and exact `allowedMethods` order.
- Root routes, normalized duplicate detection, falsy/undefined handlers and
  independent, mutable null-prototype parameter objects.
- A bounded route-list reference model over four fixed seeds and 1,400 queries,
  comparing both matching and method order against the router. The same router
  and fuzz test files were also run against the read-only baseline router in a
  separate Bun process; their generated source snapshots are retained as gzip.

Existing HTTP HEAD/OPTIONS/405, WebSocket and harness booted-dispatch/listener
controls passed. No app, dispatch, request, DI, WebSocket implementation, public
API, package, dependency, runtime, shared fixture, threshold or baseline changed.

## Bounded measurement outcome

The initial protocol is retained in [initial-protocol.md](initial-protocol.md).
The shared recorder and series were used unchanged, with a 30-second quiet
window, 300-second quiet-wait limit, and whole-comparison exclusion for any
sampled outside process using >=15% of one core or a competing workload.

| Requested control | Result | Quiet samples with outside flags | Longest quiet streak |
| --- | --- | ---: | ---: |
| `aa-140-router-1` | Quiet timeout; zero benchmark processes/rounds | 142/149 | 5 samples (15 required) |
| `aa-140-http-1` | Own queued wrapper cancelled before allocation; no recorder started | Not sampled | Not sampled |
| `aa-140-router-2` | Quiet timeout; zero benchmark processes/rounds | 149/149 | 0 samples |

The first router attempt ran 2026-09-08 06:32:49–06:37:50 UTC; the second ran
07:25:16–07:30:18 UTC. Their complete, untouched recorder status and load records
are retained under the corresponding directories as `.json.gz` / `.jsonl.gz`.
Peak sampled host busy percentages were 88.96% and 99.94%. The first attempt
flagged Python check wrappers as well as active outside work; the second observed
active outside Bun processes and processes flagged as competing workloads. No unrelated process was stopped and no load
sample was discarded. Quiet timeouts created no timing stdout/stderr files.

The queued HTTP wrapper was cancelled to let pending checks progress, before a
recorder or benchmark child existed. It is conservatively charged as HTTP
attempt 1; [queue-events.jsonl](queue-events.jsonl) retains that bookkeeping.
After the second router timeout exhausted that control's allowance, the missing
required router envelope already prevented adoption. Following the coordinator's
scheduling instruction, HTTP attempt 2 and all candidate confirmations were left
**unmeasured** and the production candidate was restored.

Consequently there are no before/after timing rounds on either runtime, no
booted-dispatch or HTTP timing result, and no numerical registration time/memory
comparison. Passing behavior checks does not fill those gaps. This is an
inconclusive evaluation, not evidence that the candidate is faster or slower.
The existing eligible Bun 1.4.2 envelopes in
[results/01/variability.csv](../01/variability.csv) were neither replaced nor
loosened; no Bun 1.4.0 envelope was invented or transferred from 1.4.2.

The still-pending control driver was changed before starting, as the coordinator
requested, to release its exclusive lock after **one** recorder attempt. No
active recorder was interrupted. No historical gate was scheduled: task 01
already records its failed machine-specific gate and task 06 owns the final gate.

## Source, runtime and commands

| Identity | Value |
| --- | --- |
| Baseline | `a856cab47d4fd3102e976ce7a70166837837eea2` |
| Integrated task 01 / task starting HEAD | `609c1d298393c49b49e6c11537e55437c5f6a89f` |
| Temporary candidate commit, later amended | `2ed3996c58fb9ce2cd7593f99d156be9e12d3095` |
| Baseline/restored production SHA-256, 80 files | `7a9eb1077326654812aabcad8519086ce61b28350a6160582ec01cbce90c9b73` |
| Candidate production SHA-256, 80 files | `b3d3d0b4a873eaab6686a2b2fc1efeda6b073ec46219919ef0c51e9f1d14393a` |
| Candidate router file SHA-256 | `e528e3db112a46895cc4f3aecefefe4c13ee82a89e9fbd627dadde6511ec47af` |
| Baseline/restored router file SHA-256 | `586f68db8245c575289e8bdaa577ab2780f6037df3196f15cae44cf866220644` |
| Combined harness SHA-256 | `b4a3feb23f5d26c8b6121d35e1b121b2b5ab6221b45a62ae4ddf42dd8a31a976` |
| Locked dependencies SHA-256 | `ece1a7458ab75446feadd1a013f9d6b8ca7b9d539ca39bc1384119591c2e31f1` |

`candidate-commit.txt` names the temporary candidate commit (never timed).
`candidate.patch.gz` preserves the exact rejected production diff against task 01;
`identity-probe.jsonl` records file hashes and byte equality with the immutable
harness commit. The harness's wildcard Git diff listing omitted the uncommitted
router edit in the initial correctness run, although its production fingerprint
correctly identified the candidate. The temporary candidate commit anchors those
bytes independently. Final source checks also compare all 80 explicit production
paths against the baseline, avoiding that wildcard limitation.

Harness: `/home/ubuntu/workspace/zebra/bench/hot-path.ts`.
Protocol: `/home/ubuntu/workspace/zebra/plans/performance-speedup/results/01`.
Shared read-only baseline: `/tmp/zebra-performance-speedup-01/baseline-a856cab`.
Candidate/final checkout:
`/home/ubuntu/.herdr/worktrees/zebra/herdr-plan-performance-speedup-02-router`.
Both source roots use frozen dependencies and absolute source-root imports.

Bun 1.4.2 is `/home/ubuntu/.bun/bin/bun`, revision
`744846f844374847c902b5e7fd59b4342a51ef99`. Bun 1.4.0 is
`/tmp/zebra-performance-speedup-01/runtime/bun-1.4.0/bun`, revision
`34cbb9a40b4bd1bd767d134a7065e66c2432a676`. Its directory was prepended to PATH
for checks, requested controls and subprocesses. Hardware: Linux x64, AMD EPYC,
8 logical CPUs, 16,760,184,832 bytes RAM. Actual runtime, source paths, hashes,
commands and hardware appear in the all-suite correctness logs.

Every workload used `/tmp/zebra-performance-speedup-f3263289/run-load.py`:
`check` for all installs/tests/builds/behavior checks, `measure` for recorder
attempts. No lock wrappers were nested. `checks.jsonl` records every check command,
PATH, timestamps, exit and complete gzip log for the instrumented groups. The
initial install log is also retained, without instrumented timestamps. The first control directly invoked
`measure.py` with `series.py`; the second used `comparisons.py controls` to invoke
those same files once. The second allocation used:

```sh
env PATH=/tmp/zebra-performance-speedup-01/runtime/bun-1.4.0:$PATH \
  python3 /tmp/zebra-performance-speedup-f3263289/run-load.py measure \
  python3 plans/performance-speedup/results/02/comparisons.py controls
```

The recorder status retains exact child commands. Both sides requested the
unchanged baseline, suite `router`, with the committed series defaults: five
alternating AB/BA pairs, 100000 iterations, 20000 warmup, HTTP 1000/500 ms and
concurrency 32. No Bun timing subprocess reached those steps.

## Validation and retained evidence

| Check on the candidate | Bun 1.4.2 | Bun 1.4.0 |
| --- | --- | --- |
| Frozen install, typecheck, lint, build | Pass | Pass |
| Full repository tests | 1321 pass, 0 fail | 1321 pass, 0 fail |
| Package verification, docs build | Pass | Pass |
| Core coverage tests / 90% gate | 627 pass; 98.85% | 627 pass; 98.85% |
| Browser client/contract bundles | Pass; no Bun runtime references | Pass; no Bun runtime references |
| Focused router/fuzz/HTTP-method/WebSocket tests | 65 pass, 0 fail | 65 pass, 0 fail |
| Same compatibility tests on baseline router | 22 pass, 0 fail | 22 pass, 0 fail |
| Harness tests | 15 pass, 0 fail | 15 pass, 0 fail |
| All-suite harness correctness, both roots | Pass | Pass |

These full gates were run once per runtime on the candidate and are not being
repeated after exclusion. Their logs are `candidate-full-142/140-*.log.gz`;
focused records are `candidate-142-*` and `candidate-focused-140-*`.
The initial test-only type narrowing and `delete` lint failures are retained in
`candidate-142-06/07.log.gz`; both were fixed before the successful full gates.
No production correctness failure was found.

Final restored-source focused tests, all-suite harness correctness, typecheck,
lint, whitespace and explicit production-equality checks are recorded separately
by `final-checks.py` in `final-142/140-*.log.gz` and `checks.jsonl`.
Final validation **passed on both runtimes**: 65 focused tests each (5995
assertions), all-suite harness correctness, typecheck, lint and whitespace checks.
Both explicit 80-file production comparisons are empty, and both final harness
records report the restored production and unchanged harness fingerprints above.
The todo is archived as an evaluated, excluded candidate; coordinator integration
remains pending and explicitly coordinator-triggered.

`measurement-provenance.jsonl` indexes both recorder attempts; it contains zero
rounds and zero measured processes. `control-decisions.jsonl` records the missing
minimum controls. Gzip retains the original evidence bytes, including diagnostic
whitespace; decompress with `gzip -cd <file.gz>`. No timing file was edited.

`evidence-sha256.csv` records compressed and decompressed SHA-256 values for every
retained gzip artifact. All claimed check/load evidence is included in this task
commit; no ignored raw log is required to reconstruct it.
