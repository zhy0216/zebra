"""Inspect the exact browser build outputs and retain their identities."""
import hashlib
import json
from pathlib import Path
import re
import sys

root = Path(__file__).resolve().parent / 'dist' / sys.argv[1]
files = sorted(root.rglob('*.js'))
assert len(files) == 2, files
failed = False
for path in files:
    data = path.read_bytes()
    matches = re.findall(r'\bBun\b|bun:', data.decode())
    failed |= bool(matches)
    print(json.dumps({'file': str(path), 'bytes': len(data),
                      'sha256': hashlib.sha256(data).hexdigest(), 'bunReferences': matches}))
raise SystemExit(int(failed))
