# Request metadata evaluation

**Do not adopt the candidate.** Required controls and confirmations could not
start within the bounded quiet-window protocol. Performance is inconclusive;
the production edit is removed, with nine useful compatibility tests and the
complete evaluation evidence retained. No speedup or allocation gain is claimed.
See [PROTOCOL.md](PROTOCOL.md) for the prospective rules and subsequent coordinator
scheduling instructions.

## Candidate and compatibility

The evaluated candidate captures the original-case content type at construction
and derives and caches its lowercase form on first internal use through a prototype
getter. It changes only `packages/core/src/http/request.ts`; no body buffering,
dispatcher, dependency, runtime, fixture, baseline or threshold changes.

The optional signal candidate was not implemented or timed. A simple prototype
getter reading `this.raw.signal` would change the captured Request source after
middleware assigns `raw`, and would remove the existing enumerable own property.
A getter without a setter would additionally break signal assignment. TypeScript
`readonly` on the private implementation does not make the current runtime data
properties non-writable. Preserving those semantics requires extra instance
state/property setup; this evaluation keeps eager signal capture and makes no
signal performance claim.

Nine focused compatibility tests cover original/provided signal identity and
abort delivery before construction, before first read and after listener setup;
raw/signal assignment and public data-field spread; supplied URL/headers/params
identity; duplicate/prototype-safe query parsing and replacement; stable context;
supplied and one-time lazy IP; parser/limit snapshots after header mutation or
replacement; original-case multipart boundaries; and shared read-error mapping.
Existing helper, content-length, contract and timeout suites cover shared bytes,
failures, mixed parsers and exclusive stream ownership.

## Provenance and reproduction

- Task start/integrated harness revision:
  `609c1d298393c49b49e6c11537e55437c5f6a89f`.
- Original production revision: `a856cab47d4fd3102e976ce7a70166837837eea2`.
  The coordinator's independently frozen archive is
  `/tmp/zebra-performance-speedup-01/baseline-a856cab`, used read-only.
- Baseline production SHA-256:
  `7a9eb1077326654812aabcad8519086ce61b28350a6160582ec01cbce90c9b73`.
- Candidate production SHA-256:
  `f44988a94eb18ba625b1a511ac16ed42b694e94f115de5e851c9d47edd6de8d7`.
  It is the task start revision plus [candidate.patch.gz](candidate.patch.gz).
  [original-request.ts.gz](original-request.ts.gz) and
  [candidate-request.ts.gz](candidate-request.ts.gz) preserve exact source bytes.
- Immutable harness: `/home/ubuntu/workspace/zebra/bench/hot-path.ts`.
  Aggregate SHA-256:
  `b4a3feb23f5d26c8b6121d35e1b121b2b5ab6221b45a62ae4ddf42dd8a31a976`.
  This is task 01's combined harness/fixture fingerprint, not the individual
  `hot-path.ts` file hash. [source-before.txt](source-before.txt) retains both.
- Current runtime: `/home/ubuntu/.bun/bin/bun`, Bun 1.4.2 revision
  `744846f844374847c902b5e7fd59b4342a51ef99`.
- Minimum runtime: `/tmp/zebra-performance-speedup-01/runtime/bun-1.4.0/bun`,
  Bun 1.4.0 revision `34cbb9a40b4bd1bd767d134a7065e66c2432a676`.
  Its directory is prepended to PATH for checks and subprocesses.
- Host recorded by the harness: Linux x64, AMD EPYC, eight logical CPUs.
  Absolute source-root imports select actual production modules; check records
  confirm distinct baseline/candidate fingerprints and matching locks.

All workloads used `/tmp/zebra-performance-speedup-f3263289/run-load.py`.
These are the recorded commands, not authorization to repeat exhausted attempts:

```sh
python3 /tmp/zebra-performance-speedup-f3263289/run-load.py check \
  python3 plans/performance-speedup/results/03/checks.py baseline-142 --install
PATH=/tmp/zebra-performance-speedup-01/runtime/bun-1.4.0:$PATH \
  python3 /tmp/zebra-performance-speedup-f3263289/run-load.py measure \
  python3 plans/performance-speedup/results/03/controls.py
python3 /tmp/zebra-performance-speedup-f3263289/run-load.py check \
  python3 plans/performance-speedup/results/03/checks.py candidate-142 --full
python3 /tmp/zebra-performance-speedup-f3263289/run-load.py measure \
  python3 plans/performance-speedup/results/03/confirm.py
```

The three measurement orchestration scripts are retained as `*.py.gz`, with
their exact as-launched bytes. They document the original batch schedule; the
coordinator's later one-attempt-per-allocation rule supersedes that scheduling
for future work. The immutable task-01 recorder/harness was never changed.

The full-check command runs both runtimes sequentially, including a minimum
frozen install. A separately queued minimum check was cancelled before starting
to avoid concurrent install/build work in this worktree. It produced no workload
or measurement. Expanded commands, PATH, cwd, duration, exit and raw diagnostics
are in `*-commands.jsonl` and matching `*.log.gz` files. Measurement directories
retain the unchanged recorder's status, outside-load samples and any child
stdout/stderr byte-for-byte. Use `gzip -cd <artifact.gz>` to recover raw bytes.

## Controls and measurements

