difficulty: hard
agent: inherit

# Reduce router lookup overhead

## T1 · Optimize encoded static lookup with correct fallback

Inspect `Router.add/find/walk/toMatch/allowedMethods` and `splitPath` in `packages/core/src/router/radix.ts`. Using task 01's baseline, implement a bounded index for fully static routes if it wins. Keep the current radix matcher as fallback when an indexed path/method does not match. Evaluate cheaper edge-slash normalization and skipping percent decoding for captures with no `%` only where independently justified. Do not replace the matcher wholesale.

Expected files:

- `packages/core/src/router/radix.ts`.
- `packages/core/test/router/radix.test.ts` and `packages/core/test/fuzz/router.test.ts` as necessary for changed behavior coverage.
- `plans/performance-speedup/results/02/`.

Acceptance:

- Static > parameter > wildcard precedence, method-specific parameter names, unknown-method fallback to another matching branch, empty wildcards, duplicate detection and `allowedMethods` union/order retain behavior.
- Leading/trailing slash equivalence, interior empty segments, encoded separators, malformed escapes and raw wildcard captures are compatible. Include method fallback where a static path exists only for another method.
- Each lookup returns independently mutable parameter data; no request-keyed cache grows with attacker/user-selected URLs. Additional index storage is bounded by route registrations.
- Router changes preserve HTTP HEAD/OPTIONS/405 and shared WebSocket matching. Use behavioral/differential/fuzz coverage, not assertions about private index structure.
- No changes to app dispatch, request/DI code, shared benchmark fixtures, static-file safety, or public APIs.

Prerequisite: 01-hot-path-baseline.md integrated.

## T2 · Verify correctness and measure benefit/cost

Run task 01's router suite against unchanged and candidate source using the same harness, then relevant booted-dispatch and HTTP scenarios. Include 10/100/1000 routes and report registration time/memory costs separately. Obtain exclusive measurement windows; keep complete rounds and two confirmation runs. Apply the plan's variability/adoption criteria, including nonregression of parameter/wildcard/miss workloads and HTTP.

Expected files: results and a concise adopted/rejected decision under `plans/performance-speedup/results/02/`.

Validation:

```sh
bun test packages/core/test/router packages/core/test/fuzz/router.test.ts packages/core/test/app/method.test.ts packages/core/test/app/ws.test.ts packages/core/test/ws.test.ts
bun run typecheck
bun run lint
git diff --check
```

Acceptance: focused checks and harness correctness pass on current and minimum Bun as required by the plan. Adopt only a compatible measured improvement; otherwise discard the production candidate and report the evaluation accurately. Include source/harness/runtime/commands and all comparison rounds in one final task commit. Benchmark fixture changes, if required, go to 01's owner and require matched remeasurement.

Prerequisite: T1 and the coordinator's timed-measurement slot.
