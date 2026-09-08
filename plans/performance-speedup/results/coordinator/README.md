# Coordinator execution evidence

All six tasks were reviewed, rebased by their original worker, independently checked,
fast-forward merged into `master`, and cleaned up in queue order. Task 01 was
integrated before 02–05 launched in separate worktrees with disjoint ownership;
task 06 started only after all four decisions were integrated. Saved Codex routing
was preserved, with explicit YOLO startup flags. No agent recovery was required.

**No speedup was achieved.** All 80 production files match
`a856cab47d4fd3102e976ce7a70166837837eea2`. The final task commit is
`534b9d1a0ae1eacd1f7e66de9c75d059b8a74285`; subsequent closeout changes record the
workflow only. Initial plan/queue commit: `f3263289dd02131ed92751e72fb914df7d8f62ac`.
The [final report](../06/REPORT.md) preserves candidate decisions, checks, timings,
raw failures and reproducible source/runtime setup.

| Todo | Integrated commit | Actual routing | Independent coordinator validation |
| --- | --- | --- | --- |
| [01-hot-path-baseline.md](../../todos/done/01-hot-path-baseline.md) | `609c1d298393c49b49e6c11537e55437c5f6a89f` | Codex / gpt-6-astra / max | 1316/1316 tests; typecheck/lint/diff pass |
| [02-router-lookup.md](../../todos/done/02-router-lookup.md) | `3b63455bb6a122203f5c4ec1596f46258312f706` | Codex / gpt-6-astra / max | 1321/1321 tests; typecheck/lint/diff pass |
| [03-request-metadata.md](../../todos/done/03-request-metadata.md) | `01a5ca69330aa0f52dbd7f7d1513a9b77fb7e1d6` | Codex / gpt-6-astra / xhigh | 1329 pass / 1 store failure; triaged, one full retry 1330/1330; typecheck/lint/diff pass |
| [04-di-cache-hits.md](../../todos/done/04-di-cache-hits.md) | `d04aeafda1a3379e5ad5e06c742d0e3923c03034` | Codex / gpt-6-astra / max | 1355/1355 tests; typecheck/lint/diff pass |
| [05-dispatch-pipeline.md](../../todos/done/05-dispatch-pipeline.md) | `5530f7678a9df0c92fcdf9e99c268408c913a439` | Codex / gpt-6-astra / max | 1382/1382 tests; typecheck/lint/diff pass |
| [06-results-and-validation.md](../../todos/done/06-results-and-validation.md) | `534b9d1a0ae1eacd1f7e66de9c75d059b8a74285` | Codex / gpt-6-astra / xhigh | Final docs/typecheck/lint/diff pass; unchanged 1382-test coordinator run reused |

The actual integrated full suite passed 1382/1382 on Bun 1.4.2 and isolated
Bun 1.4.0, including 66 added regressions. Core coverage is 98.84%. Task 06 also
records both-runtime frozen installs, builds, package verification, harness
correctness, browser bundle scans and final documentation checks. Its independent
coordinator check reran documentation/type/style/whitespace validation and verified
242 unchanged package, test, harness and configuration paths before reusing the
coordinator's own current-runtime full test result. Passing full gates were not
repeated solely for a documentation change.

Task 03's first coordinator full suite failed the unchanged MemoryStore initial
size assertion (597/1200, 84.77 ms total test duration). One focused run in each
source root passed 33/33; source/test bytes and metadata-test isolation were
reviewed. One failure-justified full retry passed 1330/1330. Both outcomes and the
investigation are retained. Task 05's rebased current focused check also failed
the same assertion (795/1200, 74.27 ms); the subsequent independent full integrated
run passed 1382/1382 and included that scope. The baseline focused runs passed:
a baseline failure was not reproduced, and the exact timing/clock cause remains
unconfirmed. Task 04/05 earlier failures remain in their reports and task 06.

The compose Promise.resolve shortcut was rejected for two concrete compatibility
failures on each runtime. Router, metadata, guarded DI and dispatch-wrapper
candidates were excluded as inconclusive after bounded quiet-window controls.
All candidate and final attempts produced zero timed rows. Task 01 retains four
complete A/A controls (2560 rows), only one eligible on Bun 1.4.2; there is no
eligible minimum-runtime envelope. No numeric component, HTTP or allocation gain
is claimed. Original benchmark fixtures, baseline and thresholds are unchanged.
Task 01's historical gate actually failed all eight scenarios, exit 1, with three
outside-load samples. Both final historical windows timed out and are NOT RUN.
These are limitations of the completed evaluation, not passed performance gates.
Future candidate adoption needs a new authorized evaluation with eligible evidence.

## Archived checks and integration records

[archives.json](archives.json) records SHA-256 for 13 complete tar.gz bundles and
for every original member. Each bundle preserves the original directory name,
commands, runtime/PATH, cwd, exits and raw logs. The archived records retain their
historical absolute origin paths; those temporary originals have been removed.
Extract a chosen bundle with `tar -xzf <archive.tar.gz>` and inspect its manifests.
The original failure, retry and worker rebase conflicts are included, not replaced.

`verify-*` bundles contain independent coordinator checks. The six integration
bundles contain worker rebase/related-check evidence; task 03 also includes store
triage. README conflicts for 03–05 preserved all already-integrated task statuses.
01, 02 and 06 were already based on their integration target. Every task remained
one commit; no merge commits or forced integration were used.

[run-load.py](run-load.py) is the exact two-lock admission wrapper used by all
queue workloads. Tests/builds used shared check allocations; recorder attempts
used exclusive measure allocations. Later scheduling released the exclusive lock
after each single comparison/quiet attempt without changing recorder settings or
eligibility. No unrelated process was stopped. Reproduction after cleanup uses
[task 06's guide](../06/REPRODUCE.md), not the old temporary lock directory.

[execution-state.json](execution-state.json) records routing, commit and resource
identities. [cleanup.json](cleanup.json) records removal of all six agents'
workspaces, worktrees and local branches, plus the shared baseline/runtime after
task 06's final checks. Only the original checkout remains. All six original todo
files are archived in `todos/done/`; no queued implementation work remains.
The missing performance evidence and historical gate limitations remain explicitly
reported. The final closeout adds this evidence and reconciles historical queue
status text without changing any task evidence or production file.

[closeout-checks.json](closeout-checks.json) records the final documentation build,
lint, link/source/evidence audit and whitespace checks after the plan/queue edits.
Their complete logs are compressed byte-for-byte beside the manifest. No further
full tests or performance measurements were needed for these closeout documents.
