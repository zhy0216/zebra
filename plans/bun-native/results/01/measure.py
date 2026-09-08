"""Linux load guard and recorder; run from any cwd with BUN_EXECUTABLE LABEL [QUIET_SAMPLES].

This wraps the documented benchmark command without changing its parameters.
It only observes other processes and never controls another workspace.
"""
import datetime
import json
import hashlib
import os
from pathlib import Path
import re
import subprocess
import sys
import time

ROOT = Path(__file__).resolve().parents[4]
RESULTS = Path(__file__).resolve().parent
BASELINE = "1418a2f3f8b3e0bae53490eb195811b34590e041"
TICKS = os.sysconf("SC_CLK_TCK")


def now():
    return datetime.datetime.now(datetime.timezone.utc).isoformat()


def processes():
    result = {}
    for file in Path("/proc").glob("[0-9]*/stat"):
        try:
            text = file.read_text()
            end = text.rfind(")")
            fields = text[end + 2:].split()
            name = text[text.index("(") + 1:end]
            workload = False
            if name in ("bun", "node", "go", "cargo", "rustc", "ninja", "tsgo", "biome"):
                try:
                    argv = (file.parent / "cmdline").read_bytes().replace(b"\0", b" ").decode(errors="replace")
                    workload = bool(re.search(r"(^|[/\s._-])(bench(mark)?|build|test|perf)([/\s._-]|$)", argv))
                except OSError:
                    pass
            result[int(file.parent.name)] = {
                "workload": workload,
                "name": text[text.index("(") + 1:end],
                "ticks": int(fields[11]) + int(fields[12]),
            }
        except (OSError, ValueError, IndexError):
            continue
    return result


def observe(previous, elapsed, exclude):
    current = processes()
    busy = []
    for pid, item in current.items():
        if pid in exclude:
            continue
        earlier = previous.get(pid, {"ticks": 0})
        cpu = max(0, item["ticks"] - earlier["ticks"]) / TICKS / elapsed * 100
        if cpu >= 15 or item["workload"] or item["name"] in ("cargo", "rustc", "ninja", "tsgo", "biome"):
            busy.append({"pid": pid, "name": item["name"], "cpuPercent": round(cpu, 2), "workload": item["workload"]})
    return current, {"at": now(), "loadavg": os.getloadavg(), "busy": busy}


def main():
    executable = str(Path(sys.argv[1]).resolve())
    label = sys.argv[2]
    quiet_samples = int(sys.argv[3]) if len(sys.argv) > 3 else 3
    if quiet_samples < 3:
        raise ValueError("at least 3 quiet samples are required")
    if not re.fullmatch(r"[a-z0-9-]+", label):
        raise ValueError("label must contain only lowercase letters, digits or hyphens")
    argv = [executable, "run", "bench/native-json.ts", "--baseline", BASELINE,
            "--rounds", "7", "--iterations", "10000", "--warmup", "2000"]
    env = dict(os.environ, PATH=str(Path(executable).parent) + os.pathsep + os.environ["PATH"])
    run = {"label": label, "requestedAt": now(), "cwd": str(ROOT), "argv": argv,
           "pathPrefix": str(Path(executable).parent), "sampleSeconds": 2,
           "driverSha256": hashlib.sha256(Path(__file__).read_bytes()).hexdigest(),
           "quietSamples": quiet_samples,
           "guard": "consecutive quiet samples; other processes >=15% CPU or active benchmark/build/test commands block start"}
    with (RESULTS / f"{label}.load.jsonl").open("x") as load:
        previous = processes()
        started = time.monotonic()
        quiet = 0
        while quiet < quiet_samples:
            time.sleep(2)
            ended = time.monotonic()
            previous, sample = observe(previous, ended - started, {os.getpid()})
            started = ended
            sample["phase"] = "waiting"
            load.write(json.dumps(sample) + "\n")
            load.flush()
            quiet = 0 if sample["busy"] else quiet + 1
            if sample["busy"]:
                print("WAIT", label, sample["busy"], flush=True)
        run["startedAt"] = now()
        print("START", label, run["startedAt"], flush=True)
        with (RESULTS / f"{label}.jsonl").open("x") as stdout, (RESULTS / f"{label}.stderr.txt").open("x") as stderr:
            child = subprocess.Popen(argv, cwd=ROOT, env=env, stdout=stdout, stderr=stderr)
            previous = processes()
            started = time.monotonic()
            interruptions = []
            while child.poll() is None:
                time.sleep(2)
                ended = time.monotonic()
                previous, sample = observe(previous, ended - started, {os.getpid(), child.pid})
                started = ended
                sample["phase"] = "measuring"
                load.write(json.dumps(sample) + "\n")
                load.flush()
                if sample["busy"]:
                    interruptions.append(sample)
            run["exitCode"] = child.wait()
        run["endedAt"] = now()
        run["otherBusySamples"] = interruptions
    (RESULTS / f"{label}.run.json").write_text(json.dumps(run, indent=2) + "\n")
    print("END", label, "exit", run["exitCode"], "other busy samples", len(interruptions), flush=True)
    return run["exitCode"] or (2 if interruptions else 0)


if __name__ == "__main__":
    sys.exit(main())
