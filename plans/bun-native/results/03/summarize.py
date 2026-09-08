"""Audit task 03 raw outputs and derive an index and every benchmark median.

Run from the repository root after recording commands. No measurements are rerun.
"""
import csv
import gzip
import hashlib
import json
from pathlib import Path
import re
import statistics

OUT = Path(__file__).resolve().parent


def rows(path):
    return [json.loads(line) for line in path.read_text().splitlines() if line]


def main():
    commands, medians = [], []
    for path in sorted(OUT.glob("*.run.jsonl")):
        records = rows(path)
        if "completed" not in records[-1]:
            print("WAIT-ONLY OR INCOMPLETE", path.name)
            continue
        run = records[-1]["completed"]
        label = run["label"]
        logs = []
        for item in run["logs"]:
            data = (OUT / item["path"]).read_bytes()
            assert hashlib.sha256(data).hexdigest() == item["sha256"], item["path"]
            raw = gzip.decompress(data)
            assert hashlib.sha256(raw).hexdigest() == item["rawSha256"], item["path"]
            logs.append(raw.decode())
        assert run["stateBefore"]["productionSha256"] == run["stateAfter"]["productionSha256"]
        assert not run["stateBefore"]["productionDiffFrom1418a2f"]
        assert not run["stateAfter"]["productionDiffFrom1418a2f"]
        commands.append({
            "label": label, "bun": run["bun"], "head": run["stateBefore"]["head"],
            "command": json.dumps(run["argv"]), "cwd": run["cwd"], "exitCode": run["exitCode"],
            "performance": run["performance"], "otherBusySamples": len(run["otherBusySamples"]),
            "startedAtUtc": run["startedAtUtc"], "finishedAtUtc": run["finishedAtUtc"],
            "metadata": path.name, "stdout": run["logs"][0]["path"], "stderr": run["logs"][1]["path"],
        })
        if not run["performance"]:
            continue
        samples = [json.loads(line) for line in logs[0].splitlines() if line.startswith("{")]
        eligible = run["performanceEligible"]

        def save(phase, scenario, before, after, rounds, unit="ns/op"):
            medians.append({"run": label, "bun": run["bun"], "eligible": eligible,
                            "phase": phase, "scenario": scenario, "rounds": rounds, "unit": unit,
                            "before": before, "after": after,
                            "changePercent": (after / before - 1) * 100 if before is not None else None})

        if "native-json" in label:
            summaries = [item for item in samples if "summary" in item]
            assert len(summaries) == 23 and sum("round" in item for item in samples) == 161
            historical = rows(OUT.parent / "01/bun142-run4.jsonl")[0]
            assert samples[0]["beforeSources"] == historical["beforeSources"]
            assert samples[0]["afterSources"] == historical["afterSources"]
            assert not samples[0]["coreDiff"]
            for summary in summaries:
                group = [item for item in samples if item.get("scenario") == summary["summary"] and "round" in item]
                assert len(group) == 7
                for item in group:
                    assert item["before"]["checksum"] == item["after"]["checksum"]
                for side in ("before", "after"):
                    assert statistics.median(item[side]["nsPerOp"] for item in group) == summary[f"{side}MedianNs"]
                save("json", summary["summary"], summary["beforeMedianNs"], summary["afterMedianNs"], 7)
        elif "native-body" in label:
            summaries = [item for item in samples if item.get("type") == "summary"]
            assert len(summaries) == 22 and sum(item.get("type") == "sample" for item in samples) == 396
            assert samples[-1] == {"type": "consumption", "checksum": 15796464236}
            for summary in summaries:
                group = [item for item in samples if item.get("type") == "sample" and item["phase"] == summary["phase"] and item["name"] == summary["name"]]
                assert len(group) == 18
                for side in ("legacy", "native"):
                    values = [item["nsPerOp"] for item in group if item["implementation"] == side]
                    assert values == summary["samples"][side]
                    assert statistics.median(values) == summary["median"][side]
                for round_number in range(1, 10):
                    pair = [item for item in group if item["round"] == round_number]
                    assert len(pair) == 2 and pair[0]["checksum"] == pair[1]["checksum"]
                save(summary["phase"], summary["name"], summary["median"]["legacy"], summary["median"]["native"], 9)
        elif "session-sign" in label:
            found = re.findall(r"^(sign|verify valid cookie): node:crypto ([\d.]+) \| Bun.CryptoHasher ([\d.]+)", logs[0], re.M)
            assert len(found) == 2 and "checksum: 167040000" in logs[0]
            for name, before, after in found:
                save("session", name, float(before), float(after), 7)
        elif "bench-check" in label:
            found = re.findall(r"^([a-z-]+)\s+(\d+) req/s .*?p95 ([\d.]+)ms .*?(OK|FAIL)$", logs[0], re.M)
            assert len(found) == 8, (label, found)
            for name, rps, p95, status in found:
                save("HTTP gate " + status, name, None, float(rps), 3, "req/s (printed)")
                save("HTTP gate " + status, name, None, float(p95), 3, "p95 ms (printed)")
        elif "http-samples" in label:
            measured = [item for item in samples if item["type"] == "sample"]
            summaries = [item for item in samples if item["type"] == "median"]
            assert len(measured) == 24 and len(summaries) == 8
            for summary in summaries:
                group = sorted([item for item in measured if item["scenario"] == summary["scenario"]], key=lambda item: item["rps"])
                for metric in ("rps", "p50", "p95", "p99", "requests"):
                    assert summary[metric] == group[1][metric]
                save("HTTP", summary["scenario"], None, summary["rps"], 3, "req/s")
                save("HTTP", summary["scenario"], None, summary["p95"], 3, "p95 ms")
    for name, data in [("commands.csv", commands), ("medians.csv", medians)]:
        if data:
            with (OUT / name).open("w", newline="") as file:
                writer = csv.DictWriter(file, fieldnames=list(data[0]), lineterminator="\n")
                writer.writeheader()
                writer.writerows(data)
    print(f"Audited {len(commands)} command records; wrote {len(medians)} median rows, retaining excluded runs.")


if __name__ == "__main__":
    main()
