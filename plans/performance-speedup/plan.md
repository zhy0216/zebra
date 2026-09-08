# Request performance speedup

## Intent

The user requested `$auto-dev performace speed up`. Zebra is a Bun HTTP framework, so the working interpretation is to improve framework request throughput and latency while preserving the v1 API and runtime behavior. Inspect the existing hot paths, establish reproducible measurements, and implement the changes whose benefits survive correctness and performance checks. This is a scoped performance task, not an unrestricted repository improvement sweep.

Planning baseline: `a856cab47d4fd3102e976ce7a70166837837eea2`, inspected on 2026-09-07 (America/Los_Angeles). The working tree was clean. The local runtime is Bun 1.4.2 on Linux x64 with 8 logical CPUs; the supported minimum in `package.json` is Bun 1.4.0. No applicable repository `AGENTS.md` or `CLAUDE.md` was found.

## Goals and scope

- Reduce avoidable allocation and work in routing, request construction, repeated DI resolution, and the ordinary dispatch/middleware path.
- Measure component costs and complete requests separately, including warmed HTTP servers and response consumption.
- Keep only compatible changes with reproducible benefits. Aim for at least 10% improvement in the affected component or 5% in a representative HTTP workload; these are evaluation targets, not claims about current performance.
- Preserve the public signatures and documented behavior in `docs/api-freeze.md`, Bun >=1.4.0 support, src-direct packages, and browser-safe client/contract packages.
- Deliver focused behavioral coverage and a concise results report identifying adopted, rejected, and inconclusive candidates.

Out of scope: public API redesign, opt-out of DI/validation/events, disabling limits or cleanup, application/database optimization, build-system tuning, dependency/runtime upgrades, generated handler code, publishing, deployment, remote pushes, and changes to the checked-in benchmark thresholds or baseline. JSON constructor and body-buffer native replacements were already evaluated in `plans/bun-native/`; do not repeat them without new evidence directly relevant to this work.

## Repository findings

These are source-backed hypotheses. No new performance measurements have been run during planning.

| ID | Location | Current behavior and opportunity | Priority | Difficulty |
| --- | --- | --- | --- | --- |
| F1 | `bench/scenarios.ts`, `bench/runner.ts`, `bench/bench-regression.ts`, `bench/zebra-bench.ts` | Eight HTTP scenarios exist, with body verification, warmup, and median-based regression checks. They do not isolate router/request/DI costs, and the `di` case uses a value binding rather than a cached class/factory. `bench/baseline.json` was recorded on Apple Silicon, so it cannot establish improvements on this Linux host. Add a separate same-source-comparison harness and retain the existing gate. | P1 | hard |
| F2 | `packages/core/src/router/radix.ts`: `find`, `walk`, `splitPath`, `toMatch` | Every lookup trims with a regexp, splits the path, allocates captures, and walks the tree, including fully static routes. Captured parameters always call `decodeURIComponent`. Evaluate a static-route index and less allocation in normalization/capture handling while preserving method-aware backtracking. | P1 | hard |
| F3 | `packages/core/src/http/request.ts`: `ZebraRequestImpl` constructor | Query, context, and IP are already lazy and body helpers already use prototype methods. Request construction still materializes the raw signal and immediately lowercases content type even for handlers that never read the body. Evaluate deferring unused metadata work, preserving the captured original content type and all request semantics. | P2 | medium |
| F4 | `packages/core/src/di/container.ts`: `resolveWithStack`, `instantiate`, `cacheContainerFor` | Value bindings already have a terminal fast path. Cached class/factory resolutions still compute diagnostic names, scan/copy resolution stacks, then discover the cached instance in `instantiate`. Evaluate a correctly scoped cache-hit path before unnecessary diagnostic allocation. | P1 | hard |
| F5 | `packages/core/src/app/internals.ts`: `dispatch`, `runPipeline`, `runWithoutScopes`, `finalHandler`; `packages/core/src/middleware/compose.ts` | Plans and zero-scope dispatch already exist. The ordinary route still crosses several async forwarding functions and allocates terminal/deadline-work closures. Middleware composition adds async wrappers at every level. Reduce redundant layers without weakening error, completion, or timeout behavior. | P1 | hard |

