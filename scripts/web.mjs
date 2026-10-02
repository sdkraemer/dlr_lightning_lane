import {spawn} from 'node:child_process';
import {resolve} from 'node:path';
import {cpSync,copyFileSync} from 'node:fs';
import {loadEnvFile} from 'node:process';
try{loadEnvFile('.env');}catch(e){if(e.code!=='ENOENT')throw e;}
process.env.PROJECT_ROOT=process.cwd();
process.env.DATABASE_PATH=resolve(process.env.DATABASE_PATH||'./data/lightning-lane.sqlite');
const mode=process.argv[2];
const args=process.argv.slice(3);
if(args.includes('--mock'))process.env.DEV_MOCK_AUTH='true';
if(!['dev','build','start'].includes(mode))throw new Error('Unknown web command');
if(mode!=='dev'&&process.env.DEV_MOCK_AUTH==='true')throw new Error('DEV_MOCK_AUTH is forbidden for build/start');
let command;
if(mode==='start'){
  const output='apps/web/.next/standalone/apps/web';
  cpSync('apps/web/public',output+'/public',{recursive:true});
  cpSync('apps/web/.next/static',output+'/.next/static',{recursive:true});
  // The repository is ESM; the generated standalone entrypoint is CommonJS.
  copyFileSync(output+'/server.js',output+'/server.cjs');
  process.env.HOSTNAME='127.0.0.1';
  const portIndex=args.indexOf('--port');
  if(portIndex!==-1)process.env.PORT=args[portIndex+1];
  command=[output+'/server.cjs'];
}else{
  command=['node_modules/next/dist/bin/next',mode,'apps/web',...(mode==='dev'?['--hostname','127.0.0.1']:[]),...args.filter(arg=>arg!=='--mock')];
}
const child=spawn(process.execPath,command,{stdio:'inherit',env:process.env});
child.on('exit',code=>process.exit(code??1));
