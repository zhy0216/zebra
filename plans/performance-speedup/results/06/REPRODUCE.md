# Reconstruct the unchanged-source comparison

This is a reproducibility recipe, not permission to refill the exhausted 02–05
allowances. The final task-06 schedule allowed exactly one all-suite comparison
and one unchanged historical gate attempt per runtime, each in its own allocation.
There is no retained production change and no repeatability gain claim.

Use a Linux machine with Git, tar, Python 3 and independently unpacked Bun
**1.4.2** and **1.4.0** binaries. Keep each binary in its own bin directory; do not
replace the global Bun. Record `bun --version` and `bun --revision` after setting
PATH. The original revisions were `744846f844374847c902b5e7fd59b4342a51ef99`
and `34cbb9a40b4bd1bd767d134a7065e66c2432a676`, respectively.

The historical `/tmp/zebra-performance-speedup-01` archive and runtime are
coordinator-owned temporary resources. The following reconstructs independent
archives from durable Git objects and installs dependencies separately. It
requires a repository containing the three recorded commits and this report.
From that repository's root:

```sh
REPO=$(pwd -P)
RUN=$(mktemp -d /tmp/zebra-hot-path-reproduction.XXXXXX)
BEFORE="$RUN/before"
AFTER="$RUN/after"
HARNESS_ROOT="$RUN/harness"
mkdir -p "$BEFORE" "$AFTER" "$HARNESS_ROOT" "$RUN/locks"

git archive a856cab47d4fd3102e976ce7a70166837837eea2 | tar -x -C "$BEFORE"
git archive 5530f7678a9df0c92fcdf9e99c268408c913a439 | tar -x -C "$AFTER"
git archive 609c1d298393c49b49e6c11537e55437c5f6a89f | tar -x -C "$HARNESS_ROOT"
HARNESS="$HARNESS_ROOT/bench/hot-path.ts"
PROTO="$HARNESS_ROOT/plans/performance-speedup/results/01"
LOCK="$RUN/run-load.py"
export RUN BEFORE AFTER HARNESS_ROOT HARNESS PROTO LOCK
```

While this queue is active, use its existing coordinator lock instead. On an
independent reproduction machine, restore the archived two-lock scheduler,
changing only its lock-directory path (the recorder/series bytes stay immutable):

```sh
python3 - "$REPO/plans/performance-speedup/results/06/coordinator-load-wrapper.py.gz" <<'PY'
import gzip, os, sys
from pathlib import Path
script = gzip.decompress(Path(sys.argv[1]).read_bytes()).decode()
old = "base=Path('/tmp/zebra-performance-speedup-f3263289')"
assert script.count(old) == 1
script = script.replace(old, f"base=Path({str(Path(os.environ['RUN']) / 'locks')!r})")
Path(os.environ['LOCK']).write_text(script)
PY
```

Set `BUN_BIN` to the absolute directory of the independently unpacked **1.4.2**
binary for the first run. Repeat the runtime steps with **1.4.0** and a new `OUT`.
All checks, installs and their subprocesses inherit that runtime. Benchmark
commands must run from `AFTER` so the historical gate's workspace dependencies
resolve within its own frozen install.

```sh
# Set BUN_BIN to your isolated binary directory before this block.
export PATH="$BUN_BIN:$PATH"
python3 "$LOCK" check bun --version
python3 "$LOCK" check bun --revision
for SOURCE in "$BEFORE" "$AFTER" "$HARNESS_ROOT"; do
  (cd "$SOURCE" && python3 "$LOCK" check bun install --frozen-lockfile)
done

# Archives have no .git: record the original revisions and explicit file hashes.
# This writes archive metadata only, using the immutable identity helper.
python3 "$LOCK" check bun --eval '
const { productionFiles } = await import(process.env.HARNESS_ROOT + "/bench/hot-path-source.ts");
for (const [root, revision] of [
  [process.env.BEFORE, "a856cab47d4fd3102e976ce7a70166837837eea2"],
  [process.env.AFTER, "5530f7678a9df0c92fcdf9e99c268408c913a439"],
]) {
  await Bun.write(root + "/.hot-path-source.json", JSON.stringify({ revision, files: productionFiles(root) }));
}'

cd "$AFTER"
python3 "$LOCK" check bun "$HARNESS" --source-root "$BEFORE" --suite all --check
python3 "$LOCK" check bun "$HARNESS" --source-root "$AFTER" --suite all --check
```

