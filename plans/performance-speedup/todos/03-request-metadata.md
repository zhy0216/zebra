difficulty: medium
agent: inherit

# Reduce unused request metadata work

## T1 · Defer metadata derivation while preserving snapshots and identity

Inspect `ZebraRequestImpl` and `buildRequest` in `packages/core/src/http/request.ts`. Use the task-01 request/dispatch baseline to evaluate lazy lowercase content-type derivation and, only if compatible and useful, deferred raw signal materialization. Query/context/IP and prototype body helpers are already optimized; do not redo that work or add per-request accessor closures.

Expected files:

- `packages/core/src/http/request.ts`.
- `packages/core/test/http/request.test.ts` and `packages/core/test/http/request-helpers.test.ts`; a dedicated request-metadata test file under the same directory only if it improves clarity.
- `plans/performance-speedup/results/03/`.

Acceptance:

- Original content type remains captured at construction. Mutating `raw.headers` or `req.headers` before body access does not change which parser/limits are selected. Multipart parsing preserves the original-case boundary.
- `req.headers === raw.headers`, supplied URL reuse, default/provided signal identity and abort delivery (including abort before first access), optional/supplied IP, one-time lazy IP resolution, and stable context retain behavior.
- Query parsing preserves duplicate-key last-value behavior, null-prototype safety and assignment by the contract pipeline. Request-facing properties retain their existing observable use; do not make formerly assignable fields unexpectedly read-only as a shortcut.
- All buffering helpers still share bytes/read failures and limits, stream ownership remains exclusive, and mixed body/text/json/form calls work. No changes to `http/body.ts` or native body merging.
- Keep `buildRequest` and the public `ZebraRequest` interface compatible. No dispatcher edits or hand-written URL parser; coordinate any dependency with its owning task before editing.

Prerequisite: 01-hot-path-baseline.md integrated.

## T2 · Compare metadata-free, metadata-reading and body workloads

Measure fresh request construction, booted dispatch and corresponding HTTP workloads with the same committed task-01 harness. Include both handlers that skip metadata and handlers that read query/headers/signal/body. Preserve current/source snapshots and compare the actual production implementations. Report any allocation observation and its uncertainty alongside latency/throughput, with two complete confirmation runs and all per-round data.

Expected files: decision, exact source/harness/runtime/commands and raw rounds under `plans/performance-speedup/results/03/`.

Validation:

```sh
bun test packages/core/test/http/request.test.ts packages/core/test/http/request-helpers.test.ts packages/core/test/http/content-length.test.ts packages/core/test/contract packages/core/test/app/timeout.test.ts
bun run typecheck
bun run lint
git diff --check
```

Also run any new focused test file, all relevant harness `--check` suites, and the affected semantic tests on isolated Bun 1.4.0. Adoption requires the plan's repeatability and HTTP nonregression criteria. If laziness is incompatible or ineffective, remove the candidate and deliver a compact evaluation record; do not claim a speedup. Deliver one final task commit and leave shared benchmark files untouched.

Prerequisite: T1 and the coordinator's exclusive measurement window.
