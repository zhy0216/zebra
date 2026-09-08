"""Verify reused docs builds, immutable pre-archive inputs, and task 01/02 evidence."""
import gzip
import hashlib
import json
from pathlib import Path
import subprocess

ROOT = Path(__file__).resolve().parents[4]
OUT = Path(__file__).resolve().parent
PREFIX = str(OUT.relative_to(ROOT))


def sha(path):
    return hashlib.sha256(path.read_bytes()).hexdigest()


snapshots = {
    "plans/bun-native/todos/03-docs-and-validation.md": OUT / "todo-before-archive.md.txt",
    f"{PREFIX}/REPORT.md": OUT / "report-before-archive.md.txt",
    f"{PREFIX}/check-docs.py": OUT / "check-docs-before-archive.py.txt",
}
inputs = []
for line in (OUT / "doc-sync-inputs.sha256").read_text().splitlines():
    expected, name = line.split("  ", 1)
    path = snapshots.get(name, ROOT / name)
    assert sha(path) == expected, name
    inputs.append({"original": name, "verifiedAt": str(path.relative_to(ROOT)), "sha256": expected})

reused = []
for version in ("142", "140"):
    name = f"bun{version}-doc-sync-build-final"
    run = json.loads((OUT / f"{name}.run.jsonl").read_text().splitlines()[-1])["completed"]
    assert run["exitCode"] == 0
    expected = run["stateBefore"]["docsSha256"]
    assert expected == run["stateAfter"]["docsSha256"]
    assert len(expected) == 9
    assert expected == {name: sha(ROOT / name) for name in expected}
    reused.append({"bun": run["bun"], "buildRecord": f"{name}.run.jsonl", "docsSha256": expected})

# The retained local dist was produced by the last (Bun 1.4.0) final docs build.
output = json.loads(gzip.decompress((OUT / "bun140-doc-sync-links-final-pass.stdout.txt.gz").read_bytes()))
for page in output["builtPages"]:
    assert sha(ROOT / "docs/.vitepress/dist" / page["page"]) == page["sha256"], page["page"]

protected = ["plans/bun-native/results/01", "plans/bun-native/results/02",
             "plans/bun-native/todos/done/01-native-json.md", "plans/bun-native/todos/done/02-native-body.md"]
preserved = {}
paths = subprocess.check_output(["git", "ls-tree", "-r", "--name-only", "12e6b88", "--", *protected], cwd=ROOT, text=True).splitlines()
for name in paths:
    original = subprocess.check_output(["git", "show", f"12e6b88:{name}"], cwd=ROOT)
    assert (ROOT / name).read_bytes() == original, name
    preserved[name] = hashlib.sha256(original).hexdigest()
assert not subprocess.check_output(["git", "diff", "1418a2f", "--", "packages/*/src/**"], cwd=ROOT)
assert not (ROOT / "plans/bun-native/todos/03-docs-and-validation.md").exists()
assert (ROOT / "plans/bun-native/todos/done/03-docs-and-validation.md").is_file()
print(json.dumps({"historicalInputs": inputs, "reusedBuilds": reused,
                  "retainedOutputFromBun": "1.4.0", "builtPagesSha256": {p["page"]: p["sha256"] for p in output["builtPages"]},
                  "task01And02UnchangedSha256": preserved, "productionDiffFrom1418a2f": ""}))
