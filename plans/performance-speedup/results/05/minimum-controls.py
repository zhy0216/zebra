"""ONE prospective control attempt. Invoke this script inside the measure lock."""
import os
from pathlib import Path
import subprocess
import sys

root = Path(__file__).resolve().parent
proto = Path("/home/ubuntu/workspace/zebra/plans/performance-speedup/results/01")
suite, attempt = sys.argv[1:] if len(sys.argv) > 1 else ("dispatch", "1")
assert suite in ("dispatch", "http") and attempt in ("1", "2")
env = os.environ.copy()
env["PATH"] = "/tmp/zebra-performance-speedup-01/runtime/bun-1.4.0:" + env["PATH"]
directory = root / f"aa-140-{suite}-{attempt}"
baseline = "/tmp/zebra-performance-speedup-01/baseline-a856cab"
command = [sys.executable, str(proto / "measure.py"), "--output", str(directory), sys.executable, str(proto / "series.py"), "--harness", "/home/ubuntu/workspace/zebra/bench/hot-path.ts", "--before", baseline, "--after", baseline, "--suite", suite]
raise SystemExit(subprocess.call(command, env=env))
