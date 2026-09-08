"""One complete alternating A/B comparison; run twice. All children inherit PATH."""
import argparse
import json
import os
from pathlib import Path
import shutil
import signal
import subprocess


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--harness', required=True)
    parser.add_argument('--before', required=True)
    parser.add_argument('--after', required=True)
    parser.add_argument('--suite', choices=['router', 'request', 'di', 'dispatch', 'http', 'all'], required=True)
    parser.add_argument('--pairs', type=int, default=5)
    args = parser.parse_args()
    if args.pairs < 5:
        parser.error('at least five paired rounds are required')
    for value in (args.harness, args.before, args.after):
        if not Path(value).is_absolute() or not Path(value).exists():
            parser.error('harness and source roots must be existing absolute paths')
    bun = shutil.which('bun')
    if not bun:
        parser.error('bun not in PATH')
    child = None

    def interrupt(signum, frame):
        raise KeyboardInterrupt(f'signal {signum}')

    signal.signal(signal.SIGTERM, interrupt)
    try:
        for pair in range(1, args.pairs + 1):
            for order, side in enumerate(['A', 'B'] if pair % 2 else ['B', 'A'], 1):
                source = args.before if side == 'A' else args.after
                command = [bun, args.harness, '--source-root', source, '--suite', args.suite,
                           '--rounds', '1', '--iterations', '100000', '--warmup', '20000',
                           '--duration-ms', '1000', '--warmup-ms', '500', '--concurrency', '32']
                print(json.dumps({'type': 'invocation', 'pair': pair, 'order': order, 'side': side,
                                  'command': command}), flush=True)
                child = subprocess.Popen(command, stdout=subprocess.PIPE, text=True, env=os.environ.copy())
                for line in child.stdout:
                    record = json.loads(line)
                    record.update(pair=pair, order=order, side=side)
                    print(json.dumps(record), flush=True)
                code = child.wait()
                print(json.dumps({'type': 'exit', 'pair': pair, 'side': side, 'code': code}), flush=True)
                if code:
                    return code
        return 0
    finally:
        if child and child.poll() is None:
            child.terminate()
            try:
                child.wait(timeout=2)
            except subprocess.TimeoutExpired:
                child.kill()
                child.wait()


if __name__ == '__main__':
    raise SystemExit(main())
