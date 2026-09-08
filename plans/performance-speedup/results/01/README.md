# Hot-path harness and unchanged-source controls

Task 01 adds measurement tooling only. Production baseline:
`a856cab47d4fd3102e976ce7a70166837837eea2`; planning commit:
`f3263289dd02131ed92751e72fb914df7d8f62ac`. Measurements and final check statuses
are recorded below when completed. No optimization is evaluated by this task.

## Source and harness selection

Invoke an **absolute path to one committed harness** for both sides. Each
`--source-root` invocation runs in a new Bun process. Core and router runtime
imports use absolute file URLs under that root; their production dependencies
are relative imports. The active checkout supplies type-only imports, the
unchanged `SCENARIOS`, and static fixture bytes. No runtime workspace alias
selects the tested core. Independent frozen installs keep the original gate's
workspace aliases within its checkout.

The first JSONL record identifies canonical source paths, Git revision or archive
revision, production SHA-256 (all 80 production files, including filenames),
uncommitted source diff names/hash, lockfile hash, harness revision/diff and file
hashes, Bun executable/version/revision, OS/CPU/memory/load and command. The final
record verifies that source and harness fingerprints remained constant. Archives
carry `.hot-path-source.json` with their original revision and file hashes, so an
altered archive reports exactly which files differ. The focused test executes an
altered router archive and verifies distinct process IDs, production hashes, and
its deliberate failure, then verifies current source still passes and removes
the test archive. `controlled-source-final-142.json` and
`controlled-source-final-140.json` retain that evidence. The test's deliberate
throw is inserted at the public `find` method opening, so later router body
optimizations do not invalidate the probe.

Retained baseline archive: `/tmp/zebra-performance-speedup-01/baseline-a856cab`.
It was created with `git archive a856cab47d4fd3102e976ce7a70166837837eea2 | tar -x -C <archive>`
and independently installed with `bun install --frozen-lockfile`. Its metadata
was made from `productionFiles(archive)` in `bench/hot-path-source.ts`.
This archive is shared read-only by later workers; do not edit it.

Current Bun: `/home/ubuntu/.bun/bin/bun` (1.4.2).
Isolated minimum Bun: `/tmp/zebra-performance-speedup-01/runtime/bun-1.4.0/bun`.
Prepend its directory to `PATH` for minimum-version commands **and subprocesses**.
The global runtime, package versions and lockfile remain unchanged. The
coordinator owns cleanup of `/tmp/zebra-performance-speedup-01` after task 06;
retain it through all worker comparisons. The harness creates no source exports
and never removes a supplied source root. Test-created temporary archives,
servers and readers are cleaned up on success and failure.

## CLI and bounded workloads

Required: `--source-root <absolute-checkout-or-archive>`.
`--suite router|request|di|dispatch|http|all` defaults to `all`.
`--check` runs probes and three operations per component without warmup, clocks,
or timed round records. Every suite validates outputs and propagates failures.
Unknown, duplicate, missing and out-of-range options fail before loading source.

| Control | Default | Allowed positive integers |
| --- | ---: | ---: |
| `--rounds` | 5 | 1–100 |
| `--iterations` | 100000 | 1–10000000 |
| `--warmup` | 20000 | 1–10000000 |
| `--duration-ms` | 1000 | 1–60000 |
| `--warmup-ms` | 500 | 1–60000 |
| `--concurrency` | 32 | 1–256 |

Component iterations/warmup are divided by the fixed fixture divisor (floor,
minimum one). Router lookup and warmed/transient DI use the full count;
request constructors/metadata and cold DI use /5; body/dispatch use /30;
router registration uses /1000. Resolved counts appear in each round. All
operations consume a numeric checksum and check workload results. Synchronous
lookups use a synchronous loop; a single outer promise is awaited per batch.

