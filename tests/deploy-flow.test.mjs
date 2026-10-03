import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';

const dockerMock = `#!/usr/bin/env node
const fs=require('node:fs');
const a=process.argv.slice(2), s=a.join(' '), scenario=process.env.SCENARIO;
fs.appendFileSync(process.env.TRACE, JSON.stringify(a)+'\\n');
function out(x){ console.log(x); process.exit(0); }
if(a[0]==='inspect'){
 if(s.includes('working_dir'))out(process.env.APP);
 if(s.includes('Config.Image'))out('old:image sha256:old');
 if(a[1]==='caddy'){
  if(s.includes('/config'))out('fixture_caddy-config');
  out(scenario==='caddy-mismatch'?'wrong-volume':'fixture_caddy-data');
 }
 out(scenario==='sqlite-mismatch'?'wrong-volume':'fixture_sqlite-data');
}
if(a[0]==='info')out('x86_64');
if(a[0]==='image')out('linux/amd64');
if(a[0]==='load')process.exit(0);
if(a[0]==='run'){process.exit(scenario==='backup-failure'?1:0);}
if(a[0]==='compose'){
 if(s.includes('config --format'))out(JSON.stringify({volumes:Object.fromEntries(['sqlite-data','caddy-data','caddy-config'].map(k=>[k,{name:'fixture_'+k}]))}));
 if(s.includes('ps -q'))out(a.at(-1));
 if(s.includes('check-vapid'))process.exit(scenario==='preflight-failure'?1:0);
 if(s.includes('init-db'))process.exit(scenario==='migration-failure'?1:0);
 process.exit(0);
}
throw Error('Unexpected Docker command: '+s);
`;
const pythonMock = `#!/usr/bin/env node
let input='';process.stdin.on('data',c=>input+=c);process.stdin.on('end',()=>console.log(JSON.parse(input).volumes[process.argv[4]??'sqlite-data'].name));
`;

for (const scenario of ['success', 'sqlite-mismatch', 'caddy-mismatch', 'preflight-failure', 'backup-failure', 'migration-failure']) {
  test('remote deployment ordering: ' + scenario, { skip: process.platform !== 'linux' }, () => {
    const dir = mkdtempSync(join(tmpdir(), 'dlr-deploy-flow-'));
    try {
      const app = join(dir, 'app'), release=join(app,'.deploy/releases/test'), bin=join(dir,'bin'), trace=join(dir,'trace');
      mkdirSync(release,{recursive:true});mkdirSync(join(app,'deploy'));mkdirSync(bin);
      for(const [path,content] of [[join(app,'.env'),'SENTINEL=unchanged'],[join(app,'compose.yaml'),'old-compose'],[join(app,'deploy/Caddyfile'),'old-caddy'],[join(release,'compose.yaml'),'new-compose'],[join(release,'Caddyfile'),'new-caddy']])writeFileSync(path,content);
      writeFileSync(join(bin,'docker'),dockerMock,{mode:0o755});
      writeFileSync(join(bin,'python3'),pythonMock,{mode:0o755});
      const helper=join(dir,'apply.sh');
      writeFileSync(helper,readFileSync(new URL('../deploy/apply-release.sh',import.meta.url),'utf8').replaceAll('\r\n','\n'));
      const result=spawnSync('bash',[helper,app,'fixture','test'],{cwd:release,env:{...process.env,PATH:bin+':'+process.env.PATH,APP:app,TRACE:trace,SCENARIO:scenario},encoding:'utf8',timeout:20000});
      assert.equal(result.status,scenario==='success'?0:1,result.stderr+result.stdout);
      const calls=readFileSync(trace,'utf8').trim().split('\n').map(x=>JSON.parse(x).join(' '));
      const stop=calls.findIndex(x=>x.includes('stop web worker'));
      const backup=calls.findIndex(x=>x.startsWith('run --rm'));
      const migrate=calls.findIndex(x=>x.includes('init-db.ts'));
      const up=calls.findIndex(x=>x.includes('up -d'));
      if(['sqlite-mismatch','caddy-mismatch','preflight-failure'].includes(scenario))assert.equal(stop,-1);
      if(scenario==='backup-failure'){assert.ok(stop>=0);assert.equal(migrate,-1);}
      if(scenario==='migration-failure'){assert.ok(migrate>backup);assert.equal(up,-1);}
      if(scenario==='success')assert.ok(stop>=0 && backup>stop && migrate>backup && up>migrate);
      assert.equal(readFileSync(join(app,'.env'),'utf8'),'SENTINEL=unchanged');
      assert.equal(readFileSync(join(app,'compose.yaml'),'utf8'),scenario==='success'?'new-compose':'old-compose');
      assert.ok(!calls.some(x=>x.includes('down')||x.includes('prune')));
    } finally { rmSync(dir,{recursive:true,force:true}); }
  });
}
