# Router lookup evaluation

Task 02 is being evaluated against production baseline
`a856cab47d4fd3102e976ce7a70166837837eea2` using task 01 integrated at
`609c1d298393c49b49e6c11537e55437c5f6a89f`.

## Prospective protocol

Written before candidate timing. Use the immutable harness at
`/home/ubuntu/workspace/zebra/bench/hot-path.ts`, combined harness SHA-256
`b4a3feb23f5d26c8b6121d35e1b121b2b5ab6221b45a62ae4ddf42dd8a31a976`, and the
unchanged `results/01/series.py` and `measure.py` from that checkout. Baseline
root is `/tmp/zebra-performance-speedup-01/baseline-a856cab`; candidate root is
this dedicated worktree. Both use frozen dependencies and separate processes.

All checks use `run-load.py check`; every complete timed comparison uses one
`run-load.py measure` wrapper. The absolute wrapper is
`/tmp/zebra-performance-speedup-f3263289/run-load.py`. Preserve all raw records,
commands, identities, quiet-window and outside-load evidence. Do not edit timing
bytes; gzip evidence byte-for-byte for retention and whitespace hygiene.

Keep the existing eligible Bun 1.4.2 envelopes from `results/01/variability.csv`.
Before any Bun 1.4.0 candidate timing, attempt a focused router A/A control and
a full HTTP A/A control with the same baseline root on both sides. Each has at
most two attempts including quiet timeouts, stopping after the first eligible
complete control. Derive and save the prescribed per-metric envelopes before
candidate timing. No eligible minimum control means no minimum-runtime adoption.

Comparisons use five alternating pairs (AB, BA, AB, BA, AB), 100000 iterations,
20000 warmup, HTTP 1000 ms plus 500 ms warmup, concurrency 32. Two eligible
complete confirmations are required for router and HTTP on both runtimes to
retain this candidate. Booted dispatch is also checked and measured as a cost
control; no dispatch gain is claimed without an eligible control. Keep the
30-second quiet window, 300-second wait limit and whole-comparison exclusion
for any sampled outside process using >=15% of one core or a competing workload.
Allow at most two additional confirmation attempts for noise/interruption;
never retry based on timing values or change any fixture or threshold.

Adoption requires the preset target (10% component or 5% HTTP), gain beyond
the runtime/fixture envelope in both confirmations and >=4/5 improving pairs
each time. Envelopes >20% are noisy. Inspect all parameter, wildcard, miss,
method-miss and registration rows. A repeatable >5% HTTP throughput or p95
regression rejects the candidate; uncertainty does not waive this rule.
Record registration time and memory separately, and inspect retained storage.
If evidence is ineffective, unsafe or inconclusive, restore production source
and keep this evaluation and useful compatibility tests.

## Candidate scope

Evaluate one bounded index of normalized, still-encoded fully static paths,
reusing the radix terminal's method table. An absent path or method falls back
to the existing radix walk. Every hit returns fresh null-prototype parameters.
Do not change percent decoding or edge-slash normalization independently without
separate evidence. The index grows only during successful route registrations.

Final results and validation will be added after the bounded evaluation.
