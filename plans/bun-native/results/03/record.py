"""Task 03 command provenance and Linux quiet-window recorder.

Usage: python3 record.py BUN LABEL [--perf] [--cwd DIR] -- COMMAND [ARGS...]
Every command is serial. This script observes, never controls, external processes.
Raw output is gzip-compressed without changing bytes; metadata is JSON Lines.
"""
import argparse
import datetime
import gzip
import hashlib
import json
import os
from pathlib import Path
import re
import shutil
import subprocess
import time

ROOT = Path(__file__).resolve().parents[4]
OUT = Path(__file__).resolve().parent
DOCS = [
    "README.md", "CONTRIBUTING.md", "bench/README.md", "docs/README.md", "docs/zh/README.md",
    "docs/index.md", "docs/zh/index.md", "docs/01-getting-started.md", "docs/zh/01-getting-started.md",
]
TICKS = os.sysconf("SC_CLK_TCK")


def now():
    return datetime.datetime.now(datetime.timezone.utc).isoformat()


def digest(data):
    return hashlib.sha256(data).hexdigest()


def git(*args):
    return subprocess.check_output(["git", *args], cwd=ROOT).decode().strip()


def snapshot():
    paths = sorted(p for p in ROOT.glob("packages/*/src/**") if p.is_file())
    return {
        "head": git("rev-parse", "HEAD"),
        "branch": git("branch", "--show-current"),
        "worktreeStatus": git("status", "--porcelain=v1", "--untracked-files=normal"),
        "docsSha256": {p: digest((ROOT / p).read_bytes()) for p in DOCS},
        "productionSha256": {str(p.relative_to(ROOT)): digest(p.read_bytes()) for p in paths},
        "benchmarkSha256": {str(p.relative_to(ROOT)): digest(p.read_bytes()) for p in sorted((ROOT / "bench").glob("*.ts"))},
        "lockSha256": digest((ROOT / "bun.lock").read_bytes()),
        "baselineSha256": digest((ROOT / "bench/baseline.json").read_bytes()),
        "productionDiffFrom1418a2f": git("diff", "1418a2f", "--", "packages/*/src/**"),
    }


def processes():
    result = {}
    for file in Path("/proc").glob("[0-9]*/stat"):
        try:
            raw = file.read_text()
            end = raw.rfind(")")
            fields = raw[end + 2:].split()
            name = raw[raw.index("(") + 1:end]
            workload = name in ("cargo", "rustc", "ninja", "tsgo", "biome")
            if name in ("bun", "node", "go", "cargo", "rustc", "ninja", "tsgo", "biome"):
                argv = (file.parent / "cmdline").read_bytes().replace(b"\0", b" ").decode(errors="replace")
                workload |= bool(re.search(r"(^|[/\s._-])(bench(mark)?|build|test|perf)([/\s._-]|$)", argv))
            result[int(file.parent.name)] = {
                "name": name, "group": int(fields[2]), "start": int(fields[19]),
                "ticks": int(fields[11]) + int(fields[12]), "workload": workload,
            }
        except (OSError, ValueError, IndexError):
            continue
    return result


