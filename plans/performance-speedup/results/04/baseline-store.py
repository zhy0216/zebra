"""One unchanged-baseline store-suite reproduction, invoked under run-load.py check."""
import datetime
import gzip
import hashlib
import json
import os
from pathlib import Path
import shutil
import subprocess

out = Path(__file__).resolve().parent
baseline = Path('/tmp/zebra-performance-speedup-01/baseline-a856cab')
environment = {**os.environ, 'PATH': '/home/ubuntu/.bun/bin:' + os.environ['PATH']}
bun = shutil.which('bun', path=environment['PATH'])
assert bun == '/home/ubuntu/.bun/bin/bun'
names = ['packages/session/src/store.ts', 'packages/session/test/store.test.ts']
hashes = {name: hashlib.sha256((baseline / name).read_bytes()).hexdigest() for name in names}
command = [bun, 'test', 'packages/session/test/store.test.ts']
record = {'command': command, 'cwd': str(baseline), 'PATH': environment['PATH'],
          'archiveRevision': 'a856cab47d4fd3102e976ce7a70166837837eea2',
          'sourceHashes': hashes, 'started': datetime.datetime.now(datetime.timezone.utc).isoformat()}
result = subprocess.run(command, cwd=baseline, env=environment,
                        stdout=subprocess.PIPE, stderr=subprocess.STDOUT)
assert hashes == {name: hashlib.sha256((baseline / name).read_bytes()).hexdigest() for name in names}
log = 'baseline-store-142.log.gz'
with (out / log).open('xb') as file:
    file.write(gzip.compress(result.stdout, mtime=0))
record.update(exit=result.returncode, log=log, rawSha256=hashlib.sha256(result.stdout).hexdigest(),
              finished=datetime.datetime.now(datetime.timezone.utc).isoformat())
with (out / 'baseline-store-142.jsonl').open('x') as file:
    file.write(json.dumps(record) + '\n')
print(json.dumps(record), flush=True)
raise SystemExit(result.returncode)
