import http from 'node:http';
import assert from 'node:assert/strict';
import { fetchLinkPreview, isPublicAddress } from '../../../src/server/link-preview.ts';
process.env.DAYTHREAD_LINK_PREVIEW_TEST_LOOPBACK='1';
let streaming=0,bytes=0;const timers=new Set<ReturnType<typeof setInterval>>();
const server=http.createServer((req,res)=>{
 if(req.url==='/ok'){res.writeHead(200,{'content-type':'text/html'});return res.end('<title>Done</title>')}
 res.writeHead(req.url==='/redirect'?302:200,req.url==='/redirect'?{location:'/ok'}:{'content-type':'application/octet-stream'});
 streaming++;const t=setInterval(()=>{res.write(Buffer.alloc(65536));bytes+=65536},5);timers.add(t);
 res.on('close',()=>{streaming--;clearInterval(t);timers.delete(t)});
});
await new Promise<void>(r=>server.listen(0,'127.0.0.1',r));const {port}=server.address() as {port:number};
try {
 for(const path of ['/redirect','/nonhtml']){
  const before=bytes;console.log(path,await fetchLinkPreview(`http://127.0.0.1:${port}${path}`));
  await new Promise(r=>setTimeout(r,120)); console.log({streaming,bytesAfterReturn:bytes-before});
 }
 console.log('site-local fec0::1 public?',isPublicAddress('fec0::1'));
} finally {for(const t of timers)clearInterval(t);server.closeAllConnections();server.close()}
