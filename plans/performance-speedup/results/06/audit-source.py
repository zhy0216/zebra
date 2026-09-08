"""Read-only byte comparisons against Git objects and the frozen archive."""
import hashlib
import io
import json
from pathlib import Path
import subprocess
import sys
import tarfile

OUT = Path(__file__).resolve().parent
ROOT = OUT.parents[3]
BASE = 'a856cab47d4fd3102e976ce7a70166837837eea2'
TASK01 = '609c1d298393c49b49e6c11537e55437c5f6a89f'
INTEGRATED = '5530f7678a9df0c92fcdf9e99c268408c913a439'
ARCHIVE = Path('/tmp/zebra-performance-speedup-01/baseline-a856cab')
SHARED = Path('/home/ubuntu/workspace/zebra')


def sha(data):
    return hashlib.sha256(data).hexdigest()


def tree(revision):
    data = subprocess.check_output(['git', 'archive', revision], cwd=ROOT)
    with tarfile.open(fileobj=io.BytesIO(data)) as archive:
        return {m.name: archive.extractfile(m).read() for m in archive.getmembers() if m.isfile()}


baseline, harness, integrated = map(tree, (BASE, TASK01, INTEGRATED))
production = sorted(p for p in baseline if p.startswith('packages/') and '/src/' in p)
actual = sorted(str(p.relative_to(ROOT)) for p in (ROOT / 'packages').glob('*/src/**/*') if p.is_file())
assert actual == production
records = []
for name in production:
    data = (ROOT / name).read_bytes()
    assert data == baseline[name] == harness[name] == integrated[name] == (ARCHIVE / name).read_bytes(), name
    records.append({'file': name, 'sha256': sha(data), 'bytes': len(data)})
archive_metadata = json.loads((ARCHIVE / '.hot-path-source.json').read_text())
assert archive_metadata['revision'] == BASE
ordered = {name: sha((ROOT / name).read_bytes()) for name in archive_metadata['files']}
production_sha = sha(json.dumps(ordered, separators=(',', ':')).encode())
assert production_sha == '7a9eb1077326654812aabcad8519086ce61b28350a6160582ec01cbce90c9b73'
timed = sorted([p for p in harness if p.startswith('bench/hot-path') and p.endswith('.ts')] +
               ['bench/scenarios.ts', 'bench/fixtures/static/hello.txt'])
timed_hashes = {}
for name in timed + ['plans/performance-speedup/results/01/measure.py', 'plans/performance-speedup/results/01/series.py']:
    data = (ROOT / name).read_bytes()
    assert data == harness[name] == (SHARED / name).read_bytes(), name
    if name in timed:
        timed_hashes[name] = sha(data)
harness_sha = sha(json.dumps(timed_hashes, separators=(',', ':')).encode())
assert harness_sha == 'b4a3feb23f5d26c8b6121d35e1b121b2b5ab6221b45a62ae4ddf42dd8a31a976'
protected = sorted(p for p in baseline if (p.startswith('bench/') and p != 'bench/README.md')
                   or p.endswith('package.json') or p in ('bun.lock', 'bunfig.toml', 'CONTRIBUTING.md', 'docs/api-freeze.md'))
for name in protected:
    assert (ROOT / name).read_bytes() == baseline[name], name
tests = sorted(p for p in integrated if '/test/' in p and p.endswith('.ts'))
for name in tests:
    assert (ROOT / name).read_bytes() == integrated[name], name
report = {'head': subprocess.check_output(['git', 'rev-parse', 'HEAD'], cwd=ROOT, text=True).strip(),
          'baseline': BASE, 'task01': TASK01, 'integrated': INTEGRATED,
          'productionFileCount': len(production), 'productionSha256': production_sha,
          'productionDiff': [], 'productionFiles': records,
          'harnessSha256': harness_sha, 'timedFiles': timed_hashes,
          'lockSha256': sha((ROOT / 'bun.lock').read_bytes()),
          'protectedFilesUnchanged': protected, 'integratedTestFilesUnchanged': tests,
          'testsSha256': sha(json.dumps({p: sha(integrated[p]) for p in tests}, separators=(',', ':')).encode()),
          'storeSourceSha256': sha((ROOT / 'packages/session/src/store.ts').read_bytes()),
          'storeTestSha256': sha((ROOT / 'packages/session/test/store.test.ts').read_bytes())}
target = OUT / sys.argv[1]
assert not target.exists(), target
target.write_text(json.dumps(report) + '\n')
print(json.dumps({k: v for k, v in report.items() if k not in ('productionFiles', 'protectedFilesUnchanged', 'integratedTestFilesUnchanged')}))
