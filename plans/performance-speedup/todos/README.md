# Request performance task queue

Source: [plan.md](../plan.md). Intent: improve Zebra request throughput/latency with compatible, measured internal optimizations. Production baseline: `a856cab47d4fd3102e976ce7a70166837837eea2`. The planning checks passed: typecheck, lint, and 128 focused tests. New performance measurements are task 01's responsibility.

## Execution preferences

default_agent: codex

Source: initiating Codex host, preserved by auto-dev. No user model, reasoning-effort, or task-specific agent override was supplied. Every todo declares `agent: inherit`; do not infer a different default from the executor's host or installed CLIs.

Resolved difficulty mapping: hard = `codex / gpt-6-astra / max`; medium = `codex / gpt-6-astra / xhigh`; easy = `codex / gpt-6-astra / high`. These table values are not global model overrides. The new coordinator uses `codex / gpt-6-astra / high`. Start every coordinator/worker with explicit YOLO, model, and reasoning flags from agent-routing.md.

## Priority

| File | Priority | Difficulty | Agent | Model / Codex reasoning effort | Purpose |
| --- | --- | --- | --- | --- | --- |
| [01-hot-path-baseline.md](done/01-hot-path-baseline.md) | P1 | hard | codex (inherits default) | gpt-6-astra / max | Integrated harness/baseline; original gate failure retained |
| [02-router-lookup.md](done/02-router-lookup.md) | P1 | hard | codex (inherits default) | gpt-6-astra / max | Evaluated; static index excluded because minimum-runtime performance evidence is inconclusive |
| [03-request-metadata.md](done/03-request-metadata.md) | P2 | medium | codex (inherits default) | gpt-6-astra / xhigh | Completed inconclusive evaluation; production candidate excluded, compatibility tests retained |
| [04-di-cache-hits.md](done/04-di-cache-hits.md) | P1 | hard | codex (inherits default) | gpt-6-astra / max | Evaluated; candidate excluded after bounded quiet-window failures |
| [05-dispatch-pipeline.md](done/05-dispatch-pipeline.md) | P1 | hard | codex (inherits default) | gpt-6-astra / max | Evaluated; compatibility rejection / inconclusive controls, no production change |
| [06-results-and-validation.md](done/06-results-and-validation.md) | P1 | medium | codex (inherits default) | gpt-6-astra / xhigh | Integrated validation complete; unchanged production, no achieved speedup |

## 文件

1. [01-hot-path-baseline.md](done/01-hot-path-baseline.md) — integrated before 02–05 launched; harness and baseline evaluation complete.
2. [02-router-lookup.md](done/02-router-lookup.md) — completed evaluation; production candidate excluded, compatibility tests and evidence retained.
3. [03-request-metadata.md](done/03-request-metadata.md) — completed evaluation; no production optimization adopted.
4. [04-di-cache-hits.md](done/04-di-cache-hits.md) — completed evaluation; no production optimization retained.
5. [05-dispatch-pipeline.md](done/05-dispatch-pipeline.md) — integrated evaluation; rejected/inconclusive, no production change.
6. [06-results-and-validation.md](done/06-results-and-validation.md) — integrated final validation and outcome documentation; resources cleaned.

## Parallel execution and ownership

- Wave 1: 01, alone. Its committed harness/protocol and unchanged production baseline must be available before workers begin optimization.
- Wave 2: 02, 03, 04, and 05 may implement independently in separate worktrees. Their production/test file ownership is disjoint and specified in each todo. Integrate in README order after the executor's review/rebase/check cycle.
- Wave 3: 06, after all four optimization decisions and accepted commits are integrated. A rejected candidate can satisfy its dependency with a documented evaluation result; it must not be described as an implemented speedup.
- One todo = one worktree = one final task commit. Task reports and raw round data belong only in that task's `plans/performance-speedup/results/NN/` directory.
- Serialize all timed benchmarks through the coordinator; pause this queue's other test/build work during those windows. Ordinary development may otherwise run in parallel. Record outside load without stopping unrelated agents.
- 02-05 do not edit shared benchmark drivers/fixtures, `bench/README.md`, baseline/thresholds, each other's tests, or each other's source files. Route required shared changes through their owner and update dependencies before editing. Repeat affected before/after comparisons if shared fixtures change.

## Common acceptance

Read the full plan and each task's acceptance criteria. Keep the v1 API, routing/DI/event/timeout/body/cookie semantics, supported Bun minimum, frozen dependencies, and package boundaries. Do not replace already-rejected JSON/body implementations merely to make a production diff.

Use task 01's same-machine A/A and paired before/after protocol. Adoption requires repeatable benefit larger than observed control variability and no repeatable >5% HTTP throughput/p95 regression. Keep all rounds and distinguish component gains from HTTP gains. Record actual minimum-version checks and integration gates. The existing Apple Silicon `bench:check` result must be reported separately and its baseline/thresholds must remain unchanged.

Run each todo's focused checks plus typecheck/lint/diff checks. Run the plan's full integrated gates after final code changes; do not repeat passing gates without new changes, failures, or unresolved concerns. No deployment, publication, dependency upgrade, or remote push is part of this queue.

## Final execution status

All six tasks are reviewed, integrated into local `master` and archived under
`done/`. All task agents, workspaces, worktrees and local branches are cleaned up.
The shared baseline archive and isolated Bun 1.4.0 were retained through task 06,
then removed after durable evidence archival. Saved routing above is unchanged.

**No speedup was achieved.** All production source matches the original baseline.
02–05 retain 66 regression tests and exact evaluation evidence. Compose was rejected
for behavior; the other candidates are performance-inconclusive. Both final paired
comparisons and both final historical windows timed out before launching work.
The original task-01 historical gate remains an actual 8/8 failure, not a pass.

Integrated tests pass 1382/1382 on both runtimes, with 98.84% core coverage and
passing build/package/harness/browser/documentation/type/style gates. Known store
assertion failures and subsequent passes are retained without claiming a reproduced
baseline failure or confirmed cause. There are no pending implementation todos;
performance evidence remains an explicit limitation.

See [execution commits and actual routing](../plan.md#执行结果),
[independent coordinator validation and cleanup](../results/coordinator/README.md),
and [final outcomes and reproduction](../results/06/REPORT.md).
