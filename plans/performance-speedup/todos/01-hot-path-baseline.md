difficulty: hard
agent: inherit

# Reproducible hot-path harness and baseline

## T1 · Build source-selectable behavioral and performance fixtures

Read [plan.md](../plan.md), especially F1 and the measurement design, and inspect `bench/runner.ts`, `bench/scenarios.ts`, `bench/zebra-bench.ts`, `bench/bench-regression.ts` and the targeted core modules. Add a standalone harness for router, request construction, DI, dispatch, and real HTTP workloads. Its required interface is `--source-root <absolute-checkout>`, `--check`, and `--suite router|request|di|dispatch|http|all`. Validate options and document any round/duration/concurrency controls.

Load tested modules from the requested source root and run before/after in separate processes with the same committed harness. Do not silently resolve both sides through the active checkout's workspace package aliases. Boot dispatch fixtures before measurement; include body/status/identity checks and consume response bodies. Preserve the existing eight HTTP fixtures while adding separate targeted fixtures for warmed class/factory DI, metadata access, middleware depth, and listeners. Follow the bounded matrix in the plan; avoid a combinatorial benchmark expansion.

Expected files:

- New `bench/hot-path.ts` and `bench/hot-path-fixtures.ts` (split small internal helpers under `bench/` only if needed).
- New `bench/test/hot-path.test.ts` for option/source-selection/failure-cleanup and workload correctness, without assertions about wall-clock speed.
- `plans/performance-speedup/results/01/README.md` for commands, fixture semantics, comparison protocol, and baseline provenance.

Acceptance:

- Every suite runs in behavior-only mode, verifies expected workload outputs, and fails clearly for a bad source root, invalid measurement options or mismatched responses.
- A baseline checkout whose source differs in a controlled fixture test is actually executed; source paths/revision/diff and harness identity are visible in results. Baseline/candidate cannot collapse to the same cached module graph.
- Timed output preserves per-round data and measured units, runtime/hardware/configuration, warmup, and output consumption. HTTP output includes throughput and p50/p95/p99.
- Servers, readers, subprocesses and temporary exports are cleaned up even after a probe or measurement failure.
- No production code, original scenario list, `bench/baseline.json`, regression thresholds, dependencies, or package scripts are changed.

Prerequisite: none.

## T2 · Record unchanged-source controls and make the protocol usable by workers

With the coordinator's exclusive measurement slot, establish a production baseline at `a856cab47d4fd3102e976ce7a70166837837eea2` (or a later plan/harness-only commit proven to have identical production source). Run A/A controls and define variability assessment before candidates exist. Use at least five alternating rounds plus warmup and preserve all output. Record target-suite comparison commands and the two complete confirmation runs required for adoption; source roots and harness stay explicit. Fix workload settings before comparing.

Run the unchanged `bun run bench:check` once and record its real outcome separately from this machine's baseline; do not repair a hardware-baseline mismatch by re-recording it. Check the new harness and relevant fixtures on isolated Bun 1.4.0 in addition to the current 1.4.2. Coordinate with the executor to avoid timing alongside its tests/builds; record noise rather than rerunning indefinitely.

Expected files: compact machine-readable rounds and environment/protocol report under `plans/performance-speedup/results/01/`.

Acceptance:

- Workers 02-05 can invoke the identical committed harness against baseline and their worktree for a selected suite, then repeat the representative HTTP comparison.
- Baseline contains router, metadata/body, cache-hit/cold/transient DI, and dispatch controls identified in the plan; timings are not substituted with the historical Apple Silicon numbers.
- Report states observed variance and what remains noisy, names before-source/harness commits and exact commands, and records actual check statuses. Raw timings are retained without per-file source dump duplication.
- `bun test bench/test`, `bun run typecheck`, `bun run lint`, `git diff --check`, and all-suite `--check` pass. Minimum-runtime and historical gate results are explicit.
- Deliver one final task commit with the harness, focused tests, baseline evidence and protocol; production remains unchanged. Notify the coordinator that 02-05 may start only after integration.

Prerequisite: T1, and an exclusive timed-measurement slot from the coordinator.
