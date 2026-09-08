"""Retain command output byte-for-byte. Invoke inside the coordinator check lock."""
import datetime
import gzip
import hashlib
import json
import os
from pathlib import Path
import subprocess
import sys


root = Path(__file__).resolve().parent
label, *command = sys.argv[1:]
raw = root / f"{label}.log"
assert command and not raw.exists() and not raw.with_suffix(".log.gz").exists()
record = {
    "label": label,
    "command": command,
    "cwd": os.getcwd(),
    "path": os.environ["PATH"],
    "started": datetime.datetime.now(datetime.timezone.utc).isoformat(),
    "gitHead": subprocess.check_output(["git", "rev-parse", "HEAD"], text=True).strip(),
}
owned = ["packages/core/src/app/internals.ts", "packages/core/src/middleware/compose.ts", "packages/core/test/app/pipeline-compatibility.test.ts", "packages/core/test/middleware/compose.test.ts"]
record["taskFilesBefore"] = {name: hashlib.sha256(Path(name).read_bytes()).hexdigest() for name in owned}
with raw.open("wb") as output:
    record["exit"] = subprocess.call(command, stdout=output, stderr=subprocess.STDOUT)
data = raw.read_bytes()
raw.with_suffix(".log.gz").write_bytes(gzip.compress(data, mtime=0))
raw.unlink()
record["finished"] = datetime.datetime.now(datetime.timezone.utc).isoformat()
record["taskFilesAfter"] = {name: hashlib.sha256(Path(name).read_bytes()).hexdigest() for name in owned}
record["output"] = f"{label}.log.gz"
with (root / "checks.jsonl").open("a") as manifest:
    manifest.write(json.dumps(record) + "\n")
print(json.dumps(record), flush=True)
print(data.decode(errors="replace")[-4000:], flush=True)
raise SystemExit(record["exit"])
