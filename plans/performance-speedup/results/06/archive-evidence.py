"""Retain ignored diagnostics byte-for-byte and index completed evidence."""
import gzip
import hashlib
import json
from pathlib import Path

OUT = Path(__file__).resolve().parent


def sha(data):
    return hashlib.sha256(data).hexdigest()


raw_files = [path for path in OUT.glob('*/*')
             if path.name in ('status.json', 'load.jsonl', 'stdout.log', 'stderr.log')]
for path in raw_files:
    if path.name == 'status.json':
        assert json.loads(path.read_text())['status'] in ('quiet-timeout', 'complete', 'failed')
for path in raw_files:
    target = path.with_suffix(path.suffix + '.gz')
    original = path.read_bytes()
    if target.exists():
        assert gzip.decompress(target.read_bytes()) == original, path
    else:
        target.write_bytes(gzip.compress(original, mtime=0))
    assert gzip.decompress(target.read_bytes()) == original
    # Archive completed recorder output without formatting its original bytes.
    path.unlink()

rows = []
for path in sorted(OUT.rglob('*')):
    if not path.is_file() or 'dist' in path.parts or '__pycache__' in path.parts:
        continue
    if path.suffix not in ('.gz', '.json', '.jsonl') or path.name == 'evidence-index.jsonl':
        continue
    data = path.read_bytes()
    row = {'file': str(path.relative_to(OUT)), 'bytes': len(data), 'sha256': sha(data)}
    if path.suffix == '.gz':
        raw = gzip.decompress(data)
        row.update(rawBytes=len(raw), rawSha256=sha(raw))
    rows.append(row)
(OUT / 'evidence-index.jsonl').write_text(''.join(json.dumps(row) + '\n' for row in rows))
print(f'Indexed {len(rows)} durable evidence artifacts; gzip preserves original bytes.')
