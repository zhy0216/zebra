"""Run the exact new compatibility tests against the read-only baseline router."""
import gzip
from pathlib import Path
import subprocess
import sys

OUT = Path(__file__).resolve().parent
ROOT = OUT.parents[3]
BEFORE = '/tmp/zebra-performance-speedup-01/baseline-a856cab'


def main():
    generated = []
    for name in ['router/radix', 'fuzz/router']:
        source = ROOT / f'packages/core/test/{name}.test.ts'
        text = source.read_text().replace('../../src/router/radix.ts',
                                          f'{BEFORE}/packages/core/src/router/radix.ts')
        text = text.replace('./prng.ts', f'{ROOT}/packages/core/test/fuzz/prng.ts')
        label = sys.argv[1] if len(sys.argv) > 1 else 'initial'
        path = OUT / f'baseline-{label}-{name.replace("/", "-")}.test.ts'
        path.write_text(text)
        generated.append(path)
    try:
        return subprocess.run(['bun', 'test', *map(str, generated)], cwd=ROOT).returncode
    finally:
        for path in generated:
            with gzip.open(str(path) + '.gz', 'wb') as file:
                file.write(path.read_bytes())
            path.unlink()


if __name__ == '__main__':
    raise SystemExit(main())