| Suite | Timed fixtures and boundaries |
| --- | --- |
| router | Exactly 10/100/1000 registered routes; static shallow/deep, parameter plain/encoded, wildcard, miss, method miss. Registration is a separate ns/table row with route count. Registration includes a final lookup. Precedence, method union/backtracking, empty wildcard, malformed encoding and slash normalization are untimed controls. |
| request | Constructor with supplied URL and constructor parsing URL, using fresh raw Requests/params (and supplied URLs) prepared before timing, no optional metadata access; metadata row includes fresh raw Request, query, context, signal, headers and lazy peer IP; JSON and shared JSON/text/body rows include fresh POST and the original `JSON_PAYLOAD` parsing/consumption (byte count in environment record). Supplied identity, abort, query overwrite and content-type snapshot controls are untimed. |
| di | Value; warmed singleton class/factory and nearest request/session scope; cold class/factory including fresh container and binding; transient class and three-level transient factory chain. Identity and invocation counts are checked. Non-disposable cold containers create no external resources. Falsy cache and scope ownership controls are untimed. |
| dispatch | Public `listen()` boots/compiles two apps before timing; direct `dispatch()` gets fresh Requests and fully consumes Responses. Sync Response (zero middleware), async handler, 5/20 middleware, query, metadata, warmed class/factory, and sync/5-layer paths with live request + middleware listeners. Distinct listener app keeps absence observable. |
| http | Same-process real `127.0.0.1` sockets, fresh fetches, persistent connections. All eight unchanged original scenario definitions plus six targeted cases (async/query/metadata/class/factory/20 middleware) and two listener cases. Full text/status verification is inside every timed request; record throughput and p50/p95/p99 through body completion. This stricter consumption and concurrency differ from the historical gate. |

Dispatch/HTTP have untimed error, HEAD, OPTIONS, 404, 405, Allow and HEAD stream
cancellation controls. Listeners are registered **after boot** and delivery is
checked. HTTP workers abort competing fetches/readers and settle all promises
after failure. All app instances stop even after setup, probe or output-writer
failure. The comparison recorder terminates only its own child processes on
interruption. No unrelated processes are stopped.

RSS/heap deltas accompany component rounds; they include runtime/GC effects and
are **not allocation counts**. There is no explicit GC. Router registration
memory deltas are observations across a batch of discarded tables, not precise
retained-index size; task 02 should inspect retained storage as well.

## Fixed comparison and variability protocol

These settings/rules were written before any A/A timings or candidate changes.
Use 100000 iterations, 20000 warmup, HTTP 1000 ms + 500 ms warmup, concurrency 32.
`series.py` fixes these controls, starts a fresh process per side per pair, and
runs five paired rounds in **AB, BA, AB, BA, AB** order. It annotates every raw
record with pair/side/order and retains child exits. Run **two complete
comparisons** per target suite and repeat two for `http`; `all` includes both.
Never select favorable fixture rounds, discard one slow side, or change settings
between sides. Use identical frozen dependencies, runtime, harness and fixtures.

All this queue's installs/tests/builds/behavior checks take the shared check lock;
all timing (including `bench:check`) takes the exclusive measure lock. Never nest
`run-load.py` invocations. The recorder requires 15 consecutive quiet 2-second
samples (30 seconds; maximum wait 300 seconds), then records outside load every
2 seconds. Any outside process >=15% of one core or detected competing
test/build/install/benchmark excludes the **entire comparison** from adoption.
Retain the complete run, marking it noisy. Quiet timeouts start no benchmark.
The rule is independent of result direction. At most two additional attempts
after interrupted/noisy comparisons; unresolved noise means inconclusive, not
indefinite reruns. `/proc` samples can miss short-lived activity and do not remove
VM scheduling, shared client/server, JIT, GC or timer uncertainty.

Assess A/A separately per runtime, fixture and metric. Record each side's median,
paired percent changes, median absolute paired change, and nearest-rank p90 of
absolute paired changes. The preset variability envelope is
`max(5%, p90 absolute A/A paired change)` across eligible complete A/A runs.
An envelope >20% marks a noisy control. A candidate needs an improvement greater
than this envelope **and** the plan target (10% component time or 5% HTTP), in
both complete confirmation comparisons, with >=4/5 pairs in the same direction
each time. Compare HTTP throughput and p95 individually. A repeatable >5%
regression in representative HTTP throughput or p95 (both comparisons, >=4/5
pairs each) rejects the candidate; larger variability means inconclusive, not a
waived regression. Inspect every row, including registration/metadata/body/
scoped/listener controls. Never infer HTTP gains from ns/op. Version-sensitive
changes require before/after on both 1.4.2 and 1.4.0.

