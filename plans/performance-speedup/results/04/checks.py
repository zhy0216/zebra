"""Record checks; invoke this entire script under run-load.py check."""
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

ROOT = Path(__file__).resolve().parents[4]
OUT = Path(__file__).resolve().parent
HARNESS = '/home/ubuntu/workspace/zebra/bench/hot-path.ts'
BASELINE = '/tmp/zebra-performance-speedup-01/baseline-a856cab'
FOCUSED = ['bun', 'test', 'packages/core/test/di',
           *[f'packages/core/test/app/{name}.test.ts' for name in
             ['boot-validation', 'inject-boot-validation', 'route-deps', 'fast-path',
              'session', 'session-generation', 'cleanup-errors']]]


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--label', required=True)
    parser.add_argument('--mode', choices=['reference', 'candidate', 'minimum', 'repository', 'store', 'final-source', 'delivery'], required=True)
    args = parser.parse_args()
    commands = []
    if args.mode == 'reference':
        commands = [['bun', '--version'], ['bun', '--revision'],
                    ['bun', 'install', '--frozen-lockfile'], FOCUSED,
                    ['bun', HARNESS, '--source-root', BASELINE, '--suite', 'all', '--check']]
    elif args.mode == 'candidate':
        commands = [['node_modules/.bin/biome', 'check', '--write', 'packages/core/test/di/container-cache.test.ts'],
                    FOCUSED,
                    ['bun', HARNESS, '--source-root', str(ROOT), '--suite', 'all', '--check'],
                    ['bun', 'run', 'typecheck'], ['bun', 'run', 'lint']]
    elif args.mode == 'minimum':
        commands = [['bun', HARNESS, '--source-root', str(ROOT), '--suite', 'all', '--check'],
                    ['bun', 'run', 'typecheck'], ['bun', 'run', 'lint']]
    elif args.mode == 'store':
        commands = [['bun', 'test', 'packages/session/test/store.test.ts']]
    elif args.mode == 'final-source':
        commands = [FOCUSED,
                    ['bun', HARNESS, '--source-root', str(ROOT), '--suite', 'all', '--check'],
                    ['bun', 'run', 'typecheck'], ['bun', 'run', 'lint'],
                    ['git', 'diff', '--check']]
    elif args.mode == 'repository':
        commands = [['bun', 'run', 'build'], ['bun', 'run', 'test'],
                    ['bun', 'run', 'verify:packages'],
                    ['bun', 'test', '--coverage', '--coverage-reporter=lcov', 'packages/core'],
                    ['bun', 'run', 'check:coverage'], ['bun', 'run', 'docs:build'],
                    ['bun', 'build', '--target', 'browser', 'packages/client/src/index.ts',
                     '--outfile', str(OUT / f'{args.label}-client.bundle')],
                    ['bun', 'build', '--target', 'browser', 'packages/contract/src/index.ts',
                     '--outfile', str(OUT / f'{args.label}-contract.bundle')]]
    else:
        commands = [['git', 'diff', '--check'], ['git', 'diff', '--cached', '--check']]
    failed = False
    with (OUT / f'{args.label}.jsonl').open('x') as manifest:
        for index, command in enumerate(commands, 1):
            filename = f'{args.label}-{index:02}.log.gz'
            record = {'command': command, 'cwd': str(ROOT), 'PATH': os.environ['PATH'],
                      'bun': shutil.which('bun'), 'log': filename,
                      'containerSha256': hashlib.sha256((ROOT / 'packages/core/src/di/container.ts').read_bytes()).hexdigest(),
                      'head': subprocess.check_output(['git', 'rev-parse', 'HEAD'], cwd=ROOT, text=True).strip(),
                      'started': datetime.datetime.now(datetime.timezone.utc).isoformat()}
            print(f'{args.label} {index}/{len(commands)}: {command}', flush=True)
            result = subprocess.run(command, cwd=ROOT, stdout=subprocess.PIPE,
                                    stderr=subprocess.STDOUT, env={**os.environ, 'DOCS_BASE': '/zebra/'})
            if '--outfile' in command and result.returncode == 0:
                bundle = Path(command[-1]).read_bytes()
                references = re.findall(rb'\bBun\b|["\']bun:', bundle)
                record['browserAudit'] = {'bundleSha256': hashlib.sha256(bundle).hexdigest(),
                                          'runtimeReferences': len(references)}
                if references:
                    result.returncode = 1
            (OUT / filename).write_bytes(gzip.compress(result.stdout, mtime=0))
            record.update(exit=result.returncode, rawSha256=hashlib.sha256(result.stdout).hexdigest(),
                          finished=datetime.datetime.now(datetime.timezone.utc).isoformat())
            manifest.write(json.dumps(record) + '\n')
            manifest.flush()
            print(f'exit={result.returncode}; {filename}', flush=True)
            failed |= result.returncode != 0
    return int(failed)


if __name__ == '__main__':
    raise SystemExit(main())
