"""Bounded task-04 comparisons. Each complete series takes exactly one measure lock."""
import argparse
import csv
import datetime
import gzip
import json
import math
import os
from pathlib import Path
import statistics
import subprocess

OUT = Path(__file__).resolve().parent
ROOT = OUT.parents[3]
PROTO = Path('/home/ubuntu/workspace/zebra/plans/performance-speedup/results/01')
HARNESS = '/home/ubuntu/workspace/zebra/bench/hot-path.ts'
BASELINE = '/tmp/zebra-performance-speedup-01/baseline-a856cab'
LOCK = '/tmp/zebra-performance-speedup-f3263289/run-load.py'
BASE_SHA = '7a9eb1077326654812aabcad8519086ce61b28350a6160582ec01cbce90c9b73'
HARNESS_SHA = 'b4a3feb23f5d26c8b6121d35e1b121b2b5ab6221b45a62ae4ddf42dd8a31a976'


def read_status(directory):
    path = directory / 'status.json'
    data = path.read_bytes() if path.exists() else gzip.decompress(path.with_suffix('.json.gz').read_bytes())
    return json.loads(data)


def read_records(directory):
    path = directory / 'stdout.log'
    if path.exists():
        data = path.read_text()
    elif path.with_suffix('.log.gz').exists():
        data = gzip.decompress(path.with_suffix('.log.gz').read_bytes()).decode()
    else:
        return []
    return [json.loads(line) for line in data.splitlines()]


def series(name, suite, control=False):
    command = ['python3', LOCK, 'measure', 'python3', str(PROTO / 'measure.py'),
               '--output', str(OUT / name), 'python3', str(PROTO / 'series.py'),
               '--harness', HARNESS, '--before', BASELINE,
               '--after', BASELINE if control else str(ROOT), '--suite', suite]
    print(json.dumps({'command': command, 'PATH': os.environ['PATH']}), flush=True)
    subprocess.run(command, cwd=ROOT, check=False)
    return read_status(OUT / name)


def freeze_controls():
    envelopes = []
    for suite in ['di', 'http']:
        selected = [directory for directory in sorted(OUT.glob(f'aa-140-{suite}-*'))
                    if read_status(directory).get('eligible')]
        assert len(selected) <= 1
        if not selected:
            continue
        records = read_records(selected[0])
        environments = [r for r in records if r['type'] == 'environment']
        assert len(environments) == 10
        assert len({r['pid'] for r in environments}) == 10
        assert all(r['source']['productionSha256'] == BASE_SHA and
                   r['source']['productionDiff']['changes'] == [] and
                   r['source']['root'] == BASELINE and
                   r['source']['lockSha256'] == r['harness']['lockSha256'] and
                   r['harness']['sha256'] == HARNESS_SHA and not r['harness']['diff'] and
                   r['runtime']['bun'] == '1.4.0' for r in environments)
        assert len([r for r in records if r['type'] == 'complete' and r['ok']]) == 10
        assert len([r for r in records if r['type'] == 'exit' and r['code'] == 0]) == 10
        rows = {}
        for r in records:
            if r['type'] == 'round':
                for metric in (['rps', 'p50', 'p95', 'p99'] if suite == 'http' else ['nsPerOp']):
                    rows.setdefault((r['name'], metric), {})[r['side'], r['pair']] = r[metric]
        for (fixture, metric), values in rows.items():
            changes = [abs(100 * (values['B', pair] / values['A', pair] - 1))
                       for pair in range(1, 6)]
            p90 = sorted(changes)[math.ceil(len(changes) * .9) - 1]
            envelopes.append({'bun': '1.4.0', 'suite': suite, 'fixture': fixture, 'metric': metric,
                              'samples': 5, 'median_abs_pair_pct': statistics.median(changes),
                              'p90_abs_pair_pct': p90, 'envelope_pct': max(5, p90),
                              'noisy': max(5, p90) > 20, 'control': selected[0].name})
    with (OUT / 'variability-140.csv').open('x') as file:
        fields = ['bun', 'suite', 'fixture', 'metric', 'samples', 'median_abs_pair_pct',
                  'p90_abs_pair_pct', 'envelope_pct', 'noisy', 'control']
        writer = csv.DictWriter(file, fieldnames=fields, lineterminator='\n')
        writer.writeheader()
        writer.writerows(envelopes)
    with (OUT / 'controls-frozen.jsonl').open('x') as file:
        file.write(json.dumps({'at': datetime.datetime.now(datetime.timezone.utc).isoformat(),
                               'supportedSuites': sorted({r['suite'] for r in envelopes}),
                               'envelopes': len(envelopes),
                               'rule': 'First eligible control only; at most two attempts per suite.'}) + '\n')


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('stage', choices=['controls-140', 'candidate-142', 'candidate-140'])
    args = parser.parse_args()
    minimum = args.stage.endswith('140')
    prefix = '/tmp/zebra-performance-speedup-01/runtime/bun-1.4.0' if minimum else '/home/ubuntu/.bun/bin'
    os.environ['PATH'] = prefix + ':' + os.environ['PATH']
    if args.stage == 'controls-140':
        for suite in ['di', 'http']:
            for attempt in [1, 2]:
                if series(f'aa-140-{suite}-{attempt}', suite, control=True).get('eligible'):
                    break
        freeze_controls()
    elif args.stage.startswith('candidate'):
        if minimum:
            assert (OUT / 'controls-frozen.jsonl').exists(), 'Freeze controls before candidate timing'
        for suite in ['di', 'dispatch', 'http']:
            for confirmation in [1, 2]:
                series(f'{args.stage}-{suite}-{confirmation}', suite)


if __name__ == '__main__':
    main()