Existing safeguards matter: router `allowedMethods` unions matching branches; request helpers share bounded bytes and preserve failures; request completion hooks and HEAD stream cancellation were recently repaired; cached DI values remain available during disposal; event listeners can change after boot. Treat these as acceptance constraints, not opportunities to bypass work.

## Design

### 1. Establish an owned measurement harness

Add explicitly new files `bench/hot-path.ts`, `bench/hot-path-fixtures.ts`, and focused harness tests under `bench/test/`. Reuse the existing benchmark concepts and `runScenario` where applicable without changing the existing eight scenarios, regression thresholds, or stored baseline.

The harness must select the actual source checkout with `--source-root`, support `--check` (behavior only) and focused `--suite router|request|di|dispatch|http|all`, and emit machine-readable per-round results. Fixtures load core modules from that source root; baseline and candidate executions run in separate processes so workspace aliases/module caches cannot accidentally select the same implementation. Use the same committed harness, fixture definitions, inputs, Bun executable, and locked dependencies for both sources. Each candidate report identifies the resolved source root, commit and any production diff, harness revision, runtime, commands, and hardware. A clean temporary baseline checkout/archive may be created by the executor and removed when finished.

Keep fixtures bounded and representative:

- Router: static/parameter/wildcard hits, miss and method miss, shallow/deep paths, and 10/100/1000-route tables. Verify methods, captures, and precedence; report registration time/memory separately if adding an index.
- Request: construction without optional metadata reads, metadata reads, and body-helper use. Preserve fresh mutable request/response objects and consume outputs; distinguish isolated constructor measurements from complete dispatch.
- DI: value, warmed singleton class/factory, warmed request/session scope, transient, and a small dependency chain. Verify identity and factory/constructor invocation counts.
- Dispatch: a booted app with sync Response and async handlers, 0/5/20 middleware layers, a query reader, a cached-class DI route, and event listeners present/absent. Include correctness controls for error/HEAD/OPTIONS behavior. Do not use pre-listen plan recompilation as the main throughput benchmark.
- HTTP: retain the original eight workloads and add separate targeted fixtures for the missing warmed singleton, metadata, and listener paths. Use real sockets, validate responses before timing, consume measured bodies, and close servers/child processes on success or failure.

Task 01 performs A/A control runs on unchanged source before optimization and records the comparison protocol. Use at least five alternating baseline/candidate rounds with warmup for selected target suites and two complete confirmation runs for adoption. Measure HTTP throughput, p50/p95/p99 and operation time for component suites. Fix duration/concurrency/input sizes before comparing. Record RSS/heap or allocation observations where useful; do not present noisy heap deltas as precise allocation counts.

The coordinator serializes performance windows across this queue and pauses its other build/test workloads during measurements. Record significant outside load; external agents are not owned by this queue and must not be stopped. Do not keep rerunning until a favorable sample appears. Report all rounds, use the preset A/A variability assessment, and mark persistently noisy results inconclusive.

### 2. Optimize routing within the existing router

Start with a static-route index keyed by normalized encoded path and method, using the existing radix tree as fallback for parameters, wildcards, and method-aware precedence. Normalize exactly as current `splitPath`: ignore leading/trailing slashes, preserve interior empty segments and raw encodings. A static path with no matching method must still fall through to a parameter/wildcard route of that method. Preserve duplicate detection and `allowedMethods` union/order.

Only pursue lower-allocation trimming, captures, or percent-decode skipping if the router suite identifies an additional useful gain. Bound additional storage by registered routes; do not cache arbitrary request URLs or share mutable params objects between requests. `WsRegistry` also uses this router, so include WebSocket and fuzz coverage.

### 3. Reduce unused request metadata work

Keep `buildRequest`'s signature and the supplied URL/IP/signal behavior. Evaluate lazy lowercase content-type derivation and, if compatible and worthwhile, deferred raw signal materialization. Keep the original content-type snapshot at construction: moving the header read past middleware header mutation changes existing parsing semantics. Preserve original-case multipart boundaries. Do not add a hand-written URL parser or change dispatch to support this task.