def observe(previous, elapsed, group=None):
    current = processes()
    busy = []
    for pid, item in current.items():
        if pid == os.getpid() or (group is not None and item["group"] == group):
            continue
        old = previous.get(pid)
        ticks = old["ticks"] if old and old["start"] == item["start"] else 0
        cpu = max(0, item["ticks"] - ticks) / TICKS / max(elapsed, 0.001) * 100
        if cpu >= 15 or item["workload"]:
            busy.append({"pid": pid, "name": item["name"], "cpuPercent": round(cpu, 2), "workload": item["workload"]})
    return current, {"at": now(), "loadavg": os.getloadavg(), "busy": busy}


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("bun")
    parser.add_argument("label")
    parser.add_argument("--perf", action="store_true")
    parser.add_argument("--cwd", default=str(ROOT))
    import sys
    split = sys.argv.index("--")
    args = parser.parse_args(sys.argv[1:split])
    command = sys.argv[split + 1:]
    assert command and re.fullmatch(r"[a-z0-9-]+", args.label)
    executable = str(Path(args.bun).resolve())
    env = dict(os.environ, PATH=str(Path(executable).parent) + os.pathsep + os.environ["PATH"])
    # Prevent inherited tuning variables from silently changing the requested gates.
    tuning = ("BENCH_DURATION_MS", "BENCH_CONCURRENCY", "NATIVE_BODY_ROUNDS", "NATIVE_BODY_SCALE", "COVERAGE_THRESHOLD")
    assert not any(key in env for key in tuning), "unexpected inherited benchmark/coverage settings"
    meta = {
        "label": args.label, "requestedAtUtc": now(), "cwd": args.cwd,
        "argv": command, "pathPrefix": str(Path(executable).parent),
        "resolvedBun": shutil.which("bun", path=env["PATH"]),
        "bun": subprocess.check_output(["bun", "--version"], env=env).decode().strip(),
        "revision": subprocess.check_output(["bun", "--revision"], env=env).decode().strip(),
        "platform": os.uname()._asdict() if hasattr(os.uname(), "_asdict") else list(os.uname()),
        "cpu": next(line.split(":", 1)[1].strip() for line in Path("/proc/cpuinfo").read_text().splitlines() if line.startswith("model name")),
        "logicalCpus": os.cpu_count(), "recorderSha256": digest(Path(__file__).read_bytes()),
        "stateBefore": snapshot(), "performance": args.perf,
    }
    metadata = OUT / f"{args.label}.run.jsonl"
    assert not metadata.exists(), "never overwrite evidence"
    metadata.write_text(json.dumps({"requested": meta}) + "\n")
    with (OUT / f"{args.label}.load.jsonl").open("x") as load:
        if args.perf:
            meta["guard"] = {"intervalSeconds": 2, "consecutiveQuietSamples": 15, "otherCpuPercent": 15,
                             "rule": "Wait for 15 quiet samples; exclude whole run on any busy measuring sample regardless of results. Exclude own process group, including Bun children."}
            previous, start, quiet = processes(), time.monotonic(), 0
            last_notice = start
            while quiet < 15:
                time.sleep(2)
                end = time.monotonic()
                previous, sample = observe(previous, end - start)
                start = end
                sample["phase"] = "waiting"
                load.write(json.dumps(sample) + "\n")
                load.flush()
                quiet = 0 if sample["busy"] else quiet + 1
                if end - last_notice >= 20:
                    print("WAIT", args.label, "quiet", quiet, "busy", sample["busy"], flush=True)
                    last_notice = end
        meta["startedAtUtc"] = now()
        print("START", args.label, meta["bun"], flush=True)
        paths = [OUT / f"{args.label}.{stream}.txt" for stream in ("stdout", "stderr")]
        with paths[0].open("xb") as stdout, paths[1].open("xb") as stderr:
            child = subprocess.Popen(command, cwd=args.cwd, env=env, stdout=stdout, stderr=stderr, start_new_session=True)
            previous, start, interruptions = processes(), time.monotonic(), []
            if args.perf:
                while child.poll() is None:
                    try:
                        child.wait(timeout=2)
                    except subprocess.TimeoutExpired:
                        pass
                    end = time.monotonic()
                    previous, sample = observe(previous, end - start, child.pid)
                    start = end
                    sample["phase"] = "measuring"
                    load.write(json.dumps(sample) + "\n")
                    load.flush()
                    if sample["busy"]:
                        interruptions.append(sample)
            meta["exitCode"] = child.wait()
        meta["finishedAtUtc"] = now()
        meta["otherBusySamples"] = interruptions
        meta["performanceEligible"] = args.perf and not interruptions and meta["exitCode"] in (0, 1)
        meta["stateAfter"] = snapshot()
        meta["logs"] = []
        for path in paths:
            raw = path.read_bytes()
            compressed = gzip.compress(raw, mtime=0)
            target = path.with_suffix(path.suffix + ".gz")
            target.write_bytes(compressed)
            path.unlink()
            meta["logs"].append({"path": target.name, "sha256": digest(compressed), "rawSha256": digest(raw), "rawBytes": len(raw)})
        if command == ["bun", "test", "--coverage", "--coverage-reporter=lcov", "packages/core"] and meta["exitCode"] == 0:
            raw = (ROOT / "coverage/lcov.info").read_bytes()
            target = OUT / f"{args.label}.lcov.info.gz"
            target.write_bytes(gzip.compress(raw, mtime=0))
            meta["coverage"] = {"path": target.name, "rawSha256": digest(raw)}
    with metadata.open("a") as file:
        file.write(json.dumps({"completed": meta}) + "\n")
    print("END", args.label, "exit", meta["exitCode"], "busy samples", len(interruptions), flush=True)
    return meta["exitCode"] or (2 if interruptions else 0)


if __name__ == "__main__":
    raise SystemExit(main())
