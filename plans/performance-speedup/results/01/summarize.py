"""Summarize every A/A row; never discard individual measurements."""
import argparse
import csv
import json
import math
from pathlib import Path
import statistics


def percentile90(values):
    return sorted(values)[math.ceil(len(values) * .9) - 1]


def median(values):
    return statistics.median(values)


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('directory')
    args = parser.parse_args()
    root = Path(args.directory)
    summaries = []
    controls = {}
    provenance = []
    for directory in sorted(root.glob('aa-*')):
        status = json.loads((directory / 'status.json').read_text())
        if not (directory / 'stdout.log').exists():
            provenance.append({'run': directory.name, 'status': status})
            continue
        records = [json.loads(line) for line in (directory / 'stdout.log').read_text().splitlines()]
        environments = [record for record in records if record['type'] == 'environment']
        if not environments:
            provenance.append({'run': directory.name, 'status': status})
            continue
        complete = [record for record in records if record['type'] == 'complete' and record['ok']]
        exits = [record for record in records if record['type'] == 'exit']
        eligible = status.get('eligible', False)
        if eligible:
            assert len(environments) == len(complete) == len(exits) == 10
            assert all(record['code'] == 0 for record in exits)
            assert len({record['pid'] for record in environments}) == 10
            assert len({record['source']['productionSha256'] for record in environments}) == 1
            assert len({record['harness']['sha256'] for record in environments}) == 1
            assert len({record['runtime']['revision'] for record in environments}) == 1
            assert all(not record['harness']['diff'] for record in environments)
            for pair in range(1, 6):
                envs = [record for record in environments if record['pair'] == pair]
                assert [record['side'] for record in envs] == (['A', 'B'] if pair % 2 else ['B', 'A'])
                assert len({record['source']['root'] for record in envs}) == 2
        runtime = environments[0]['runtime']['bun']
        rows = {}
        for record in records:
            if record['type'] != 'round':
                continue
            for metric in (['rps', 'p50', 'p95', 'p99'] if record['suite'] == 'http' else ['nsPerOp']):
                key = (record['suite'], record['name'], metric)
                values = rows.setdefault(key, {})
                side_pair = (record['side'], record['pair'])
                assert side_pair not in values
                value = record[metric]
                assert math.isfinite(value) and value > 0
                values[side_pair] = value
        for (suite, name, metric), values in rows.items():
            pairs = [pair for pair in range(1, 6) if ('A', pair) in values and ('B', pair) in values]
            if eligible:
                assert pairs == list(range(1, 6))
            if not pairs:
                continue
            before = [values['A', pair] for pair in pairs]
            after = [values['B', pair] for pair in pairs]
            changes = [100 * (b / a - 1) for a, b in zip(before, after)]
            absolute = list(map(abs, changes))
            summaries.append({
                'run': directory.name, 'bun': runtime, 'eligible': eligible, 'suite': suite,
                'fixture': name, 'metric': metric, 'pairs': len(pairs),
                'median_A': median(before), 'median_B': median(after),
                'median_change_pct': 100 * (median(after) / median(before) - 1),
                'median_abs_pair_pct': median(absolute), 'p90_abs_pair_pct': percentile90(absolute),
                'A_mad_pct': 100 * median([abs(value - median(before)) for value in before]) / median(before),
                'B_mad_pct': 100 * median([abs(value - median(after)) for value in after]) / median(after),
                'paired_changes_pct': json.dumps(changes),
            })
            if eligible:
                controls.setdefault((runtime, suite, name, metric), []).extend(absolute)
        provenance.append({
            'run': directory.name, 'status': status,
            'runtime': environments[0]['runtime'],
            'sources': list({json.dumps(record['source'], sort_keys=True) for record in environments}),
            'harness': environments[0]['harness'],
            'processes': len(environments), 'completedProcesses': len(complete),
            'roundRecords': sum(record['type'] == 'round' for record in records),
        })
    with (root / 'summary.csv').open('w') as file:
        writer = csv.DictWriter(file, fieldnames=list(summaries[0]), lineterminator='\n')
        writer.writeheader()
        writer.writerows(summaries)
    envelopes = []
    for (runtime, suite, name, metric), values in controls.items():
        envelope = max(5, percentile90(values))
        envelopes.append({'bun': runtime, 'suite': suite, 'fixture': name, 'metric': metric,
                          'samples': len(values), 'median_abs_pair_pct': median(values),
                          'p90_abs_pair_pct': percentile90(values), 'envelope_pct': envelope,
                          'noisy': envelope > 20})
    with (root / 'variability.csv').open('w') as file:
        writer = csv.DictWriter(file, fieldnames=list(envelopes[0]), lineterminator='\n')
        writer.writeheader()
        writer.writerows(envelopes)
    (root / 'measurement-provenance.json').write_text(json.dumps(provenance, indent=2) + '\n')
    print(json.dumps({'runs': len(provenance), 'summaries': len(summaries), 'envelopes': len(envelopes),
                      'noisyControls': sum(row['noisy'] for row in envelopes)}))


if __name__ == '__main__':
    main()
