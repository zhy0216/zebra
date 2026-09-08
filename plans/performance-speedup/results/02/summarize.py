"""Derived reports only: preserve every raw record and whole-run eligibility."""
import csv
import gzip
import json
from pathlib import Path
import statistics

OUT = Path(__file__).resolve().parent


def read(path):
    if path.exists():
        return path.read_text()
    compressed = Path(str(path) + '.gz')
    if compressed.exists():
        with gzip.open(compressed, 'rt') as file:
            return file.read()
    return ''


def write_csv(name, rows):
    if rows:
        with (OUT / name).open('w') as file:
            writer = csv.DictWriter(file, fieldnames=list(rows[0]), lineterminator='\n')
            writer.writeheader()
            writer.writerows(rows)


def main():
    summaries, registration, provenance = [], [], []
    for directory in sorted(path for path in OUT.iterdir() if path.is_dir()):
        status_text = read(directory / 'status.json')
        if not status_text:
            continue
        status = json.loads(status_text)
        rows = [json.loads(line) for line in read(directory / 'stdout.log').splitlines()
                if line.startswith('{')]
        environments = [row for row in rows if row.get('type') == 'environment']
        rounds = [row for row in rows if row.get('type') == 'round']
        complete = [row for row in rows if row.get('type') == 'complete' and row['ok']]
        provenance.append(dict(run=directory.name, status=status, processes=len(environments),
                               complete=len(complete), rounds=len(rounds),
                               environments=environments))
        if not rounds:
            continue
        runtime = environments[0]['runtime']['bun']
        values = {}
        for row in rounds:
            for metric in (['rps', 'p50', 'p95', 'p99'] if row['suite'] == 'http' else ['nsPerOp']):
                key = row['suite'], row['name'], metric
                values.setdefault(key, {})[row['pair'], row['side']] = row[metric]
            if row['name'].endswith('/registration'):
                registration.append(dict(run=directory.name, bun=runtime,
                                         eligible=status.get('eligible', False),
                                         pair=row['pair'], side=row['side'], order=row['order'],
                                         routes=row['routes'], tables=row['count'],
                                         nsPerTable=row['nsPerOp'], rssDelta=row['rssDelta'],
                                         heapUsedDelta=row['heapUsedDelta']))
        for (suite, fixture, metric), data in values.items():
            pairs = [pair for pair in range(1, 6) if (pair, 'A') in data and (pair, 'B') in data]
            if not pairs:
                continue
            before = [data[pair, 'A'] for pair in pairs]
            after = [data[pair, 'B'] for pair in pairs]
            changes = [100 * (b / a - 1) for a, b in zip(before, after)]
            median_a, median_b = statistics.median(before), statistics.median(after)
            improvement = lambda change: change if metric == 'rps' else -change
            summaries.append(dict(run=directory.name, bun=runtime,
                                  eligible=status.get('eligible', False), suite=suite,
                                  fixture=fixture, metric=metric, pairs=len(pairs),
                                  median_A=median_a, median_B=median_b,
                                  median_change_pct=100 * (median_b / median_a - 1),
                                  improving_pairs=sum(improvement(value) > 0 for value in changes),
                                  regressing_over_5_pairs=sum(improvement(value) < -5 for value in changes),
                                  median_abs_pair_pct=statistics.median(map(abs, changes)),
                                  p90_abs_pair_pct=max(map(abs, changes)),
                                  paired_changes_pct=json.dumps(changes)))
    write_csv('summary.csv', summaries)
    write_csv('registration.csv', registration)
    (OUT / 'measurement-provenance.jsonl').write_text(''.join(json.dumps(row) + '\n' for row in provenance))
    print(json.dumps(dict(runs=len(provenance), metrics=len(summaries), registrationRows=len(registration))))


if __name__ == '__main__':
    main()
