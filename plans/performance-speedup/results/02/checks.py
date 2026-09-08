"""Run inside run-load.py check; retain complete command output and exit status."""
import argparse
import datetime
import gzip
import hashlib
import json
import os
from pathlib import Path
import re
import subprocess

OUT = Path(__file__).resolve().parent
ROOT = OUT.parents[3]
HARNESS = '/home/ubuntu/workspace/zebra/bench/hot-path.ts'
BASELINE = '/tmp/zebra-performance-speedup-01/baseline-a856cab'


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('label')
    parser.add_argument('mode', choices=['install', 'focused', 'full', 'final'])
    args = parser.parse_args()
    focused = ['bun', 'test', 'packages/core/test/router',
               'packages/core/test/fuzz/router.test.ts', 'packages/core/test/app/method.test.ts',
               'packages/core/test/app/ws.test.ts', 'packages/core/test/ws.test.ts']
    if args.mode == 'install':
        commands = [['bun', 'install', '--frozen-lockfile']]
    elif args.mode == 'focused':
        commands = [focused, ['python3', str(OUT / 'baseline-tests.py'), args.label],
                    ['bun', 'test', 'bench/test'],
                    ['bun', HARNESS, '--source-root', BASELINE, '--suite', 'all', '--check'],
                    ['bun', HARNESS, '--source-root', str(ROOT), '--suite', 'all', '--check'],
                    ['bun', 'run', 'typecheck'], ['bun', 'run', 'lint']]
    elif args.mode == 'full':
        commands = [['bun', 'install', '--frozen-lockfile'],
                    ['bun', 'run', 'typecheck'], ['bun', 'run', 'lint'],
                    ['bun', 'run', 'build'], ['bun', 'run', 'test'],
                    ['bun', 'run', 'verify:packages'],
                    ['bun', 'test', '--coverage', '--coverage-reporter=lcov', 'packages/core'],
                    ['bun', 'run', 'check:coverage'], ['bun', 'run', 'docs:build'],
                    ['bun', 'build', '--target', 'browser', 'packages/client/src/index.ts',
                     '--outfile', str(OUT / f'client-{args.label}.js')],
                    ['bun', 'build', '--target', 'browser', 'packages/contract/src/index.ts',
                     '--outfile', str(OUT / f'contract-{args.label}.js')]]
    else:
        commands = [focused,
                    ['bun', HARNESS, '--source-root', str(ROOT), '--suite', 'all', '--check'],
                    ['bun', 'run', 'typecheck'], ['bun', 'run', 'lint'],
                    ['git', 'diff', '--check']]
    failures = 0
    for index, command in enumerate(commands, 1):
        name = f'{args.label}-{index:02d}.log.gz'
        started = datetime.datetime.now(datetime.timezone.utc).isoformat()
        result = subprocess.run(command, cwd=ROOT, stdout=subprocess.PIPE,
                                stderr=subprocess.STDOUT, env={**os.environ, 'DOCS_BASE': '/zebra/'})
        with gzip.open(OUT / name, 'wb') as log:
            log.write(result.stdout)
        record = dict(label=args.label, command=command, cwd=str(ROOT), started=started,
                      finished=datetime.datetime.now(datetime.timezone.utc).isoformat(),
                      path=os.environ['PATH'], exit=result.returncode, log=name)
        with (OUT / 'checks.jsonl').open('a') as manifest:
            manifest.write(json.dumps(record) + '\n')
        print(json.dumps(record), flush=True)
        failures += result.returncode != 0
    if args.mode == 'full':
        for package in ['client', 'contract']:
            bundle = OUT / f'{package}-{args.label}.js'
            if not bundle.exists():
                failures += 1
                continue
            data = bundle.read_bytes()
            references = re.findall(rb'\bBun\s*[.\[]|[\"\']bun:', data)
            with gzip.open(str(bundle) + '.gz', 'wb') as output:
                output.write(data)
            bundle.unlink()
            record = dict(label=args.label, browserPackage=package,
                          runtimeReferences=len(references), bytes=len(data))
            with (OUT / 'checks.jsonl').open('a') as manifest:
                manifest.write(json.dumps(record) + '\n')
            print(json.dumps(record), flush=True)
            failures += bool(references)
    if args.mode == 'final':
        tracked = subprocess.check_output(['git', 'ls-files', 'packages'], cwd=ROOT).decode().splitlines()
        production = [name for name in tracked if '/src/' in name]
        diff = subprocess.check_output(['git', 'diff', 'a856cab47d4fd3102e976ce7a70166837837eea2',
                                        '--', *production], cwd=ROOT)
        record = dict(label=args.label, productionFiles=len(production),
                      productionMatchesBaseline=not diff,
                      routerSha256=hashlib.sha256((ROOT / 'packages/core/src/router/radix.ts').read_bytes()).hexdigest())
        with (OUT / 'checks.jsonl').open('a') as manifest:
            manifest.write(json.dumps(record) + '\n')
        print(json.dumps(record), flush=True)
        failures += bool(diff)
    return int(failures > 0)


if __name__ == '__main__':
    raise SystemExit(main())
