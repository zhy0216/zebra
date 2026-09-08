import json,subprocess,sys,datetime
from pathlib import Path
base=Path('/tmp/zebra-performance-speedup-f3263289')
key=sys.argv[1]; state=json.loads((base/'state.json').read_text()); root=state['tasks'][key]['path']
head=subprocess.check_output(['git','rev-parse','HEAD'],cwd=root,text=True).strip()
out=base/f'verify-{key}-{head[:8]}-test-retry'
out.mkdir(exist_ok=False)
cmd=['bun','run','test']
with (out/'test.log').open('w') as log:
 r=subprocess.run(['python3',str(base/'run-load.py'),'check',*cmd],cwd=root,stdout=log,stderr=subprocess.STDOUT)
m={'task':key,'head':head,'command':cmd,'exit':r.returncode,'at':datetime.datetime.now(datetime.timezone.utc).isoformat(),'reason':'Retry only the failed full test gate after focused triage; original failure retained','log':str(out/'test.log')}
(out/'manifest.json').write_text(json.dumps(m,indent=2)+'\n')
print(json.dumps(m));print((out/'test.log').read_text()[-1200:]);raise SystemExit(r.returncode)
