import {spawn} from 'node:child_process';
import {SqliteWorkspaceRepository} from '../../../src/server/sqlite-repository.ts';
const width=process.argv[2]??'1280',port=process.env.PORT??'3598',base=`http://127.0.0.1:${port}`,db=`/tmp/rb-b47/ratchet192-standin-${width}-${Date.now()}.sqlite`;
await new SqliteWorkspaceRepository(db,'/tmp/rb-b47/ratchet-ws-356.json').load();
const server=spawn(process.execPath,['node_modules/vite/bin/vite.js','preview','--host','127.0.0.1','--port',port,'--strictPort'],{env:{...process.env,DAYTHREAD_STORAGE:'sqlite',DAYTHREAD_SQLITE_PATH:db,DAYTHREAD_AUTH:'off',OPENROUTER_API_KEY:'',DAYTHREAD_LINK_PREVIEW:'off'},stdio:'ignore'});
try{for(let i=0;i<80;i++){try{if((await fetch(base)).ok)break}catch{}await new Promise(r=>setTimeout(r,100))}
const child=spawn(process.execPath,['tests/evidence/ratchet-b47/standin-card.mjs',base,width],{env:{...process.env,DB:db},stdio:'inherit'});process.exitCode=await new Promise(r=>child.on('exit',r));
}finally{server.kill('SIGTERM');await new Promise(r=>server.on('exit',r))}
