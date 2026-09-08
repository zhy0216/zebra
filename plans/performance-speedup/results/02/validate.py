"""Both-runtime repository/runtime checks; caller holds run-load.py check."""
import os
from pathlib import Path
import subprocess

OUT = Path(__file__).resolve().parent
MINIMUM = '/tmp/zebra-performance-speedup-01/runtime/bun-1.4.0'

failures = []
for runtime in ['142', '140']:
    environment = os.environ.copy()
    if runtime == '140':
        environment['PATH'] = MINIMUM + ':' + environment['PATH']
    for mode in (['full'] if runtime == '142' else ['full', 'focused']):
        command = ['python3', str(OUT / 'checks.py'), f'candidate-{mode}-{runtime}', mode]
        result = subprocess.run(command, env=environment)
        if result.returncode:
            failures.append(command)
raise SystemExit(bool(failures))
