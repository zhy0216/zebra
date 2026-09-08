"""Run one validation phase INSIDE the coordinator check allocation."""
import datetime
import gzip
import hashlib
import json
import os
from pathlib import Path
import re
import shutil
import subprocess
import sys

OUT = Path(__file__).resolve().parent
ROOT = OUT.parents[3]
HARNESS = Path('/home/ubuntu/workspace/zebra/bench/hot-path.ts')
BASELINE = Path('/tmp/zebra-performance-speedup-01/baseline-a856cab')
RUNTIMES = {'142': '/home/ubuntu/.bun/bin',
            '140': '/tmp/zebra-performance-speedup-01/runtime/bun-1.4.0'}


def stamp():
    return datetime.datetime.now(datetime.timezone.utc).isoformat()


def run(label, command, runtime):
    env = os.environ.copy()
    env['PATH'] = RUNTIMES[runtime] + ':' + env['PATH']
    env['DOCS_BASE'] = '/zebra/'
    log = OUT / f'{label}-{runtime}.log.gz'
    if log.exists():
        raise RuntimeError(f'Refusing to overwrite {log}')
    record = {'label': label, 'runtime': runtime, 'command': command,
              'cwd': str(ROOT), 'PATH': env['PATH'], 'DOCS_BASE': env['DOCS_BASE'],
              'executable': shutil.which('bun', path=env['PATH']),
              'head': subprocess.check_output(['git', 'rev-parse', 'HEAD'], cwd=ROOT, text=True).strip(),
              'started': stamp()}
    print(f'{record["started"]} {runtime} {label}', flush=True)
    result = subprocess.run(command, cwd=ROOT, env=env, stdout=subprocess.PIPE, stderr=subprocess.STDOUT)
    log.write_bytes(gzip.compress(result.stdout, mtime=0))
    record.update(finished=stamp(), exit=result.returncode, log=log.name,
                  rawSha256=hashlib.sha256(result.stdout).hexdigest(),
                  counts=re.findall(r'^\s*\d+ (?:pass|fail|expect\(\) calls).*$', result.stdout.decode(errors='replace'), re.M))
    with (OUT / 'checks.jsonl').open('a') as manifest:
        manifest.write(json.dumps(record) + '\n')
    print(json.dumps(record), flush=True)
    if result.returncode:
        print(result.stdout.decode(errors='replace')[-10000:], flush=True)
        raise SystemExit(result.returncode)


def main():
    phase, runtime = sys.argv[1:]
    if phase == 'repository':
        commands = [('version', ['bun', '--version']), ('revision', ['bun', '--revision']),
                    ('install', ['bun', 'install', '--frozen-lockfile'])]
        # The coordinator's actual 1382/1382 current-runtime run is reused.
        if runtime == '140':
            commands.append(('full-test', ['bun', 'run', 'test']))
        commands += [('build', ['bun', 'run', 'build']),
                     ('packages', ['bun', 'run', 'verify:packages']),
                     ('coverage', ['bun', 'test', '--coverage', '--coverage-reporter=lcov', 'packages/core']),
                     ('coverage-gate', ['bun', 'run', 'check:coverage']),
                     ('baseline-harness', ['bun', str(HARNESS), '--source-root', str(BASELINE), '--suite', 'all', '--check']),
                     ('integrated-harness', ['bun', str(HARNESS), '--source-root', str(ROOT), '--suite', 'all', '--check'])]
        for package in ('client', 'contract'):
            bundle = OUT / 'dist' / runtime / package
            commands.append((f'browser-{package}', ['bun', 'build', f'packages/{package}/src/index.ts', '--target', 'browser', '--outdir', str(bundle)]))
        commands.append(('browser-scan', ['python3', str(OUT / 'scan-browser.py'), runtime]))
    elif phase == 'documentation':
        commands = [('final-typecheck', ['bun', 'run', 'typecheck']),
                    ('final-lint', ['bun', 'run', 'lint']),
                    ('final-docs', ['bun', 'run', 'docs:build']),
                    ('final-diff', ['git', 'diff', '--check', 'HEAD'])]
    else:
        raise ValueError(phase)
    for label, command in commands:
        run(label, command, runtime)


if __name__ == '__main__':
    main()