Check the emitted environment and final identity records before comparing:

- Both production fingerprints:
  `7a9eb1077326654812aabcad8519086ce61b28350a6160582ec01cbce90c9b73`,
  80 files, empty archive changes; absolute imports under the respective root.
- Harness/fixtures combined fingerprint:
  `b4a3feb23f5d26c8b6121d35e1b121b2b5ab6221b45a62ae4ddf42dd8a31a976`.
  An archive harness may report a null Git revision; the byte fingerprint is
  mandatory and its source revision is the explicit archive command above.
- Lock fingerprint:
  `ece1a7458ab75446feadd1a013f9d6b8ca7b9d539ca39bc1384119591c2e31f1`.
- Actual Bun executable/version/revision, runtime PATH, hardware and workload
  settings. Never compare one runtime's numbers to the other runtime's control.

Choose a fresh output directory per runtime and keep every file. `series.py`
starts ten distinct processes with five alternating pairs. It fixes 100000
component iterations / 20000 warmup and HTTP 1000 ms / 500 ms warmup / concurrency
32. The original eight workloads and eight targeted HTTP fixtures all run.

```sh
OUT="$RUN/results-142"  # Use results-140 for the isolated minimum runtime.
mkdir -p "$OUT"
python3 "$LOCK" measure python3 "$PROTO/measure.py" --output "$OUT/paired" \
  python3 "$PROTO/series.py" --harness "$HARNESS" --before "$BEFORE" --after "$AFTER" --suite all

# Separate allocation, original 1000 ms × 64 × 3 defaults and 80%/125% thresholds.
unset BENCH_DURATION_MS BENCH_CONCURRENCY
python3 "$LOCK" measure python3 "$PROTO/measure.py" --output "$OUT/historical" bun run bench:check
```

Do not join these commands with `&&`: recorder exit 2 is a quiet timeout and the
independent historical attempt still needs its own allocation. Do not wrap the
whole schedule in another lock. Each recorder waits for 15 consecutive two-second
quiet samples, at most 300 seconds. Keep its complete `status.json`, `load.jsonl`
and any stdout/stderr. A quiet timeout launches no workload; report **NOT RUN**.
Any measured outside CPU >=15% of one core or detected competing workload excludes
the complete comparison, independent of timing direction. No retries were
permitted in this final schedule. Do not stop unrelated processes.

The [task-01 protocol](../01/README.md) explains fixtures, divisors, eligibility,
paired statistics and adoption thresholds. Its [eligible variability](../01/variability.csv)
remains fixed; minimum-runtime excluded controls establish no envelope. A future
candidate needs separately authorized, eligible controls and two confirmations
per runtime, at least four improving pairs each, benefit above the fixed envelope
and 10% component / 5% HTTP targets, and no repeatable >5% HTTP throughput/p95
regression. No such claim is possible from this unchanged-production final check.

Repository validation commands, each under `python3 "$LOCK" check`, are frozen
install, `bun run typecheck`, `bun run lint`, `bun run build`, `bun run test`,
`bun run verify:packages`, `bun test --coverage --coverage-reporter=lcov packages/core`,
`bun run check:coverage`, and `env DOCS_BASE=/zebra/ bun run docs:build`. Build
`packages/client/src/index.ts` and `packages/contract/src/index.ts` with
`bun build --target browser --outdir <separate-directory>` and inspect every
emitted JS file for `Bun` / `bun:` runtime references. Run `git diff --check` in
the documentation checkout. The exact original argv, cwd, PATH, timestamps,
exits and raw log hashes are in [checks.jsonl](checks.jsonl); original full-suite
reuse and all intermittent failures are explained in [REPORT.md](REPORT.md).
