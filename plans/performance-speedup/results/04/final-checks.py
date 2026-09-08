"""Focused final-source validation, under one outer check lock; no repeated full gates."""
import os
from pathlib import Path
import subprocess

script = Path(__file__).with_name('checks.py')
failed = False
for runtime, prefix in [
    ('142', '/home/ubuntu/.bun/bin'),
    ('140', '/tmp/zebra-performance-speedup-01/runtime/bun-1.4.0'),
]:
    environment = {**os.environ, 'PATH': prefix + ':' + os.environ['PATH']}
    command = ['python3', str(script), '--label', f'final-source-{runtime}', '--mode', 'final-source']
    failed |= subprocess.run(command, env=environment, check=False).returncode != 0
raise SystemExit(int(failed))
