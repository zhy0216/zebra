"""Prove the exported baseline and final production sources are byte-identical."""
import hashlib
import json
from pathlib import Path
import subprocess

ROOT = Path(__file__).resolve().parents[4]
OUT = Path(__file__).resolve().parent
archive = json.loads((OUT / "baseline-archive.jsonl").read_text())
baseline = Path(archive["path"])
source_paths = sorted(path for path in archive["filesSha256"] if path.startswith("packages/") and "/src/" in path)
current_paths = sorted(str(path.relative_to(ROOT)) for path in ROOT.glob("packages/*/src/**") if path.is_file())
assert source_paths == current_paths
for path in source_paths:
    expected = archive["filesSha256"][path]
    assert hashlib.sha256((ROOT / path).read_bytes()).hexdigest() == expected, path
    assert hashlib.sha256((baseline / path).read_bytes()).hexdigest() == expected, path
for path, expected in archive["filesSha256"].items():
    assert hashlib.sha256((baseline / path).read_bytes()).hexdigest() == expected, path
protected = ["package.json", "bun.lock", "bench/baseline.json", "bench/bench-regression.ts", "bench/runner.ts", "bench/scenarios.ts", "bench/zebra-bench.ts", "docs/api-freeze.md", "docs/zh/api-freeze.md"]
protected += sorted(str(path.relative_to(ROOT)) for path in ROOT.glob("packages/*/package.json"))
subprocess.run(["git", "diff", "--exit-code", "1418a2f", "--", "packages/*/src/**", *protected], cwd=ROOT, check=True)
print(json.dumps({
    "head": subprocess.check_output(["git", "rev-parse", "HEAD"], cwd=ROOT, text=True).strip(),
    "baseline": archive["commit"], "archive": str(baseline),
    "productionFiles": len(source_paths), "allProductionFilesByteIdentical": True,
    "archivedTrackedFiles": len(archive["filesSha256"]), "archiveUnmodifiedAfterFrozenInstall": True,
    "protectedFilesUnmodified": protected,
    "sourceHashes": {path: archive["filesSha256"][path] for path in source_paths},
}))
