"""Summarize all four completed windows, retaining timeout vs gate distinctions."""
import gzip
import json
from pathlib import Path

OUT = Path(__file__).resolve().parent


def read(path):
    if path.exists():
        return path.read_text()
    compressed = path.with_suffix(path.suffix + '.gz')
    return gzip.decompress(compressed.read_bytes()).decode() if compressed.exists() else ''


records = []
for label in ('paired-142', 'paired-140', 'historical-142', 'historical-140'):
    directory = OUT / label
    status = json.loads(read(directory / 'status.json'))
    assert status['status'] in ('quiet-timeout', 'complete', 'failed'), status
    loads = [json.loads(row) for row in read(directory / 'load.jsonl').splitlines()]
    quiet = [row for row in loads if row['phase'] == 'quiet']
    streak = best = 0
    for row in quiet:
        streak = 0 if row['outside'] else streak + 1
        best = max(best, streak)
    stdout = read(directory / 'stdout.log')
    timing = []
    if label.startswith('paired'):
        timing = [json.loads(row) for row in stdout.splitlines()]
    rounds = [row for row in timing if row['type'] == 'round']
    invocations = [row for row in timing if row['type'] == 'invocation']
    record = {'label': label, 'status': status['status'], 'started': status['started'],
              'finished': status['finished'], 'workloadStarted': 'measurementStarted' in status,
              'recorderExit': 2 if status['status'] == 'quiet-timeout' else status['exit'],
              'workloadExit': status.get('exit'), 'quietSamples': len(quiet),
              'blockedQuietSamples': sum(bool(row['outside']) for row in quiet),
              'longestQuietStreak': best,
              'maximumOutsideCpuPercentOfOneCore': max((p['cpuPercentOneCore'] for r in loads for p in r['outside']), default=0),
              'measuredInterferenceSamples': status['interferenceSamples'],
              'timedRows': len(rounds), 'timedBunInvocations': len(invocations),
              'gateResult': ('NOT RUN' if 'measurementStarted' not in status else
                             ('PASS' if status['exit'] == 0 else 'FAIL')) if label.startswith('historical') else None}
    if status['status'] == 'quiet-timeout':
        assert not stdout and not rounds and not invocations
    records.append(record)
(OUT / 'measurement-summary.jsonl').write_text(''.join(json.dumps(row) + '\n' for row in records))
for row in records:
    print(json.dumps(row))
