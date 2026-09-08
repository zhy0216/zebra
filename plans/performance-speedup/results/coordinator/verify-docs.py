import json,subprocess,datetime
from pathlib import Path
base=Path('/tmp/zebra-performance-speedup-f3263289')
state=json.loads((base/'state.json').read_text());root=state['tasks']['06']['path']
head=subprocess.check_output(['git','rev-parse','HEAD'],cwd=root,text=True).strip()
source_paths=[p for p in subprocess.check_output(['git','ls-tree','-r','--name-only','5530f767'],cwd=root,text=True).splitlines() if p.startswith('packages/') or p.startswith('bench/') and p!='bench/README.md' or p in ('package.json','bun.lock','bunfig.toml','tsconfig.json')]
assert subprocess.check_output(['git','diff','--name-only','5530f767','HEAD','--',*source_paths],cwd=root,text=True)==''
logs=base/f'verify-06-{head[:8]}';logs.mkdir(exist_ok=False)
results=[]
for name,cmd in [('diff',['git','diff','--check','master...HEAD']),('typecheck',['bun','run','typecheck']),('lint',['bun','run','lint']),('docs',['env','DOCS_BASE=/zebra/','bun','run','docs:build'])]:
 with (logs/f'{name}.log').open('w') as log:
  r=subprocess.run(['python3',str(base/'run-load.py'),'check',*cmd],cwd=root,stdout=log,stderr=subprocess.STDOUT)
 results.append({'name':name,'command':cmd,'exit':r.returncode});print(json.dumps(results[-1]),flush=True)
 if r.returncode:print((logs/f'{name}.log').read_text()[-5000:],flush=True)
m={'task':'06','head':head,'at':datetime.datetime.now(datetime.timezone.utc).isoformat(),'results':results,'logs':str(logs),'full_test_reused':{'manifest':str(base/'verify-05-5530f767/manifest.json'),'revision':'5530f7678a9df0c92fcdf9e99c268408c913a439','tests':1382,'exit':0,'unchanged_checked_paths':len(source_paths),'reason':'Documentation-only task; source, tests, harness and dependency files identical to coordinator full passing run'}}
(logs/'manifest.json').write_text(json.dumps(m,indent=2)+'\n');print(json.dumps(m),flush=True);raise SystemExit(any(r['exit'] for r in results))
