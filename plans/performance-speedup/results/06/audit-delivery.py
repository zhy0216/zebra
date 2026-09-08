"""Validate documentation links, retained log identities and exclusive file scope."""
import gzip
import hashlib
import json
from pathlib import Path
import re
import subprocess

OUT = Path(__file__).resolve().parent
ROOT = OUT.parents[3]


def sha(data):
    return hashlib.sha256(data).hexdigest()


checked = []
for filename in ('checks.jsonl', 'windows.jsonl', 'external-evidence.jsonl'):
    for row in map(json.loads, (OUT / filename).read_text().splitlines()):
        name = row.get('log') or row['retained']
        raw = gzip.decompress((OUT / name).read_bytes())
        assert sha(raw) == row['rawSha256'], name
        checked.append(name)
        if filename == 'checks.jsonl':
            assert row['exit'] == 0, row

docs = [ROOT / 'bench/README.md', OUT / 'REPORT.md', OUT / 'REPRODUCE.md',
        ROOT / 'plans/performance-speedup/todos/README.md']
links = []
for path in docs:
    for target in re.findall(r'\[[^\]]*\]\(([^)]+)\)', path.read_text()):
        if '://' in target or target.startswith('#'):
            continue
        destination = (path.parent / target.split('#', 1)[0]).resolve()
        assert destination.exists(), (path, target)
        links.append({'document': str(path.relative_to(ROOT)), 'target': target})
baseline_readme = subprocess.check_output(['git', 'show', '5530f767:bench/README.md'], cwd=ROOT)
assert (ROOT / 'bench/README.md').read_bytes().startswith(baseline_readme)
names = subprocess.check_output(['git', 'diff', '--name-only', 'HEAD'], cwd=ROOT, text=True).splitlines()
untracked = subprocess.check_output(['git', 'ls-files', '--others', '--exclude-standard'], cwd=ROOT, text=True).splitlines()
allowed = {'bench/README.md', 'plans/performance-speedup/todos/README.md',
           'plans/performance-speedup/todos/06-results-and-validation.md',
           'plans/performance-speedup/todos/done/06-results-and-validation.md'}
assert all(p in allowed or p.startswith('plans/performance-speedup/results/06/') for p in names + untracked)
for name in ('source-before.jsonl', 'source-after.jsonl'):
    source = json.loads((OUT / name).read_text())
    assert source['productionDiff'] == [] and source['productionFileCount'] == 80
assert not re.search(r'Pending final|FINAL_WINDOW_RESULTS|FINAL_HISTORICAL_RESULTS|Final archival/check details are recorded after', (OUT / 'REPORT.md').read_text())
record = {'logsVerified': len(checked), 'localLinksVerified': len(links),
          'historicalBenchmarkReadmePreservedByteForByte': True,
          'exclusiveFileScope': True, 'changedFiles': sorted(set(names + untracked)),
          'documentationSha256': {str(p.relative_to(ROOT)): sha(p.read_bytes()) for p in docs},
          'links': links}
(OUT / 'delivery-audit.jsonl').write_text(json.dumps(record) + '\n')
print(json.dumps({k: v for k, v in record.items() if k not in ('links', 'changedFiles')}))
