"""Inspect all task-04 controls/comparisons without excluding individual pairs."""
import csv
import json
import math
from pathlib import Path
import statistics
import sys

sys.dont_write_bytecode = True
from measurements import BASE_SHA, HARNESS_SHA, OUT, PROTO, read_records, read_status


def main():
    current = OUT / 'variability-142.csv'
    if not current.exists():
        current.write_bytes((PROTO / 'variability.csv').read_bytes())
    assert current.read_bytes() == (PROTO / 'variability.csv').read_bytes()
    controls = {}
    for path in [current, OUT / 'variability-140.csv']:
        if path.exists():
            for row in csv.DictReader(path.open()):
                controls[row['bun'], row['suite'], row['fixture'], row['metric']] = float(row['envelope_pct'])
    summaries = []
    provenance = []
    for directory in sorted(OUT.iterdir()):
        if not directory.is_dir() or not directory.name.startswith(('aa-', 'candidate-')):
            continue
        status = read_status(directory)
        records = read_records(directory)
        envs = [r for r in records if r['type'] == 'environment']
        complete = [r for r in records if r['type'] == 'complete' and r['ok']]
        exits = [r for r in records if r['type'] == 'exit']
        rounds = [r for r in records if r['type'] == 'round']
        eligible = status.get('eligible', False)
        if status.get('status') == 'complete':
            assert len(envs) == len(complete) == len(exits) == 10
            assert len({r['pid'] for r in envs}) == 10
            assert all(r['code'] == 0 for r in exits)
            assert all(r['harness']['sha256'] == HARNESS_SHA and not r['harness']['diff'] for r in envs)
            assert all(r['source']['lockSha256'] == r['harness']['lockSha256'] for r in envs)
            assert len({r['runtime']['revision'] for r in envs}) == 1
            assert all(r['source']['productionSha256'] == BASE_SHA for r in envs if r['side'] == 'A')
            assert all(not r['source']['productionDiff'].get('changes') for r in envs if r['side'] == 'A')
            assert len({r['source']['productionSha256'] for r in envs if r['side'] == 'B'}) == 1
            if directory.name.startswith('aa-'):
                assert all(r['source']['productionSha256'] == BASE_SHA for r in envs)
            for pair in range(1, 6):
                assert [r['side'] for r in envs if r['pair'] == pair] == (['A', 'B'] if pair % 2 else ['B', 'A'])
        provenance.append({'run': directory.name, 'status': status, 'environments': len(envs),
                           'complete': len(complete), 'rounds': len(rounds),
                           'runtimes': list({json.dumps(r['runtime'], sort_keys=True) for r in envs}),
                           'sources': list({json.dumps(r['source'], sort_keys=True) for r in envs})})
        rows = {}
        for row in rounds:
            for metric in (['rps', 'p50', 'p95', 'p99'] if row['suite'] == 'http' else ['nsPerOp']):
                values = rows.setdefault((row['suite'], row['name'], metric), {})
                key = row['side'], row['pair']
                assert key not in values
                assert math.isfinite(row[metric]) and row[metric] > 0
                values[key] = row[metric]
        for (suite, fixture, metric), values in rows.items():
            pairs = [p for p in range(1, 6) if ('A', p) in values and ('B', p) in values]
            if not pairs:
                continue
            if eligible:
                assert len(pairs) == 5
            before = [values['A', p] for p in pairs]
            after = [values['B', p] for p in pairs]
            changes = [100 * (b / a - 1) for a, b in zip(before, after)]
            absolute = sorted(map(abs, changes))
            a, b = statistics.median(before), statistics.median(after)
            change = 100 * (b / a - 1)
            direction = 1 if metric == 'rps' else -1
            improvement = direction * change
            envelope = controls.get((envs[0]['runtime']['bun'], suite, fixture, metric))
            target = 5 if suite == 'http' else 10
            improving_pairs = sum(direction * c > 0 for c in changes)
            regressing_pairs = sum(direction * c < 0 for c in changes)
            summaries.append({'run': directory.name, 'bun': envs[0]['runtime']['bun'],
                              'eligible': eligible, 'suite': suite, 'fixture': fixture, 'metric': metric,
                              'pairs': len(pairs), 'median_A': a, 'median_B': b,
                              'median_change_pct': change, 'improvement_pct': improvement,
                              'median_abs_pair_pct': statistics.median(absolute),
                              'p90_abs_pair_pct': absolute[math.ceil(len(absolute) * .9) - 1],
                              'A_mad_pct': 100 * statistics.median([abs(v-a) for v in before]) / a,
                              'B_mad_pct': 100 * statistics.median([abs(v-b) for v in after]) / b,
                              'improving_pairs': improving_pairs, 'regressing_pairs': regressing_pairs,
                              'envelope_pct': envelope, 'noisy_control': envelope is not None and envelope > 20,
                              'clears_gain_threshold': eligible and envelope is not None and
                              improvement > max(target, envelope) and improving_pairs >= 4,
                              'http_regression_flag': eligible and metric in ['rps', 'p95'] and
                              improvement < -5 and regressing_pairs >= 4,
                              'paired_changes_pct': json.dumps(changes),
                              'A_values': json.dumps(before), 'B_values': json.dumps(after)})
    if summaries:
        with (OUT / 'summary.csv').open('w') as file:
            writer = csv.DictWriter(file, fieldnames=list(summaries[0]), lineterminator='\n')
            writer.writeheader()
            writer.writerows(summaries)
    with (OUT / 'measurement-provenance.jsonl').open('w') as file:
        for row in provenance:
            file.write(json.dumps(row) + '\n')
    print(json.dumps({'runs': len(provenance), 'rows': len(summaries),
                      'eligibleRuns': [r['run'] for r in provenance if r['status'].get('eligible')],
                      'gainRows': sum(r['clears_gain_threshold'] and r['run'].startswith('candidate') for r in summaries)}))


if __name__ == '__main__':
    main()
