"""Final test-only change validation; caller holds run-load.py check."""
import os
from pathlib import Path
import subprocess

OUT = Path(__file__).resolve().parent
failures = []
for runtime in ['142', '140']:
    environment = os.environ.copy()
    if runtime == '140':
        environment['PATH'] = '/tmp/zebra-performance-speedup-01/runtime/bun-1.4.0:' + environment['PATH']
    result = subprocess.run(['python3', str(OUT / 'checks.py'), f'final-{runtime}', 'final'],
                            env=environment)
    if result.returncode:
        failures.append(runtime)
raise SystemExit(bool(failures))
