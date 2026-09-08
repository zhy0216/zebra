"""Archive completed recorder bytes and index all compressed evidence."""
import gzip
import hashlib
import json
from pathlib import Path


root = Path(__file__).resolve().parent
for directory in sorted(root.glob("aa-*")):
    status_path = directory / "status.json"
    if status_path.exists():
        assert json.loads(status_path.read_text())["status"] != "waiting"
    for path in sorted(directory.iterdir()):
        if path.suffix == ".gz":
            continue
        data = path.read_bytes()
        target = path.with_name(path.name + ".gz")
        assert not target.exists()
        target.write_bytes(gzip.compress(data, mtime=0))
        assert gzip.decompress(target.read_bytes()) == data
        path.unlink()
with (root / "evidence-archive.jsonl").open("w") as output:
    for path in sorted(root.rglob("*.gz")):
        compressed = path.read_bytes()
        raw = gzip.decompress(compressed)
        output.write(json.dumps({"file": str(path.relative_to(root)), "rawBytes": len(raw), "rawSha256": hashlib.sha256(raw).hexdigest(), "gzipSha256": hashlib.sha256(compressed).hexdigest()}) + "\n")
print("Indexed all compressed evidence without changing its uncompressed bytes.")