Keep query overwrite support for contract validation, null-prototype query objects, `headers` identity, raw/provided signal identity and abort delivery, memoized IP lookup, stable context, bounded single body reads, streaming ownership, and error mapping. Avoid per-instance accessor closures that merely relocate allocation. If the candidate costs more when metadata/body is used or cannot preserve the public behavior, retain the current code and report why.

### 4. Optimize cached DI resolution

Look up the current binding and correct cache owner first, then return a cached instance without building diagnostic frames when semantically safe. Use membership checks so cached `undefined`, `null`, `false`, or `0` remain cache hits. The lookup must honor local binding shadowing and mutable containers; do not introduce a root-wide binding cache with stale rebind/snapshot behavior.

Preserve cold resolution diagnostics, token identity, lazy-factory cycle detection and active-stack restoration, root singleton ownership, nearest request/session scope ownership, transient behavior, factories, snapshot/restore, and disposal ordering/idempotence. Do not skip request scopes or change `SessionScopeRegistry` in this task. Keep optimization inside `di/container.ts` unless inspection establishes a narrowly required internal DI helper change.

### 5. Simplify the ordinary dispatch path

Evaluate removing forwarding async layers and avoiding unnecessary terminal/work closures on matched no-scope routes. Keep a readable shared response conversion path and the existing general pipeline for configured features. Optimize `compose` only where synchronous throws, rejected promises, thenables, onion ordering, short-circuit middleware, and the duplicate-`next` guard remain correct. Use proper promise assimilation; `instanceof Promise` alone is not a valid thenable/cross-realm test.

Request in-flight accounting, graceful drain, HEAD response construction/cancellation, 404/405/OPTIONS handling, pending cookies, error conversion, live request/middleware listeners, timeout coverage through completion hooks, scoped disposal, and early dispatch before listen must retain behavior. Do not add a permanent no-listener decision at boot. Do not change schema validation, JSON serialization, scope ownership, router or request implementation in this task. Shared-file ownership is explicit below.

## Task breakdown and dependencies

| Order | Task | Findings | Difficulty | Dependencies | Owned implementation files |
| --- | --- | --- | --- | --- | --- |
| 01 | Add reproducible hot-path harness and baseline | F1 | hard | None | New `bench/hot-path*.ts`, new `bench/test/hot-path.test.ts`, results under `results/01/` |
| 02 | Optimize router lookup and allocations | F2 | hard | 01 | `core/src/router/radix.ts`, router/fuzz-router tests, `results/02/` |
| 03 | Defer unused request metadata work | F3 | medium | 01 | `core/src/http/request.ts`, request/request-helper tests, `results/03/` |
| 04 | Reduce cached DI resolution overhead | F4 | hard | 01 | `core/src/di/container.ts`, DI tests, `results/04/` |
| 05 | Reduce dispatch and middleware overhead | F5 | hard | 01 | `core/src/app/internals.ts`, `core/src/middleware/compose.ts`, app/middleware tests, `results/05/` |
| 06 | Validate integrated behavior and document measured results | F1-F5 | medium | 02, 03, 04, 05 | `bench/README.md`, `results/06/` |

Paths abbreviated as `core/` in the table are under `packages/`. All `results/` paths are under this plan. New filenames above are proposed additions, not existing files. One todo equals one worktree and one final task commit. After 01 is integrated, 02-05 may implement and run ordinary checks in parallel; actual performance runs remain serialized. If any task needs another task's owned files, coordinate a dependency or move the work to its owner before editing. Changes to shared benchmark fixtures require the same treatment and invalidate affected comparisons until both sides are rerun with the same harness.

The coordinator reviews/rebases/checks/integrates each task using herdr-finish-plan. Task 06 validates the integrated production source against the unchanged planning baseline with the same new harness; it also uses the pre-optimization task-01 source as the candidate comparison baseline where convenient (production must be identical to `a856cab`). It reports interactions that remove an isolated gain. Any remaining implementation correction returns to its owning task for validation before final acceptance.

## Execution preferences

