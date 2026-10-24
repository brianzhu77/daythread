import http from 'node:http';
import { fetchLinkPreview } from '../../../src/server/link-preview.ts';
process.env.DAYTHREAD_LINK_PREVIEW_TEST_LOOPBACK='1';
const server=http.createServer((req,res)=>{res.writeHead(302,{location:'http://['});res.end()});
await new Promise<void>(r=>server.listen(0,'127.0.0.1',r));
const address=server.address() as {port:number};
try { console.log(await fetchLinkPreview(`http://127.0.0.1:${address.port}/`)); } finally {server.close()}
