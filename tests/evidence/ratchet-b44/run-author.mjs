import {spawn} from 'node:child_process';
import fs from 'node:fs';
const root=process.cwd(), mode=process.argv[2], width=process.argv[3], tag=`${mode}-${width}-${Date.now()}`;
const db=`/tmp/rb-b44-ratchet187-${tag}.sqlite`,port=process.env.PORT??'3590',base=`http://127.0.0.1:${port}`;
const server=spawn(process.execPath,['node_modules/vite/bin/vite.js','preview','--host','127.0.0.1','--port',port,'--strictPort'],{cwd:root,env:{...process.env,DAYTHREAD_STORAGE:'sqlite',...(process.env.SEED?{DAYTHREAD_LOCAL_DATA_PATH:process.env.SEED}:{}),DAYTHREAD_SQLITE_PATH:db,DAYTHREAD_AUTH:'off',DAYTHREAD_LINK_PREVIEW:'off',OPENROUTER_API_KEY:''},stdio:['ignore','ignore','pipe']});
server.stderr.on('data',()=>{});
try{
 let ready=false;for(let i=0;i<80;i++){try{if((await fetch(base)).ok){ready=true;break}}catch{} await new Promise(r=>setTimeout(r,100))};if(!ready)throw Error('server failed');
 const child=spawn(process.execPath,[process.env.CHECK ?? 'tests/evidence/b44/menu-check.mjs',base,mode,width],{env:{...process.env,DB:db},stdio:'inherit'});
 const code=await new Promise(r=>child.on('exit',r));process.exitCode=code;
}finally{server.kill('SIGTERM');await new Promise(r=>server.on('exit',r))}
