"""Summarize all retained metadata comparisons, preserving whole-run eligibility."""
import csv
import gzip
import json
from pathlib import Path
import statistics


OUT = Path(__file__).resolve().parent
HARNESS = 'b4a3feb23f5d26c8b6121d35e1b121b2b5ab6221b45a62ae4ddf42dd8a31a976'
BASELINE = '7a9eb1077326654812aabcad8519086ce61b28350a6160582ec01cbce90c9b73'


def read(path):
    if path.exists():
        return path.read_text()
    compressed = path.with_name(path.name + '.gz')
    return gzip.decompress(compressed.read_bytes()).decode() if compressed.exists() else ''


def csv_write(name, rows):
    if rows:
        with (OUT / name).open('w') as file:
            writer = csv.DictWriter(file, fieldnames=list(rows[0]), lineterminator='\n')
            writer.writeheader()
            writer.writerows(rows)


def main():
    controls = {}
    for name in ['controls-142.csv', 'controls-140.csv']:
        for row in csv.DictReader(read(OUT / name).splitlines()):
            controls[row['bun'], row['suite'], row['fixture'], row['metric']] = float(row['envelope_pct'])
    summary = []
    memory = []
    provenance = []
    for directory in sorted(OUT.iterdir()):
        if not directory.is_dir() or not directory.name.startswith(('aa-', 'candidate-', 'historical-')):
            continue
        status = json.loads(read(directory / 'status.json'))
        if directory.name.startswith('historical-'):
            provenance.append({'run': directory.name, 'status': status})
            continue
        records = [json.loads(line) for line in read(directory / 'stdout.log').splitlines()]
        envs = [r for r in records if r['type'] == 'environment']
        rounds = [r for r in records if r['type'] == 'round']
        complete = [r for r in records if r['type'] == 'complete' and r['ok']]
        eligible = status.get('eligible', False)
        if envs:
            assert all(e['harness']['sha256'] == HARNESS and not e['harness']['diff'] for e in envs)
            assert len({e['source']['lockSha256'] for e in envs}) == 1
            assert all(e['source']['productionSha256'] == BASELINE for e in envs if e['side'] == 'A')
            assert len({e['source']['productionSha256'] for e in envs if e['side'] == 'B'}) == 1
            assert len({e['runtime']['revision'] for e in envs}) == 1
        if eligible or status.get('status') == 'complete':
            expected = 30 if directory.name.startswith('candidate-') else 10
            assert len(envs) == len(complete) == len({e['pid'] for e in envs}) == expected
            assert len([r for r in records if r['type'] == 'exit' and r['code'] == 0]) == expected
            for suite in {r['options']['suite'] for r in envs}:
                for pair in range(1, 6):
                    assert [r['side'] for r in envs if r['pair'] == pair
                            and r['options']['suite'] == suite] == (
                        ['A', 'B'] if pair % 2 else ['B', 'A'])
        provenance.append({'run': directory.name, 'status': status, 'processes': len(envs),
                           'completedProcesses': len(complete), 'rounds': len(rounds),
                           'sources': list({json.dumps(e['source'], sort_keys=True) for e in envs}),
                           'runtime': envs[0]['runtime'] if envs else None,
                           'harness': envs[0]['harness'] if envs else None})
        rows = {}
        memory_rows = {}
        for row in rounds:
            for metric in (['rps', 'p50', 'p95', 'p99'] if row['suite'] == 'http' else ['nsPerOp']):
                rows.setdefault((row['suite'], row['name'], metric), {})[row['side'], row['pair']] = row[metric]
            if row['suite'] != 'http':
                for metric in ['rssDelta', 'heapUsedDelta']:
                    memory_rows.setdefault((row['suite'], row['name'], metric, row['side']), []).append(row[metric])
        for (suite, name, metric), values in rows.items():
            pairs = [i for i in range(1, 6) if ('A', i) in values and ('B', i) in values]
            if not pairs:
                continue
            before, after = [[values[side, i] for i in pairs] for side in ['A', 'B']]
            changes = [100 * (b / a - 1) for a, b in zip(before, after)]
            absolute = list(map(abs, changes))
            change = 100 * (statistics.median(after) / statistics.median(before) - 1)
            improvement = change if metric == 'rps' else -change
            positive = sum((c > 0 if metric == 'rps' else c < 0) for c in changes)
            regression_pairs = sum((c < -5 if metric == 'rps' else c > 5) for c in changes)
            envelope = controls.get((envs[0]['runtime']['bun'], suite, name, metric))
            target = 5 if suite == 'http' else 10
            summary.append({'run': directory.name, 'bun': envs[0]['runtime']['bun'],
                            'eligible': eligible, 'suite': suite, 'fixture': name, 'metric': metric,
                            'pairs': len(pairs), 'median_A': statistics.median(before),
                            'median_B': statistics.median(after), 'median_change_pct': change,
                            'paired_changes_pct': json.dumps(changes),
                            'median_abs_pair_pct': statistics.median(absolute),
                            'p90_abs_pair_pct': max(absolute), 'improving_pairs': positive,
                            'regression_over_5_pairs': regression_pairs,
                            'fixed_envelope_pct': envelope if envelope is not None else '',
                            'noisy_control': envelope > 20 if envelope is not None else '',
                            'clears_gain_rule': eligible and len(pairs) == 5 and positive >= 4
                            and envelope is not None and improvement > max(target, envelope)})
        for (suite, name, metric, side), values in memory_rows.items():
            memory.append({'run': directory.name, 'eligible': eligible, 'suite': suite,
                           'fixture': name, 'metric': metric, 'side': side,
                           'median_bytes': statistics.median(values), 'min_bytes': min(values),
                           'max_bytes': max(values), 'all_bytes': json.dumps(values)})
    csv_write('summary.csv', summary)
    csv_write('memory.csv', memory)
    (OUT / 'measurement-provenance.txt').write_text(json.dumps(provenance, indent=2) + '\n')
    print(json.dumps({'runs': len(provenance), 'summaryRows': len(summary), 'memoryRows': len(memory)}))


if __name__ == '__main__':
    main()