### Prospective allowance for missing minimum-runtime controls

**No eligible Bun 1.4.0 envelope was established in task 01.** Both minimum
runtime runs completed all five pairs but were excluded for outside load. Their
numbers must not be used to invent a minimum-runtime envelope, and the 1.4.2
envelope must not be transferred to 1.4.0.

Before its **first candidate timing** on 1.4.0, each worker may establish one
focused unchanged-source A/A control for its target suite and one for the full
`http` suite, with the identical committed harness and fixed settings above.
This allowance is declared before workers/candidate timings start. Each control
has a limit of **two attempts total**, including quiet timeouts, interruptions
and contaminated runs. Stop after the first eligible complete control. Retain
both attempts if the first fails; use the preset load rule, never timing values,
to select eligibility. Do not replace or loosen an already eligible envelope.

Use the unchanged baseline archive for **both** sides of `series.py`: it still
starts ten distinct Bun processes in five alternating pairs, so no module graph
is shared. Verify both sides have baseline production fingerprint
`7a9eb1077326654812aabcad8519086ce61b28350a6160582ec01cbce90c9b73`, the same
harness fingerprint/runtime/lock and no source edits. Derive the per-fixture,
per-metric envelope from the five eligible pairs with the formula above; five
samples make nearest-rank p90 equal the largest absolute paired change. Save
the control, commands, envelope and eligibility decision in `results/NN/`
**before** the candidate comparison. The same fixed threshold then applies to
both candidate confirmation runs. A focused control does not cover other suites.
The shell variables below are defined in the Worker commands section.

```sh
export PATH=/tmp/zebra-performance-speedup-01/runtime/bun-1.4.0:$PATH
# Run target-AA-2 only if target-AA-1 is ineligible; two attempts maximum.
python3 "$LOCK" measure python3 "$PROTO/measure.py" --output "$OUT/target-AA-1" \
  python3 "$PROTO/series.py" --harness "$HARNESS" --before "$BEFORE" --after "$BEFORE" --suite "$SUITE"
# Independently, one eligible HTTP control; again two attempts maximum.
python3 "$LOCK" measure python3 "$PROTO/measure.py" --output "$OUT/http-AA-1" \
  python3 "$PROTO/series.py" --harness "$HARNESS" --before "$BEFORE" --after "$BEFORE" --suite http
```

If the attempt limit leaves either required control unsupported, or the later
two complete candidate confirmations do not provide eligible evidence, the
minimum-runtime performance decision is **inconclusive**. Do not claim or approve
minimum-runtime adoption from excluded controls, a current-runtime gain, or
passing behavior tests. Any change requiring minimum-runtime performance
evidence (including version-sensitive changes) must remain excluded from adoption
until the plan's evidence requirements are met; this allowance grants no
unbounded retries, fixture changes, reduced HTTP matrix or threshold waiver.

## Worker commands

Run from the worker's checkout. Replace `HARNESS` with the absolute **integrated
task-01** harness path, `AFTER` with that worker's absolute source root, and
`OUT` with a new results directory owned by that worker. `PROTO` points at this
committed report directory (the recorder does not modify it).

```sh
LOCK=/tmp/zebra-performance-speedup-f3263289/run-load.py
HARNESS=/absolute/integrated-checkout/bench/hot-path.ts
PROTO=/absolute/integrated-checkout/plans/performance-speedup/results/01
BEFORE=/tmp/zebra-performance-speedup-01/baseline-a856cab
AFTER=/absolute/worker-checkout
OUT=/absolute/worker-checkout/plans/performance-speedup/results/NN

python3 "$LOCK" check bun "$HARNESS" --source-root "$BEFORE" --suite all --check
python3 "$LOCK" check bun "$HARNESS" --source-root "$AFTER" --suite all --check

# SUITE: router for 02; request for 03; di for 04; dispatch for 05.
SUITE=router
python3 "$LOCK" measure python3 "$PROTO/measure.py" --output "$OUT/target-1" \
  python3 "$PROTO/series.py" --harness "$HARNESS" --before "$BEFORE" --after "$AFTER" --suite "$SUITE"
python3 "$LOCK" measure python3 "$PROTO/measure.py" --output "$OUT/target-2" \
  python3 "$PROTO/series.py" --harness "$HARNESS" --before "$BEFORE" --after "$AFTER" --suite "$SUITE"
python3 "$LOCK" measure python3 "$PROTO/measure.py" --output "$OUT/http-1" \
  python3 "$PROTO/series.py" --harness "$HARNESS" --before "$BEFORE" --after "$AFTER" --suite http
python3 "$LOCK" measure python3 "$PROTO/measure.py" --output "$OUT/http-2" \
  python3 "$PROTO/series.py" --harness "$HARNESS" --before "$BEFORE" --after "$AFTER" --suite http

# Minimum runtime: repeat with unique output directories.
export PATH=/tmp/zebra-performance-speedup-01/runtime/bun-1.4.0:$PATH
python3 "$LOCK" check bun "$HARNESS" --source-root "$AFTER" --suite all --check
```

