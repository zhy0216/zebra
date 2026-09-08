difficulty: hard
agent: inherit

# Reduce dispatch and middleware overhead

## T1 · Remove redundant ordinary-path wrappers without weakening completion

Inspect `dispatch/runPipeline/runWithoutScopes/finalHandler/computePlan` in `packages/core/src/app/internals.ts` and `compose` in `packages/core/src/middleware/compose.ts`. The no-scope and precompiled-plan paths already exist. Using task-01 measurements, simplify forwarding promises/closures on ordinary matched routes and, where beneficial, middleware dispatch. Keep readable shared response conversion and the general feature-aware pipeline.

Expected files:

- `packages/core/src/app/internals.ts` and `packages/core/src/middleware/compose.ts`.
- Relevant tests under `packages/core/test/app/` and `packages/core/test/middleware/`, including `fast-path.test.ts`, `events.test.ts`, `response-completion.test.ts`, `timeout.test.ts`, and `compose.test.ts` as needed.
- `plans/performance-speedup/results/05/`.

Acceptance:

- Sync/async handlers, rejected promises, synchronous throws and thenables retain promise/error behavior. Awaited response conversion and serialization errors still produce the existing structured responses. Do not use `instanceof Promise` as the only async-result test.
- Middleware retains onion order, short circuiting, original event function/index identity, DI resolution timing and duplicate `next()` protection (including concurrent repeated calls and thrown/rejected downstream work).
- Live listener add/remove/once before and after boot still works for request and middleware events; a boot-time listener snapshot cannot disable future listeners. Event-free dispatch stays eligible after once listeners are consumed.
- HEAD fallback/explicit routes, body removal/cancellation, 404/405/OPTIONS, error cookies and Set-Cookie propagation retain behavior. Normal streaming responses are not eagerly consumed/canceled.
- Timeout covers handlers, request hooks and response completion as before; original errors and late rejection handling remain correct. Scoped disposal occurs exactly once and cleanup failure priority is preserved.
- In-flight accounting and graceful drain/stop still include outstanding dispatches. Direct pre-listen dispatch, session resolvers, request/session DI, contracts and observability continue to work.
- Do not skip existing scope creation for DI routes; existing `fast-path.test.ts` expectations remain. No schema-validation, JSON-constructor, URL-parser, scope-registry, router, request or DI implementation changes are included.

Prerequisite: 01-hot-path-baseline.md integrated.

## T2 · Verify both ordinary and feature-enabled paths, then measure

Use task 01's dispatch and HTTP fixtures for booted sync Response/async handlers, 0/5/20 middleware layers, listeners off/on, no-deps/DI, and metadata-reading controls. Compare actual source checkouts with identical workloads in exclusive windows; keep two confirmation runs and all rounds. Include error/HEAD/OPTIONS/timeout behavior checks outside timed loops. Report local dispatch costs separately from real HTTP throughput/latency.

Expected files: adoption decision and complete targeted evidence under `plans/performance-speedup/results/05/`.

Validation:

```sh
bun test packages/core/test/app packages/core/test/middleware packages/core/test/contract packages/core/test/ws.test.ts packages/session/test packages/observability/test
bun run typecheck
bun run lint
git diff --check
```

Acceptance: relevant tests and harness behavior pass on current and isolated minimum Bun; retained changes show repeatable targeted improvement with no repeatable >5% HTTP throughput/p95 regression under the plan's protocol. Do not reduce correctness assertions to enable a fast path. Reject candidates whose improvements do not survive full request costs or whose boundary behavior differs, documenting why. Deliver one final task commit, leaving shared harness/docs and other tasks' owned files unchanged.

Prerequisite: T1 and an exclusive timed-measurement slot from the coordinator.
