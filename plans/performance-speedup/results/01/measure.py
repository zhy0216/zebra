"""Linux quiet-window recorder. Invoke once INSIDE run-load.py measure; never nests locks."""
import argparse
import datetime
import json
import os
from pathlib import Path
import re
import signal
import subprocess
import time


def stamp():
    return datetime.datetime.now(datetime.timezone.utc).isoformat()


def snapshot():
    processes = {}
    for path in Path('/proc').glob('[0-9]*/stat'):
        try:
            raw = path.read_text()
            end = raw.rfind(')')
            fields = raw[end + 2:].split()
            command = (path.parent / 'cmdline').read_bytes().replace(b'\0', b' ').decode(errors='replace')
            processes[int(path.parent.name)] = {
                'name': raw[raw.index('(') + 1:end], 'ppid': int(fields[1]),
                'group': int(fields[2]), 'ticks': int(fields[11]) + int(fields[12]),
                'start': fields[19],
                'workload': bool(re.search(r'(^|/)(tsgo|biome)( |$)|\bbun (test|build|install|run (bench|typecheck|lint|test|build))\b', command)),
            }
        except (FileNotFoundError, ProcessLookupError, PermissionError):
            pass
    cpu = [int(n) for n in Path('/proc/stat').read_text().splitlines()[0].split()[1:9]]
    return time.monotonic(), processes, cpu


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--output', required=True)
    parser.add_argument('command', nargs=argparse.REMAINDER)
    args = parser.parse_args()
    if not args.command:
        parser.error('a command is required')
    out = Path(args.output).resolve()
    out.mkdir(parents=True, exist_ok=False)
    summary = {'command': args.command, 'cwd': os.getcwd(), 'started': stamp(),
               'rule': {'sampleSeconds': 2, 'quietSamples': 15, 'maxQuietSeconds': 300,
                        'outsideCpuPercentOfOneCore': 15,
                        'exclusion': 'Any measured outside CPU >=15% or detected competing workload excludes the entire comparison; retain all rows.'},
               'status': 'waiting', 'interferenceSamples': 0}
    (out / 'status.json').write_text(json.dumps(summary, indent=2) + '\n')
    previous = snapshot()
    ancestors = {os.getpid()}
    pid = os.getpid()
    while pid in previous[1] and previous[1][pid]['ppid'] > 0:
        pid = previous[1][pid]['ppid']
        ancestors.add(pid)
    hz = os.sysconf('SC_CLK_TCK')
    child = None

    def sample(phase, log):
        nonlocal previous
        current = snapshot()
        seconds = current[0] - previous[0]
        outside = []
        for pid, info in current[1].items():
            if pid in ancestors or (child and info['group'] == child.pid):
                continue
            old = previous[1].get(pid)
            ticks = info['ticks'] - old['ticks'] if old and old['start'] == info['start'] else info['ticks']
            percent = 100 * ticks / hz / seconds
            if percent >= 15 or info['workload']:
                outside.append({'pid': pid, 'name': info['name'], 'cpuPercentOneCore': round(percent, 2), 'workload': info['workload']})
        deltas = [a - b for a, b in zip(current[2], previous[2])]
        total = max(1, sum(deltas))
        row = {'at': stamp(), 'phase': phase, 'seconds': seconds, 'outside': outside,
               'hostBusyPercent': round(100 * (total - deltas[3] - deltas[4]) / total, 2),
               'hostStealPercent': round(100 * deltas[7] / total, 2), 'loadavg': os.getloadavg()}
        log.write(json.dumps(row) + '\n')
        log.flush()
        previous = current
        return outside

    def interrupt(signum, frame):
        raise KeyboardInterrupt(f'signal {signum}')

    signal.signal(signal.SIGTERM, interrupt)
    try:
        with (out / 'load.jsonl').open('w') as log:
            quiet = 0
            deadline = time.monotonic() + 300
            while quiet < 15 and time.monotonic() < deadline:
                time.sleep(2)
                quiet = 0 if sample('quiet', log) else quiet + 1
            summary['quietSamples'] = quiet
            if quiet < 15:
                summary['status'] = 'quiet-timeout'
                return 2
            summary['measurementStarted'] = stamp()
            print(f'{stamp()} quiet window established: {out}', flush=True)
            with (out / 'stdout.log').open('w') as stdout, (out / 'stderr.log').open('w') as stderr:
                child = subprocess.Popen(args.command, stdout=stdout, stderr=stderr, start_new_session=True)
                while child.poll() is None:
                    time.sleep(2)
                    if sample('measure', log):
                        summary['interferenceSamples'] += 1
                summary['exit'] = child.wait()
            summary['status'] = ('failed' if summary['exit'] else 'complete')
            summary['eligible'] = summary['exit'] == 0 and summary['interferenceSamples'] == 0
            return summary['exit']
    except BaseException as error:
        summary['status'] = 'interrupted'
        summary['error'] = repr(error)
        raise
    finally:
        if child and child.poll() is None:
            os.killpg(child.pid, signal.SIGTERM)
            try:
                child.wait(timeout=2)
            except subprocess.TimeoutExpired:
                os.killpg(child.pid, signal.SIGKILL)
                child.wait()
        summary['finished'] = stamp()
        (out / 'status.json').write_text(json.dumps(summary, indent=2) + '\n')
        print(json.dumps(summary), flush=True)


if __name__ == '__main__':
    raise SystemExit(main())
