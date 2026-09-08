"""Freeze control decisions and envelopes AFTER each allocation releases its lock."""
import csv
import datetime
import gzip
import json
from pathlib import Path
import statistics


root = Path(__file__).resolve().parent
envelopes = []
decisions = []


def read(path):
    return path.read_text() if path.exists() else gzip.decompress(path.with_name(path.name + ".gz").read_bytes()).decode()


for suite in ("dispatch", "http"):
    for attempt in (1, 2):
        directory = root / f"aa-140-{suite}-{attempt}"
        if not (directory / "status.json").exists() and not (directory / "status.json.gz").exists():
            continue
        status = json.loads(read(directory / "status.json"))
        if status["status"] == "waiting":
            continue
        decision = {"run": directory.name, "exit": status.get("exit", 2), "eligible": status.get("eligible", False), "status": status["status"], "saved": datetime.datetime.now(datetime.timezone.utc).isoformat()}
        decisions.append(decision)
        if not decision["eligible"]:
            continue
        records = [json.loads(line) for line in read(directory / "stdout.log").splitlines()]
        environments = [r for r in records if r["type"] == "environment"]
        assert len(environments) == len({r["pid"] for r in environments}) == 10
        assert len([r for r in records if r["type"] == "complete" and r["ok"]]) == 10
        assert len([r for r in records if r["type"] == "exit" and r["code"] == 0]) == 10
        assert {r["source"]["productionSha256"] for r in environments} == {"7a9eb1077326654812aabcad8519086ce61b28350a6160582ec01cbce90c9b73"}
        assert {r["harness"]["sha256"] for r in environments} == {"b4a3feb23f5d26c8b6121d35e1b121b2b5ab6221b45a62ae4ddf42dd8a31a976"}
        assert {r["runtime"]["bun"] for r in environments} == {"1.4.0"}
        assert len({r["source"]["lockSha256"] for r in environments} | {r["harness"]["lockSha256"] for r in environments}) == 1
        assert all(not r["source"]["productionDiff"]["changes"] and not r["harness"]["diff"] for r in environments)
        for pair in range(1, 6):
            assert [r["side"] for r in environments if r["pair"] == pair] == (["A", "B"] if pair % 2 else ["B", "A"])
        rows = {}
        for record in records:
            if record["type"] != "round":
                continue
            for metric in (["rps", "p50", "p95", "p99"] if suite == "http" else ["nsPerOp"]):
                rows.setdefault((record["name"], metric), {})[record["side"], record["pair"]] = record[metric]
        for (name, metric), values in rows.items():
            assert len(values) == 10
            changes = [100 * (values["B", i] / values["A", i] - 1) for i in range(1, 6)]
            envelope = max(5, max(map(abs, changes)))
            envelopes.append({"run": directory.name, "bun": "1.4.0", "suite": suite, "fixture": name, "metric": metric, "samples": 5, "median_abs_pair_pct": statistics.median(map(abs, changes)), "p90_abs_pair_pct": max(map(abs, changes)), "envelope_pct": envelope, "noisy": envelope > 20})
        break
old = list(csv.DictReader((root / "minimum-envelopes.csv").open())) if (root / "minimum-envelopes.csv").exists() else []
for row in old:
    match = next(r for r in envelopes if all(str(r[k]) == row[k] for k in ("run", "suite", "fixture", "metric")))
    assert str(match["envelope_pct"]) == row["envelope_pct"], "An eligible envelope cannot be replaced"
with (root / "minimum-control-decisions.jsonl").open("w") as file:
    for row in decisions:
        file.write(json.dumps(row) + "\n")
with (root / "minimum-envelopes.csv").open("w") as file:
    fields = ["run", "bun", "suite", "fixture", "metric", "samples", "median_abs_pair_pct", "p90_abs_pair_pct", "envelope_pct", "noisy"]
    writer = csv.DictWriter(file, fieldnames=fields, lineterminator="\n")
    writer.writeheader()
    writer.writerows(envelopes)
print(json.dumps({"minimum_envelopes": len(envelopes), "suites": sorted({r["suite"] for r in envelopes})}), flush=True)
