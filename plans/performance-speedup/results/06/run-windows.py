"""Exactly one final comparison and one historical attempt per runtime; no retries.

Invoke without an outer lock. Each child takes and releases its own allocation.
"""
import datetime
import gzip
import hashlib
import json
import os
from pathlib import Path
import subprocess

OUT = Path(__file__).resolve().parent
ROOT = OUT.parents[3]
LOCK = '/tmp/zebra-performance-speedup-f3263289/run-load.py'
PROTO = Path('/home/ubuntu/workspace/zebra/plans/performance-speedup/results/01')
HARNESS = '/home/ubuntu/workspace/zebra/bench/hot-path.ts'
BASELINE = '/tmp/zebra-performance-speedup-01/baseline-a856cab'
RUNTIMES = {'142': '/home/ubuntu/.bun/bin',
            '140': '/tmp/zebra-performance-speedup-01/runtime/bun-1.4.0'}

for kind, runtime in [('paired', '142'), ('paired', '140'), ('historical', '142'), ('historical', '140')]:
    label = f'{kind}-{runtime}'
    target = OUT / label
    assert not target.exists(), target
    env = os.environ.copy()
    env['PATH'] = RUNTIMES[runtime] + ':' + env['PATH']
    # The historical gate must use its original defaults.
    for name in ('BENCH_DURATION_MS', 'BENCH_CONCURRENCY'):
        env.pop(name, None)
    if kind == 'paired':
        child = ['python3', str(PROTO / 'series.py'), '--harness', HARNESS,
                 '--before', BASELINE, '--after', str(ROOT), '--suite', 'all']
    else:
        child = ['bun', 'run', 'bench:check']
    command = ['python3', LOCK, 'measure', 'python3', str(PROTO / 'measure.py'),
               '--output', str(target), *child]
    record = {'label': label, 'runtime': runtime, 'command': command, 'cwd': str(ROOT),
              'PATH': env['PATH'], 'benchmarkEnvOverrides': {},
              'requested': datetime.datetime.now(datetime.timezone.utc).isoformat()}
    print(json.dumps(record), flush=True)
    result = subprocess.run(command, cwd=ROOT, env=env, stdout=subprocess.PIPE, stderr=subprocess.STDOUT)
    data = result.stdout
    (OUT / f'{label}-wrapper.log.gz').write_bytes(gzip.compress(data, mtime=0))
    record.update(exit=result.returncode, finished=datetime.datetime.now(datetime.timezone.utc).isoformat(),
                  log=f'{label}-wrapper.log.gz', rawSha256=hashlib.sha256(data).hexdigest())
    with (OUT / 'windows.jsonl').open('a') as manifest:
        manifest.write(json.dumps(record) + '\n')
    print(data.decode(errors='replace'), flush=True)
    print(f'{label}: allocation released, exit {result.returncode}', flush=True)
    if not (target / 'status.json').exists():
        raise RuntimeError('Recorder did not create status; stop scheduling for review')
    status = json.loads((target / 'status.json').read_text())
    if status['status'] not in ('complete', 'failed', 'quiet-timeout'):
        raise RuntimeError(f'Unexpected recorder status: {status}')
