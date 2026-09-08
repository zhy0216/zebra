"""Report every control/candidate row against the fixed, runtime-specific envelopes."""
import csv
import gzip
import json
import math
from pathlib import Path
import statistics


root = Path(__file__).resolve().parent
proto = root.parent / "01"
median = statistics.median


def read(path):
    return path.read_text() if path.exists() else gzip.decompress(path.with_name(path.name + ".gz").read_bytes()).decode()


envelopes = {}
for path in (proto / "variability.csv", root / "minimum-envelopes.csv"):
    if path.exists():
        for row in csv.DictReader(path.open()):
            key = row["bun"], row["suite"], row["fixture"], row["metric"]
            assert key not in envelopes
            envelopes[key] = float(row["envelope_pct"])
summaries, provenance = [], []
for directory in sorted(root.iterdir()):
    if not directory.is_dir() or not (directory.name.startswith("aa-") or directory.name.startswith("candidate-")):
        continue
    status = json.loads(read(directory / "status.json"))
    if status["status"] == "waiting":
        continue
    records = [json.loads(line) for line in read(directory / "stdout.log").splitlines()] if (directory / "stdout.log").exists() or (directory / "stdout.log.gz").exists() else []
    environments = [r for r in records if r["type"] == "environment"]
    complete = [r for r in records if r["type"] == "complete" and r["ok"]]
    exits = [r for r in records if r["type"] == "exit"]
    eligible = status.get("eligible", False)
    if eligible:
        assert len(environments) == len(complete) == len(exits) == 10
        assert len({r["pid"] for r in environments}) == 10
        assert all(r["code"] == 0 for r in exits)
        assert {r["harness"]["sha256"] for r in environments} == {"b4a3feb23f5d26c8b6121d35e1b121b2b5ab6221b45a62ae4ddf42dd8a31a976"}
        assert len({r["runtime"]["revision"] for r in environments}) == 1
        assert len({r["source"]["lockSha256"] for r in environments} | {r["harness"]["lockSha256"] for r in environments}) == 1
        for side in ("A", "B"):
            assert len({r["source"]["productionSha256"] for r in environments if r["side"] == side}) == 1
        assert {r["source"]["productionSha256"] for r in environments if r["side"] == "A"} == {"7a9eb1077326654812aabcad8519086ce61b28350a6160582ec01cbce90c9b73"}
        for pair in range(1, 6):
            assert [r["side"] for r in environments if r["pair"] == pair] == (["A", "B"] if pair % 2 else ["B", "A"])
    provenance.append({"run": directory.name, "status": status, "processes": len(environments), "completedProcesses": len(complete), "roundRecords": sum(r["type"] == "round" for r in records), "sources": [{"side": r["side"], "source": r["source"], "runtime": r["runtime"], "harness": r["harness"]} for r in environments[:2]]})
    if not environments:
        continue
    runtime = environments[0]["runtime"]["bun"]
    rows = {}
    for record in records:
        if record["type"] != "round":
            continue
        for metric in (["rps", "p50", "p95", "p99"] if record["suite"] == "http" else ["nsPerOp"]):
            key = record["suite"], record["name"], metric
            pair = record["side"], record["pair"]
            assert pair not in rows.setdefault(key, {})
            assert math.isfinite(record[metric]) and record[metric] > 0
            rows[key][pair] = record[metric]
    for (suite, name, metric), values in rows.items():
        pairs = [i for i in range(1, 6) if ("A", i) in values and ("B", i) in values]
        if eligible:
            assert len(pairs) == 5
        if not pairs:
            continue
        before, after = [[values[side, i] for i in pairs] for side in ("A", "B")]
        changes = [100 * (b / a - 1) for a, b in zip(before, after)]
        change = 100 * (median(after) / median(before) - 1)
        direction = 1 if metric == "rps" else -1
        gain = direction * change
        improved = sum(direction * v > 0 for v in changes)
        regressed = sum(direction * v < 0 for v in changes)
        envelope = envelopes.get((runtime, suite, name, metric))
        threshold = max(envelope, 5 if suite == "http" else 10) if envelope is not None else None
        summaries.append({"run": directory.name, "bun": runtime, "eligible": eligible, "suite": suite, "fixture": name, "metric": metric, "pairs": len(pairs), "median_A": median(before), "median_B": median(after), "median_change_pct": change, "median_abs_pair_pct": median(map(abs, changes)), "p90_abs_pair_pct": sorted(map(abs, changes))[math.ceil(len(changes) * .9) - 1], "A_mad_pct": 100 * median(abs(v - median(before)) for v in before) / median(before), "B_mad_pct": 100 * median(abs(v - median(after)) for v in after) / median(after), "paired_changes_pct": json.dumps(changes), "improved_pairs": improved, "regressed_pairs": regressed, "envelope_pct": envelope, "target_pass": eligible and threshold is not None and gain > threshold and improved >= 4, "http_regression_flag": eligible and suite == "http" and metric in ("rps", "p95") and gain < -5 and regressed >= 4})
if summaries:
    with (root / "summary.csv").open("w") as file:
        writer = csv.DictWriter(file, fieldnames=list(summaries[0]), lineterminator="\n")
        writer.writeheader()
        writer.writerows(summaries)
with (root / "measurement-provenance.jsonl").open("w") as file:
    for row in provenance:
        file.write(json.dumps(row) + "\n")
decisions = []
for key in sorted({(r["bun"], r["suite"], r["fixture"], r["metric"]) for r in summaries if r["run"].startswith("candidate-")}):
    rows = [r for r in summaries if r["run"].startswith("candidate-") and (r["bun"], r["suite"], r["fixture"], r["metric"]) == key]
    decisions.append({"bun": key[0], "suite": key[1], "fixture": key[2], "metric": key[3], "complete_confirmations": len(rows), "eligible_confirmations": sum(r["eligible"] for r in rows), "confirmed_gain": len(rows) == 2 and all(r["target_pass"] for r in rows), "confirmed_http_regression": len(rows) == 2 and all(r["http_regression_flag"] for r in rows)})
with (root / "metric-decisions.jsonl").open("w") as file:
    for row in decisions:
        file.write(json.dumps(row) + "\n")
print(json.dumps({"runs": len(provenance), "rows": len(summaries), "confirmed_gains": [r for r in decisions if r["confirmed_gain"]], "confirmed_http_regressions": [r for r in decisions if r["confirmed_http_regression"]]}))
