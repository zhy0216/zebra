"""Check and archive task-local browser bundles; run inside the check lock."""
import gzip
import hashlib
import json
from pathlib import Path
import re
import sys


root = Path(__file__).resolve().parent
for package in ("client", "contract"):
    file = root / f"browser-{package}-{sys.argv[1]}.js"
    data = file.read_bytes()
    found = bool(re.search(rb"\bBun\s*[.\[]", data))
    print(json.dumps({"file": file.name, "sha256": hashlib.sha256(data).hexdigest(), "bunRuntimeReference": found}))
    file.with_suffix(".js.gz").write_bytes(gzip.compress(data, mtime=0))
    file.unlink()
    assert not found
