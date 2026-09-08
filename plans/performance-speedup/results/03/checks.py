"""Run sequential checks under one external run-load.py check allocation."""
import argparse
import gzip
import json
import os
from pathlib import Path
import subprocess
import time


ROOT = Path(__file__).resolve().parents[4]
OUT = Path(__file__).resolve().parent
HARNESS = '/home/ubuntu/workspace/zebra/bench/hot-path.ts'
BASELINE = '/tmp/zebra-performance-speedup-01/baseline-a856cab'
FOCUSED = [
    'bun', 'test', 'packages/core/test/http/request.test.ts',
    'packages/core/test/http/request-helpers.test.ts',
    'packages/core/test/http/request-metadata.test.ts',
    'packages/core/test/http/content-length.test.ts',
    'packages/core/test/contract', 'packages/core/test/app/timeout.test.ts',
]


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('label')
    parser.add_argument('--full', action='store_true')
    parser.add_argument('--install', action='store_true')
    args = parser.parse_args()
    for directory in OUT.glob('aa-*'):
        status = directory / 'status.json'
        if status.exists():
            assert json.loads(status.read_text())['status'] != 'waiting'
            for name in ['stdout.log', 'stderr.log', 'load.jsonl', 'status.json']:
                path = directory / name
                if path.is_file():
                    path.with_name(name + '.gz').write_bytes(gzip.compress(path.read_bytes(), mtime=0))
                    path.unlink()
    commands = [['bun', '--version']]
    if args.install:
        commands.append(['bun', 'install', '--frozen-lockfile'])
    commands.extend([
        FOCUSED,
        ['bun', HARNESS, '--source-root', BASELINE, '--suite', 'all', '--check'],
        ['bun', HARNESS, '--source-root', str(ROOT), '--suite', 'all', '--check'],
        ['bun', 'run', 'typecheck'], ['bun', 'run', 'lint'],
    ])
    if args.full:
        commands.extend([
            ['bun', 'run', 'build'], ['bun', 'run', 'test'],
            ['bun', 'run', 'verify:packages'],
            ['bun', 'test', '--coverage', '--coverage-reporter=lcov', 'packages/core'],
            ['bun', 'run', 'check:coverage'],
            ['env', 'DOCS_BASE=/zebra/', 'bun', 'run', 'docs:build'],
            ['bun', 'build', '--target', 'browser', 'packages/client/src/index.ts',
             '--outfile', '/tmp/zebra-metadata-client-browser.js'],
            ['bun', 'build', '--target', 'browser', 'packages/contract/src/index.ts',
             '--outfile', '/tmp/zebra-metadata-contract-browser.js'],
            ['python3', '-c', "from pathlib import Path; import re; "
             "files=[Path('/tmp/zebra-metadata-'+p+'-browser.js') for p in ['client','contract']]; "
             "assert all(not re.search(r'\\bBun\\b|bun:',p.read_text()) for p in files); "
             "print('Both browser bundles contain no Bun runtime references')"],
        ])
    commands.append(['git', 'diff', '--check'])
    failed = 0
    with (OUT / f'{args.label}-commands.jsonl').open('x') as manifest:
        for index, command in enumerate(commands):
            started = time.time()
            result = subprocess.run(command, cwd=ROOT, env=os.environ.copy(),
                                    stdout=subprocess.PIPE, stderr=subprocess.STDOUT)
            log = f'{args.label}-{index:02}.log.gz'
            (OUT / log).write_bytes(gzip.compress(result.stdout, mtime=0))
            row = {'command': command, 'cwd': str(ROOT), 'PATH': os.environ['PATH'],
                   'started': started, 'seconds': time.time() - started,
                   'exit': result.returncode, 'log': log}
            manifest.write(json.dumps(row) + '\n')
            manifest.flush()
            print(json.dumps({'command': command, 'exit': result.returncode, 'log': log}), flush=True)
            failed += result.returncode != 0
    if args.full and args.label == 'candidate-142':
        env = {**os.environ, 'PATH': '/tmp/zebra-performance-speedup-01/runtime/bun-1.4.0:'
               + os.environ['PATH']}
        result = subprocess.run(['python3', str(Path(__file__).resolve()), 'candidate-140',
                                 '--install', '--full'], cwd=ROOT, env=env)
        failed += result.returncode != 0
    if args.label == 'final-142':
        env = {**os.environ, 'PATH': '/tmp/zebra-performance-speedup-01/runtime/bun-1.4.0:'
               + os.environ['PATH']}
        result = subprocess.run(['python3', str(Path(__file__).resolve()), 'final-140'],
                                cwd=ROOT, env=env)
        failed += result.returncode != 0
    raise SystemExit(bool(failed))


if __name__ == '__main__':
    main()