The unchanged historical gate is a separate command:

```sh
python3 "$LOCK" measure python3 "$PROTO/measure.py" --output "$OUT/historical" bun run bench:check
```

Its default 1000 ms × 64 concurrency × three median-selected runs and original
Apple Silicon thresholds remain intact. A failure is reported as an actual
failed gate, separately from same-machine source comparisons; never re-record
`bench/baseline.json` to make it pass.

## Results and checks

Measurements were collected 2026-09-08 UTC (2026-09-07 America/Los_Angeles).
The timed harness commit is `a1b26b79d5439e62819fdc0dad3d6419d6e00397`, with
fingerprint `b4a3feb23f5d26c8b6121d35e1b121b2b5ab6221b45a62ae4ddf42dd8a31a976`.
The final task commit amends that commit to include evidence, documentation and
the coordinator's test-only probe fix; the three timed TS files are identical.
`measured-harness-commit.txt` and `measured-harness-blobs.txt` retain the original
commit/blob identities. Baseline and after-source have identical production
fingerprint `7a9eb1077326654812aabcad8519086ce61b28350a6160582ec01cbce90c9b73`.

| Run | Bun | Completed timed rows | Measured interference samples | Assessment |
| --- | --- | ---: | ---: | --- |
| `aa-142-1` | 1.4.2 | Partial, retained | 2 | Invalid initial checksum accounting; owned job interrupted. See `INVALID.md`. |
| `aa-142-2` | 1.4.2 | 640 | 0 | Eligible five-pair A/A control; initial quiet-window interference delayed timing. |
| `aa-142-3` | 1.4.2 | 640 | 9 | Complete, excluded in full for outside codex/rg CPU load. |
| `aa-140-1` | 1.4.0 | 640 | 19 | Complete, excluded in full for outside load. |
| `aa-140-2` | 1.4.0 | 640 | 6 | Complete, excluded in full for outside load. |

Each run directory retains complete `stdout.log`, `stderr.log`, `load.jsonl` and
`status.json`; the latter records exact command, cwd, timestamps, quiet rule,
exit and eligibility. Every child command/side/pair/order and actual executable
is retained in stdout. There are **2,560 final-harness timed rows**, plus the
invalid partial attempt, with no individual-round exclusions. The only eligible
control is one complete 1.4.2 comparison; this is a small control sample, not two
independent uncontaminated confirmations. Bun revisions:
`744846f844374847c902b5e7fd59b4342a51ef99` (1.4.2) and
`34cbb9a40b4bd1bd767d134a7065e66c2432a676` (1.4.0).
Hardware: Linux x64, AMD EPYC, 8 logical CPUs, 16,760,184,832 bytes RAM.

`summary.csv` retains all per-run medians, paired changes and median absolute
deviations, including explicitly ineligible runs. `variability.csv` contains
**only eligible control** envelopes: 1.4.2, five pairs per fixture/metric. HTTP
p50/p95/p99 are ms, throughput is requests/s; component `nsPerOp` is ns/op except
the named registration fixtures, where it is ns/table. `measurement-provenance.json`
indexes runtime/source/harness/eligibility for every attempt. Regenerate these
derived reports with `python3 summarize.py <this-directory>`.

Even without detected outside load, many component controls remain noisy:

| Suite | Median envelope across listed metrics | Envelope range | Envelopes >20% |
| --- | ---: | ---: | ---: |
| Router (24 fixture times) | 19.00% | 8.12–85.69% | 11/24 |
| Request (5 fixture times) | 37.32% | 31.02–46.48% | 5/5 |
| DI (9 fixture times) | 26.35% | 14.26–45.22% | 8/9 |
| Dispatch (10 fixture times) | 59.36% | 21.95–80.30% | 10/10 |
| HTTP (16 throughput + 16 p95 metrics) | 14.02% | 5.00–29.77% | 7/32 |

Across all 112 metrics (including HTTP p50/p99), 53 envelopes exceed 20%.
The largest component envelopes include 10-route registration (85.69%), dispatch
with listeners (80.30%) and metadata dispatch (73.11%). These are observed
unchanged-source fluctuations, not source regressions or optimization gains.
Small apparent gains in these fixtures are unsupported. Do not treat a quiet
process sample as proof of precise allocation or operation timing.

Development/check failures remain in the evidence:

- `initial-style.log.gz`: initial self-comparison and unsafe-finally lint errors;
  both fixed before the final timed harness.
- `checks-142-04.log.gz` / `checks-140-04.log.gz`: generated evidence JSON formatting,
  subsequently formatted; no production lint defect.
- `checks-142-09.log` / `checks-140-09.log`: an incorrect diagnostic tried to
  resolve core directly from bench, which depends on the zebra facade. The
  corrected diagnostic resolves facade from bench and core from facade, proving
  both frozen installs select their respective checkout. See the corrected and
  final validation logs.
- `aa-142-1`: invalid concurrent checksum accounting and actual interruption,
  with complete raw evidence; fixed before the four complete comparisons and
  covered by the concurrent body-accounting regression test.
- `delivery-check-initial.log.gz`: the staged whitespace check caught raw Biome
  diagnostic whitespace and the derived CSV writer's CRLF endings. The three
  affected raw diagnostics are retained byte-for-byte as gzip (logical original
  `.log` names remain in command manifests); derived CSV now uses LF. Decompress
  with `gzip -cd <file.log.gz>`. No raw timing record was changed.

The unchanged **`bun run bench:check` failed: exit 1, all eight scenarios FAIL**
on Bun 1.4.2. It ran once at its original 1000 ms × 64 concurrency × three-run
settings, after a quiet window, and recorded three outside-load samples during
measurement. The full actual output and load evidence are in `historical-142/`.
The Apple Silicon baseline is machine-specific, and this run is also noisy;
neither fact turns the failed gate into a pass or establishes a production source
regression. Production and the original benchmark code/data are unchanged.
The historical gate was not rerun on 1.4.0 in task 01; minimum behavior and A/A
results are reported independently above.

| Required check | Bun 1.4.2 | Bun 1.4.0 | Evidence |
| --- | --- | --- | --- |
| Frozen installs | Pass | Pass (worktree, isolated PATH) | `setup-142.log`, `baseline-setup.log`, `initial-checks-140.log` |
| `bun test bench/test` | 15 pass, 0 fail | 15 pass, 0 fail | `review-checks.jsonl` and associated logs; includes the coordinator's robust source probe |
| Focused core router/request/DI/app controls | 128 pass, 0 fail; 4795 assertions | 128 pass, 0 fail; 4795 assertions | `checks-142-06.log`, `checks-140-06.log` |
| All-suite `--check`, both roots | Pass | Pass | `checks-142/140-07/08.log`; final counter-fix and reviewed-test logs also run all-suite correctness |
| Root `bun run typecheck` | Pass | Pass | `final-checks.jsonl` |
| Root `bun run lint` | Pass, 295 files | Pass, 295 files | `final-checks.jsonl` |
| `git diff --check` | Pass | Shared Git tree | `final-checks.jsonl`, final delivery check |
| Original production/scenarios/gate/baseline/package/lock diff vs a856cab | Empty | Same source | `final-checks-08-142.log` (exit 0) |

The three timed TS files remain byte-identical to the measured commit. No
production, original fixture, package script, dependency, threshold or historical
baseline changed. Task 01's implementation acceptance is complete with the
documented noise/minimum-runtime limitations; it makes no speedup claim.
The coordinator still owns integration and subsequent repository-wide checks.
**Workers 02–05 may start only after task 01 is integrated.**
