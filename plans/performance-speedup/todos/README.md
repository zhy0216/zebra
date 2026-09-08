# Request performance task queue

Source: [plan.md](../plan.md). Intent: improve Zebra request throughput/latency with compatible, measured internal optimizations. Production baseline: `a856cab47d4fd3102e976ce7a70166837837eea2`. The planning checks passed: typecheck, lint, and 128 focused tests. New performance measurements are task 01's responsibility.

## Execution preferences

default_agent: codex

Source: initiating Codex host, preserved by auto-dev. No user model, reasoning-effort, or task-specific agent override was supplied. Every todo declares `agent: inherit`; do not infer a different default from the executor's host or installed CLIs.

Resolved difficulty mapping: hard = `codex / gpt-6-astra / max`; medium = `codex / gpt-6-astra / xhigh`; easy = `codex / gpt-6-astra / high`. These table values are not global model overrides. The new coordinator uses `codex / gpt-6-astra / high`. Start every coordinator/worker with explicit YOLO, model, and reasoning flags from agent-routing.md.

## Priority

| File | Priority | Difficulty | Agent | Model / Codex reasoning effort | Purpose |
| --- | --- | --- | --- | --- | --- |
| [01-hot-path-baseline.md](done/01-hot-path-baseline.md) | P1 | hard | codex (inherits default) | gpt-6-astra / max | Completed harness/baseline; awaiting coordinator integration |
| [02-router-lookup.md](done/02-router-lookup.md) | P1 | hard | codex (inherits default) | gpt-6-astra / max | Evaluated; static index excluded because minimum-runtime performance evidence is inconclusive |
| [03-request-metadata.md](03-request-metadata.md) | P2 | medium | codex (inherits default) | gpt-6-astra / xhigh | Defer unused request metadata work with snapshot/identity compatibility |
| [04-di-cache-hits.md](04-di-cache-hits.md) | P1 | hard | codex (inherits default) | gpt-6-astra / max | Avoid diagnostic stack allocation on valid DI cache hits |
| [05-dispatch-pipeline.md](05-dispatch-pipeline.md) | P1 | hard | codex (inherits default) | gpt-6-astra / max | Reduce forwarding promises and closures in dispatch/middleware |
| [06-results-and-validation.md](06-results-and-validation.md) | P1 | medium | codex (inherits default) | gpt-6-astra / xhigh | Validate merged behavior and document actual performance results |

## 文件

1. [01-hot-path-baseline.md](done/01-hot-path-baseline.md) — completed; coordinator must integrate before 02–05 start.
2. [02-router-lookup.md](done/02-router-lookup.md) — completed evaluation; production candidate excluded, compatibility tests and evidence retained.
3. [03-request-metadata.md](03-request-metadata.md) — 依赖 01-hot-path-baseline.md.
4. [04-di-cache-hits.md](04-di-cache-hits.md) — 依赖 01-hot-path-baseline.md.
5. [05-dispatch-pipeline.md](05-dispatch-pipeline.md) — 依赖 01-hot-path-baseline.md.
6. [06-results-and-validation.md](06-results-and-validation.md) — 依赖 02-router-lookup.md、03-request-metadata.md、04-di-cache-hits.md、05-dispatch-pipeline.md.

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

## Task 01 status

01 is complete in its dedicated branch and archived under `done/`; coordinator
integration is pending. [Results/01](../results/01/README.md) records the committed
harness, all raw controls/checks, observed variability and the explicit missing
minimum-runtime envelope. A bounded prospective minimum-runtime A/A allowance
applies before candidate timing; noisy samples are never adopted as an envelope.
The unchanged historical gate failed all eight scenarios and remains unchanged.
02–05 may start only after 01 is integrated. Default and task preferences above
persist across session changes; other task statuses are unchanged.

## Task 02 status

02 is evaluated and archived under `done/`; the static index is **excluded**.
Both bounded Bun 1.4.0 router controls timed out without any timed rounds, so
minimum-runtime adoption remains unsupported. Production is restored to the
planning baseline. Five compatibility/fuzz tests and all check/load/patch evidence
are retained in [results/02](../results/02/README.md). Both-runtime candidate full
gates and final-source focused/harness/type/lint checks passed. No speedup is
claimed. Coordinator integration is pending; all other task states and saved
agent/model preferences are unchanged.