The existing eligible Bun 1.4.2 envelopes are copied byte-for-byte into
[controls-142.csv](controls-142.csv), with no replacement or relaxation. Every
request envelope is noisy (>20%): 31.02–46.48%. Every dispatch envelope is also
noisy: 21.95–80.30%.

All four prospective minimum-runtime attempts timed out at the preset 300-second
quiet-window limit with no timing started:

| Attempt | Result | Timed rows |
| --- | --- | ---: |
| `aa-140-request-1` | quiet-timeout | 0 |
| `aa-140-request-2` | quiet-timeout | 0 |
| `aa-140-http-1` | quiet-timeout | 0 |
| `aa-140-http-2` | quiet-timeout | 0 |

[controls-140.csv](controls-140.csv) therefore has no envelopes;
[controls-140-decision.txt](controls-140-decision.txt) fixes that decision before
candidate timing. No further control attempts are allowed. Samples include
outside Bun benchmarks and unrelated test/build activity, sometimes occupying
all CPUs. No unrelated process was stopped. Quiet timeouts are not benchmark
failures and provide no latency, throughput or allocation observations.

| Scheduled measurement | Result | Timed rows |
| --- | --- | ---: |
| `candidate-142-1`, request/dispatch/full HTTP | quiet-timeout | 0 |
| `candidate-142-2`, request/dispatch/full HTTP | quiet-timeout | 0 |
| `historical-142`, unchanged `bun run bench:check` | quiet-timeout; gate not launched | 0 |
| `candidate-140-1`, request/dispatch/full HTTP | quiet-timeout | 0 |
| `candidate-140-2` | Not scheduled after coordinator instruction | 0 |
| `historical-140` | Not scheduled; final gate belongs to task 06 | 0 |

The first minimum confirmation was already active when the coordinator directed
workers to conclude unsupported evaluations and avoid extra gates/diagnostics.
Only its parent scheduler was paused. The recorder continued normally to its
300-second timeout; only after recorder exit was the scheduler terminated,
releasing the measurement lock and preventing further launches. The outer
scheduler exit 247 reflects that deliberate scheduler stop, **not an interrupted
recorder or a measured failure**. [coordinator-scheduling.txt](coordinator-scheduling.txt)
retains that bookkeeping. All eight started recorder attempts finished normally
with quiet-timeout; none were interrupted or retrospectively excluded.

There are **zero timed rows and zero complete paired confirmations** on either
runtime. Constructor, metadata, body, booted dispatch, HTTP latency/throughput and
RSS/heap deltas are unmeasured. There is no HTTP nonregression or allocation
conclusion. The fixed target/envelope and >=4/5-direction rules cannot be
evaluated; passing behavior tests do not substitute for those requirements.
The intended lowercasing optimization is therefore excluded as inconclusive,
not described as a measured regression or ineffective implementation.

The historical gate did not run in this task, so it has no new pass/fail result.
Task 01's separately recorded actual Bun 1.4.2 gate failure (all eight scenarios)
remains in [results/01](../01/README.md); task 06 owns the final gate. Its original
Apple Silicon baseline and thresholds are unchanged.

[measurement-provenance.txt](measurement-provenance.txt) indexes all eight
attempts. `summarize.py` reads raw or gzipped records and reproduces that index;
it produces no round/heap CSV when there are no timed records. No zero-valued
performance data or invented envelope has been substituted for missing data.

## Validation of evaluated candidate

All entries passed on **both Bun 1.4.2 and isolated Bun 1.4.0**:

| Check | Result |
| --- | --- |
| Independent frozen worktree install | Pass, unchanged lock |
| Assigned semantic suites plus new metadata test file | 175 pass, 0 fail, 1211 assertions |
| Immutable harness `--suite all --check`, baseline and candidate | Pass |
| Root typecheck and lint | Pass |
| Build | Pass |
| Full repository tests | 1325 pass, 0 fail, 133262 assertions |
| Package pack/install/import/typecheck verification | Pass |
| Core coverage and gate | 2390/2418 source lines, 98.84%, threshold 90% |
| Documentation build, `DOCS_BASE=/zebra/` | Pass |
| Client/contract browser builds and Bun-reference scan | Pass |
| `git diff --check` | Pass |

The original production implementation also passed the initial eight new tests
alongside assigned semantic suites on 1.4.2 (174 tests total), all harness checks,
typecheck and lint before the candidate edit. Later coverage added the ninth
metadata test and extra supplied-signal early-abort cases. No passing production
check substitutes for the missing performance controls.

## Final delivered source

All production files match the integrated starting revision byte-for-byte.
The only implementation-adjacent addition is
`packages/core/test/http/request-metadata.test.ts`; the exact rejected production
patch remains compressed in this directory. The existing request, signal and
body implementations are retained. The todo is archived as a completed
inconclusive evaluation under the plan's rejection fallback, not an implemented
optimization.

After restoring production, `checks.py final-142` passed the assigned semantic
tests (175 tests, 1211 assertions per runtime), all-suite harness checks for both
roots, typecheck, lint and diff check sequentially on current and isolated minimum
Bun. The passing full candidate gates above were not rerun. Final statuses and
raw logs are retained in `final-*-commands.jsonl` and matching gzip files.
[artifacts.csv](artifacts.csv) records the compressed and recovered-byte SHA-256
for every compressed artifact, including all claimed validation logs.
