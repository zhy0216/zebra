difficulty: hard
agent: inherit

# Reduce cached DI resolution bookkeeping

## T1 · Return valid cached values before unnecessary diagnostic allocation

Inspect `Container.resolve/resolveWithStack/instantiate/cacheContainerFor` in `packages/core/src/di/container.ts`. After selecting the current binding and correct owning scope, evaluate a cache-hit path that avoids repeated display-name, stack-scan, and frame-copy work. Preserve the existing value-binding fast path. Avoid global resolution-plan/binding caches, lifetime changes or premature instantiation.

Expected files:

- `packages/core/src/di/container.ts` (a narrow existing internal DI helper only if inspection proves it necessary).
- Behavioral tests under `packages/core/test/di/`, including a new `container-cache.test.ts` if useful.
- `plans/performance-speedup/results/04/`.

Acceptance:

- Cached `undefined`, `null`, `false`, `0`, objects and promises return correctly; factories/constructors execute at the existing frequency.
- Singleton cache ownership is the root, request/session ownership is the nearest matching scope, and transient/no-matching-scope resolution retains behavior. Request data cannot leak between scopes.
- Rebind, local bindings/shadowing, snapshot/restore and mutable pre-boot containers use current bindings. No cache hit masks a needed binding lookup.
- Cold and lazy-factory cycles retain `CircularDependencyError` and paths; distinct same-name tokens stay distinct, unbound dependencies retain diagnostics, and active-factory stacks are restored after success/failure.
- Disposal order, aliases, idempotent/concurrent cleanup, cached dependencies during dispose, and newly resolved resources retain behavior. Do not change scope creation or session lifetime machinery.
- Public API/behavior is compatible; app/request/router code and shared benchmark fixtures are untouched.

Prerequisite: 01-hot-path-baseline.md integrated.

## T2 · Validate cold/cached/mutable states and measure real DI use

Measure warmed singleton class/factory, warmed request/session scopes, value bindings, transient and small dependency graphs with task 01's DI suite. Compare relevant booted dispatch/HTTP singleton routes as well as the existing value-binding DI route. Keep construction and repeated cache-hit costs separate. Use the same harness against baseline/candidate source with two confirmation runs in exclusive windows.

Expected files: compact report and all comparison rounds under `plans/performance-speedup/results/04/`.

Validation:

```sh
bun test packages/core/test/di packages/core/test/app/boot-validation.test.ts packages/core/test/app/inject-boot-validation.test.ts packages/core/test/app/route-deps.test.ts packages/core/test/app/fast-path.test.ts packages/core/test/app/session.test.ts packages/core/test/app/session-generation.test.ts packages/core/test/app/cleanup-errors.test.ts
bun run typecheck
bun run lint
git diff --check
```

Acceptance: focused tests/harness behavior pass on current and minimum Bun as required by the plan; cold/transient paths and representative HTTP scenarios have no repeatable unacceptable regression. Adoption follows the preset variability criteria. Record before/after source, harness, commands, runtime and results. Reject an ineffective or semantically unsafe candidate and report that fact. Deliver one final task commit.

Prerequisite: T1 and the coordinator's exclusive timed-measurement slot.
