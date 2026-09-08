"""Bounded series scheduling; invoke INSIDE a single run-load.py measure lock."""
import argparse
import csv
import gzip
import json
from pathlib import Path
import subprocess

OUT = Path(__file__).resolve().parent
ROOT = OUT.parents[3]
PROTO = Path('/home/ubuntu/workspace/zebra/plans/performance-speedup/results/01')
HARNESS = '/home/ubuntu/workspace/zebra/bench/hot-path.ts'
BEFORE = '/tmp/zebra-performance-speedup-01/baseline-a856cab'


def read(path):
    if path.exists():
        return path.read_text()
    with gzip.open(str(path) + '.gz', 'rt') as file:
        return file.read()


def run(name, suite, control):
    destination = OUT / name
    if not destination.exists():
        command = ['python3', str(PROTO / 'measure.py'), '--output', str(destination),
                   'python3', str(PROTO / 'series.py'), '--harness', HARNESS,
                   '--before', BEFORE, '--after', BEFORE if control else str(ROOT),
                   '--suite', suite]
        subprocess.run(command, cwd=ROOT, check=False)
    status = json.loads(read(destination / 'status.json'))
    return status.get('eligible', False)


def save_control(name):
    rows = [json.loads(line) for line in read(OUT / name / 'stdout.log').splitlines()]
    envs = [row for row in rows if row['type'] == 'environment']
    complete = [row for row in rows if row['type'] == 'complete' and row['ok']]
    exits = [row for row in rows if row['type'] == 'exit' and row['code'] == 0]
    assert len(envs) == len(complete) == len(exits) == 10
    assert len({row['pid'] for row in envs}) == 10
    assert len({row['source']['lockSha256'] for row in envs}) == 1
    for row in envs:
        assert row['source']['productionSha256'] == '7a9eb1077326654812aabcad8519086ce61b28350a6160582ec01cbce90c9b73'
        assert row['source']['root'] == BEFORE
        assert row['source']['productionDiff']['changes'] == []
        assert row['harness']['sha256'] == 'b4a3feb23f5d26c8b6121d35e1b121b2b5ab6221b45a62ae4ddf42dd8a31a976'
        assert not row['harness']['diff']
        assert row['runtime']['bun'] == '1.4.0'
    for pair in range(1, 6):
        assert [row['side'] for row in envs if row['pair'] == pair] == (['A', 'B'] if pair % 2 else ['B', 'A'])
    values = {}
    for row in rows:
        if row['type'] != 'round':
            continue
        for metric in (['rps', 'p50', 'p95', 'p99'] if row['suite'] == 'http' else ['nsPerOp']):
            key = row['suite'], row['name'], metric
            values.setdefault(key, {})[row['pair'], row['side']] = row[metric]
    envelopes = []
    for (suite, name_, metric), data in values.items():
        assert len(data) == 10
        changes = [100 * (data[pair, 'B'] / data[pair, 'A'] - 1) for pair in range(1, 6)]
        envelope = max(5, max(map(abs, changes)))
        envelopes.append(dict(control=name, bun='1.4.0', suite=suite, fixture=name_,
                              metric=metric, samples=5, envelope_pct=envelope,
                              noisy=envelope > 20, paired_changes_pct=json.dumps(changes)))
    path = OUT / f'{name}-envelopes.csv'
    if not path.exists():
        with path.open('w') as file:
            writer = csv.DictWriter(file, fieldnames=list(envelopes[0]), lineterminator='\n')
            writer.writeheader()
            writer.writerows(envelopes)


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('mode', choices=['controls', 'record-controls', 'candidate'])
    parser.add_argument('--runtime', choices=['140', '142'], default='140')
    parser.add_argument('--suite', choices=['router', 'dispatch', 'http'])
    args = parser.parse_args()
    if args.mode == 'controls':
        for suite in ['router', 'http']:
            # Charge the cancelled, still-lock-waiting HTTP request to its allowance.
            for attempt in ([1, 2] if suite == 'router' else [2]):
                name = f'aa-140-{suite}-{attempt}'
                destination = OUT / name
                if destination.exists():
                    status = json.loads(read(destination / 'status.json'))
                    assert status['status'] != 'waiting', 'A recorder is already active.'
                    if status.get('eligible', False):
                        break
                else:
                    run(name, suite, True)
                    return  # One recorder attempt per lock allocation.
        print('No remaining control attempts.', flush=True)
    elif args.mode == 'record-controls':
        decisions = []
        for suite in ['router', 'http']:
            eligible = None
            for attempt in ([1, 2] if suite == 'router' else [2]):
                name = f'aa-140-{suite}-{attempt}'
                if not (OUT / name).exists():
                    continue
                status = json.loads(read(OUT / name / 'status.json'))
                if status.get('eligible', False):
                    save_control(name)
                    eligible = name
                    break
            decisions.append(dict(suite=suite, bun='1.4.0', eligibleControl=eligible,
                                  maximumAttempts=2))
        (OUT / 'control-decisions.jsonl').write_text(''.join(json.dumps(row) + '\n' for row in decisions))
        print(json.dumps(decisions), flush=True)
    else:
        assert args.suite
        if args.runtime == '140':
            decisions = [json.loads(line) for line in (OUT / 'control-decisions.jsonl').read_text().splitlines()]
            assert all(any(row['suite'] == suite and row['eligibleControl'] for row in decisions)
                       for suite in ['router', 'http']), 'Minimum controls unsupported: no candidate timing.'
        eligible = []
        for attempt in range(1, 5):
            name = f'candidate-{args.runtime}-{args.suite}-{attempt}'
            destination = OUT / name
            if destination.exists():
                status = json.loads(read(destination / 'status.json'))
                assert status['status'] != 'waiting', 'A recorder is already active.'
                if status.get('eligible', False):
                    eligible.append(name)
                    if len(eligible) == 2:
                        break
            else:
                run(name, args.suite, False)
                return  # Release the measurement lock before another attempt.
        print(json.dumps(dict(suite=args.suite, runtime=args.runtime,
                              eligible=eligible, maximumAttempts=4)), flush=True)


if __name__ == '__main__':
    main()
