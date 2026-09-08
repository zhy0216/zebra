#!/usr/bin/env python3
import fcntl, subprocess, sys
from pathlib import Path
base=Path('/tmp/zebra-performance-speedup-f3263289')
mode=sys.argv[1]
assert mode in ('check','measure')
with open(base/'gate.lock','w') as gate, open(base/'load.lock','w') as load:
 fcntl.flock(gate,fcntl.LOCK_EX)
 fcntl.flock(load,fcntl.LOCK_EX if mode=='measure' else fcntl.LOCK_SH)
 if mode=='check': fcntl.flock(gate,fcntl.LOCK_UN)
 raise SystemExit(subprocess.call(sys.argv[2:]))
