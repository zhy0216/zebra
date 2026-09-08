import json, subprocess, sys, datetime
from pathlib import Path
base=Path('/tmp/zebra-performance-speedup-f3263289')
key=sys.argv[1]
state=json.loads((base/'state.json').read_text())
task=state['tasks'][key]
root=Path(task['path'])
head=subprocess.check_output(['git','rev-parse','HEAD'],cwd=root,text=True).strip()
logs=base/f'verify-{key}-{head[:8]}'
logs.mkdir(exist_ok=False)
results=[]
for name,cmd in [('diff',['git','diff','--check','master...HEAD']),('typecheck',['bun','run','typecheck']),('lint',['bun','run','lint']),('test',['bun','run','test'])]:
 with (logs/f'{name}.log').open('w') as log:
  r=subprocess.run(['python3',str(base/'run-load.py'),'check',*cmd],cwd=root,stdout=log,stderr=subprocess.STDOUT)
 results.append({'name':name,'command':cmd,'exit':r.returncode})
 print(json.dumps(results[-1]),flush=True)
 if r.returncode: print((logs/f'{name}.log').read_text()[-8000:],flush=True)
manifest={'task':key,'head':head,'at':datetime.datetime.now(datetime.timezone.utc).isoformat(),'results':results,'logs':str(logs)}
(logs/'manifest.json').write_text(json.dumps(manifest,indent=2))
print(json.dumps(manifest),flush=True)
raise SystemExit(any(r['exit'] for r in results))
