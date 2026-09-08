difficulty: medium
agent: inherit

# Integrated validation and measured results

## T1 · Validate the integrated production source

Read the four candidate reports and task-01 protocol after 02-05 have been reviewed/integrated. Distinguish adopted production changes from rejected or inconclusive evaluations. Validate the merged source against `a856cab47d4fd3102e976ce7a70166837837eea2` using the identical committed harness and locked dependencies. A plan/harness-only baseline revision is acceptable if its production source is proven identical.

Expected files: `plans/performance-speedup/results/06/REPORT.md` and concise raw validation/performance results in the same directory. This task does not independently rewrite production code or test expectations; return a required implementation correction to its owning task and the coordinator, then validate the corrected integration.

Run once after final production changes, except where a failure/new change requires repetition:

```sh
bun run typecheck
bun run lint
bun run build
bun run test
bun run verify:packages
bun test --coverage --coverage-reporter=lcov packages/core
bun run check:coverage
bun run docs:build
git diff --check
```

Also run the all-suite harness `--check`, affected semantic tests on isolated Bun 1.4.0, and any missing minimum-runtime performance confirmation for retained version-sensitive candidates. Use the coordinator's serialized measurement windows for final paired target and representative HTTP suites; compare all existing eight HTTP workloads. Reuse valid unchanged checks already run on the same final production source rather than repeating them unnecessarily.

Acceptance:

- Report exact final production revision/diff, baseline and harness identities, Bun version, hardware, workload settings, commands and exit status for the integrated checks.
- Same-machine before/after results and full rounds support every retained speedup. Report component and HTTP results separately, including p95/p99 and interactions that reduce an isolated gain.
- No repeatable >5% HTTP throughput/p95 regression versus the same-source baseline remains unexplained/unresolved. No semantic regression is accepted for a timing gain.
- Run `bun run bench:check` unchanged in its own measurement window; report the real result and machine mismatch separately. `bench/baseline.json`, thresholds, original scenarios, package versions/dependencies and runtime minimum remain unchanged.
- If no production candidate is retained, state that no speedup was achieved. Do not transform a benchmark-only result into an implementation success.
- Failures are triaged with the coordinator and fixed by the owning task before integration is declared complete; unrelated pre-existing failures are clearly identified with evidence.

Prerequisites: 02-router-lookup.md, 03-request-metadata.md, 04-di-cache-hits.md, and 05-dispatch-pipeline.md integrated with recorded decisions; exclusive coordinator measurement slots.

## T2 · Document the actual outcome and finish the queue

Update `bench/README.md` with the new harness commands, an accurately scoped results table, environment/baseline details and links to compact evidence. Preserve the historical Apple Silicon numbers and previous native-evaluation conclusions. Avoid broad claims unsupported by the measured scenarios. Keep implementation details out of ordinary product documentation unless a user-visible behavior changed (none is intended).

Expected files: `bench/README.md` and `plans/performance-speedup/results/06/REPORT.md`; queue completion/archival follows the executor's workflow.

Acceptance:

- A reader can reproduce the comparison from the recorded source revisions/commands and distinguish accepted changes, rejected candidates, unmeasured cases, and noisy results.
- Documentation links resolve; run `bun run docs:build` after the final documentation edit if the earlier build preceded it. Typecheck/lint/diff checks cover final changed files.
- Report the integrated checks and any material remaining limitation truthfully. Do not rebaseline, publish, deploy, push, or expand into an unrelated optimization.
- Deliver one final task commit. Coordinator performs final review/integration and executor-defined cleanup, then reports the actual achieved improvement to the user.

Prerequisite: T1 complete, including any corrections requested from owning tasks.
