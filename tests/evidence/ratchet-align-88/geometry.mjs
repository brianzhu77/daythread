import {chromium} from 'playwright';
const base=process.argv[2]??'http://127.0.0.1:3399';const b=await chromium.launch();
for(const width of [1280,390]){
const p=await b.newPage({viewport:{width,height:1000}});await p.goto(base+(process.argv[3]??'/day/2026-10-18'),{waitUntil:'networkidle'});await p.waitForTimeout(700);
const rows=await p.evaluate(()=>{
 const box=e=>{if(!e)return null;const b=e.getBoundingClientRect();return{x:b.x,y:b.y,w:b.width,h:b.height,cy:b.y+b.height/2}};
 const line=e=>{let r=document.createRange();r.selectNodeContents(e);let q=[...r.getClientRects()].find(r=>r.width>0&&r.height>0);return q?{x:q.x,y:q.y,cy:q.y+q.height/2,h:q.height}:null};
 let out=[];for(const t of document.querySelectorAll('.editor-task-title'))out.push({kind:t.classList.contains('task-done')?'done':'task',text:line(t),marker:box(t.closest('.editor-task').querySelector('input'))});
 for(const c of document.querySelectorAll('.editor-page-card'))out.push({kind:c.closest('.editor-page-card-row').classList.contains('is-link')?'link':'card',text:line(c.querySelector('.editor-page-card-title')),marker:box(c.querySelector('.editor-page-card-icon')),chevron:box(c.querySelector(':scope>svg')),preview:!!c.querySelector('.editor-page-card-preview'),open:c.closest('.editor-page-card-row').querySelector('.editor-page-card-open svg')?box(c.closest('.editor-page-card-row').querySelector('.editor-page-card-open svg')):null});
 for(const n of document.querySelectorAll('.bn-block-content[data-content-type=bulletListItem]')){const inline=n.querySelector('.bn-inline-content');if(!inline)continue;const ps=getComputedStyle(n,'::before');out.push({kind:n.closest('.bn-block-group')?.parentElement?.closest('.bn-block-group')?'nested':'bullet',text:line(inline),pseudo:{left:ps.left,top:ps.top,width:ps.width,height:ps.height,transform:ps.transform},content:box(n)});}
 for(const h of document.querySelectorAll('h2'))out.push({kind:'heading',text:line(h)});return out;
});console.log(width,JSON.stringify(rows));await p.screenshot({path:`tests/evidence/ratchet-align-88/${width}.png`,fullPage:true});await p.close();}
await b.close();
