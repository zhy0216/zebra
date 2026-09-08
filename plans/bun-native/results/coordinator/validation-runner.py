import argparse, datetime, json, os, pathlib, subprocess, time
p=argparse.ArgumentParser();p.add_argument('cwd');p.add_argument('label');p.add_argument('--bun-dir');p.add_argument('--full',action='store_true');p.add_argument('--resume',action='store_true');a=p.parse_args()
out=pathlib.Path('/tmp/zebra-bun-native-run')/a.label;out.mkdir(exist_ok=True)
env=os.environ.copy()
if a.bun_dir: env['PATH']=a.bun_dir+os.pathsep+env['PATH']
commands=[['bun','run',c] for c in ['typecheck','lint','build','test']]
if a.full:
 commands.insert(0,['bun','install','--frozen-lockfile'])
 commands += [['bun','run','verify:packages'],['bun','test','--coverage','--coverage-reporter=lcov','packages/core'],['bun','run','check:coverage'],['bun','run','docs:build']]
commands += [['git','diff','--check']]
head=subprocess.check_output(['git','rev-parse','HEAD'],cwd=a.cwd,text=True).strip()
version=subprocess.check_output(['bun','--version'],cwd=a.cwd,env=env,text=True).strip()
results=json.loads((out/'results.json').read_text()) if a.resume else []
for i,cmd in enumerate(commands):
 if i<len(results):
  assert results[i]['command']==cmd and results[i]['head']==head and results[i]['bun']==version and results[i]['exit']==0
  continue
 e=env.copy()
 if cmd[-1]=='docs:build':e['DOCS_BASE']='/zebra/'
 started=datetime.datetime.now(datetime.timezone.utc).isoformat();t=time.monotonic()
 with (out/f'{i:02d}-{cmd[-1].replace(":","-").replace("/","-")}.txt').open('w') as f:
  f.write(f'HEAD={head}\nBun={version}\nCWD={a.cwd}\ncommand={cmd}\nstarted={started}\n');f.flush()
  r=subprocess.run(cmd,cwd=a.cwd,env=e,stdout=f,stderr=subprocess.STDOUT)
 item={'command':cmd,'head':head,'bun':version,'exit':r.returncode,'seconds':round(time.monotonic()-t,2),'started':started}
 results.append(item);(out/'results.json').write_text(json.dumps(results,indent=2));print(json.dumps(item),flush=True)
 if r.returncode:raise SystemExit(r.returncode)
