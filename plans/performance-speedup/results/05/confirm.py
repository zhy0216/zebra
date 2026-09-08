"""ONE fixed confirmation. Invoke each comparison in its own measure lock hold."""
import csv
import json
import os
from pathlib import Path
import subprocess
import sys


root = Path(__file__).resolve().parent
proto = Path("/home/ubuntu/workspace/zebra/plans/performance-speedup/results/01")
suite, runtime, confirmation = sys.argv[1:]
assert suite in ("dispatch", "http") and runtime in ("142", "140")
assert confirmation in ("1", "2")
env = os.environ.copy()
binary_dir = "/tmp/zebra-performance-speedup-01/runtime/bun-1.4.0" if runtime == "140" else "/home/ubuntu/.bun/bin"
env["PATH"] = binary_dir + ":" + env["PATH"]
# A missing required control already makes this version-sensitive candidate
# inadmissible; do not spend more measurement allocations on that candidate.
decisions = [json.loads(line) for line in (root / "minimum-control-decisions.jsonl").read_text().splitlines()]
controls = list(csv.DictReader((root / "minimum-envelopes.csv").open()))
assert {r["suite"] for r in controls} == {"dispatch", "http"}, "Required minimum controls remain unsupported"
directory = root / f"candidate-{runtime}-{suite}-{confirmation}"
command = [sys.executable, str(proto / "measure.py"), "--output", str(directory), sys.executable, str(proto / "series.py"), "--harness", "/home/ubuntu/workspace/zebra/bench/hot-path.ts", "--before", "/tmp/zebra-performance-speedup-01/baseline-a856cab", "--after", os.getcwd(), "--suite", suite]
raise SystemExit(subprocess.call(command, env=env))
