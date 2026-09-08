"""Sequential repository validation for both runtimes, under one outer check lock."""
import os
from pathlib import Path
import subprocess

script = Path(__file__).with_name('checks.py')
failed = False
for runtime, prefix, modes in [
    ('142', '/home/ubuntu/.bun/bin', ['repository']),
    ('140', '/tmp/zebra-performance-speedup-01/runtime/bun-1.4.0', ['minimum', 'repository']),
]:
    environment = {**os.environ, 'PATH': prefix + ':' + os.environ['PATH']}
    for mode in modes:
        command = ['python3', str(script), '--label', f'{mode}-{runtime}', '--mode', mode]
        failed |= subprocess.run(command, env=environment, check=False).returncode != 0
raise SystemExit(int(failed))