- `default_agent: codex`; source: initiating Codex host, preserved by auto-dev across planning and execution.
- No user model, reasoning-effort, or task-agent override was supplied. Each todo uses `agent: inherit`.
- Resolve task models from the shared agent-routing table: Codex `gpt-6-astra`, hard = `max`, medium = `xhigh`, easy = `high`. These are resolved choices, not saved global overrides.
- Coordinator: Codex `gpt-6-astra`, reasoning `high`; task difficulty is independent of coordinator settings.
- Every agent startup explicitly uses `--dangerously-bypass-approvals-and-sandbox`, the resolved model, and reasoning effort, as required by auto-dev. Installed `codex --help` supports the flags and local model metadata lists the required efforts.
- Herdr is available (`HERDR_ENV=1`). Launch the coordinator in a new sibling pane to the right in `/home/ubuntu/workspace/zebra` with `--no-focus`, after committing this plan and todo queue. Auto-dev ends after confirming that coordinator is working.

## Validation and acceptance

Planning checks already run on the baseline with Bun 1.4.2:

- `bun run typecheck`: passed.
- `bun run lint`: passed; 280 files checked with no fixes.
- `bun test packages/core/test/router packages/core/test/fuzz/router.test.ts packages/core/test/fuzz/path.test.ts packages/core/test/app/fast-path.test.ts packages/core/test/app/route-deps.test.ts packages/core/test/app/method.test.ts packages/core/test/http/request.test.ts packages/core/test/http/request-helpers.test.ts packages/core/test/di`: 128 passed, 0 failed, 4795 assertions.

Each implementation task runs its stated focused tests plus `bun run typecheck`, `bun run lint`, and `git diff --check`. Tests must cover changed observable behavior or real failure modes, without asserting implementation details merely to justify a speedup.

Integrated checks, once after final production changes unless a failure/change requires repetition:

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

Run affected runtime/semantic suites and the harness correctness mode using an isolated Bun 1.4.0 executable as the minimum-version check; do not replace global Bun. Run target before/after measurements on both 1.4.2 and 1.4.0 before retaining version-sensitive changes. Preserve the package/lock/runtime requirements.

Performance commands after task 01 (the options below are part of its required interface):

```sh
bun run bench/hot-path.ts --check --source-root /absolute/path/to/checkout
bun run bench/hot-path.ts --suite all --source-root /absolute/path/to/checkout
bun run bench:check
```

Run the same harness against baseline and candidate source roots according to task 01's comparison protocol, without competing build/test loads. A candidate must have a repeatable gain greater than A/A variability in its intended target, with no repeatable >5% regression in representative HTTP throughput or p95 versus the same-machine source baseline. Check large route-table construction/memory where an index is added and the metadata/body/scoped/listener paths affected by specialization. If evidence remains inconclusive, exclude the production candidate and keep a compact evaluation record. The overall task is not a speedup success unless at least one adopted production change has measured benefit; report an all-rejected outcome explicitly.

Run the existing `bun run bench:check` unchanged and record its actual result. An Apple Silicon baseline failure on Linux is not, by itself, a source regression; distinguish it from the same-machine comparisons. Never rewrite `bench/baseline.json`, lower 80% RPS/125% p95 thresholds, drop failing scenarios, or claim that this historical gate passed when it did not.

## Risks, assumptions, and open questions

- No workload, profile, or numerical target was supplied. Default to representative framework HTTP and DI use; no user answer is needed for this compatible internal scope.
- Existing fast paths mean source-level simplifications may yield little benefit. Reject an ineffective candidate rather than adding permanent complexity for a theoretical gain.
- Promise/timing changes can break cleanup or error boundaries. Recently added completion, timeout, event, session and asynchronous validation tests are required regression controls for the dispatch task.
- Static indexing can subtly break method fallback or grow registration memory. Bound memory by registered routes and keep the tree fallback.
- Lazy request metadata can observe later header mutations or alter signals. Snapshot and identity requirements take precedence over laziness.
- A cached DI fast path can hide a cycle, stale binding or cached falsy value if placed incorrectly. Cover cold/cached/mutable/disposal states explicitly.
- Shared-host load and the existing machine-specific HTTP baseline limit numerical certainty. Keep all rounds, identify noise, and distinguish local component gains from HTTP gains.
- Plan/queue commit and local executor integration are authorized by the selected workflow. User-owned changes, if they appear before launch, must be left untouched and reported under auto-dev's clean-worktree rule.
