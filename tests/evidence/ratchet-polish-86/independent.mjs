import {chromium} from 'playwright';
import {DatabaseSync} from 'node:sqlite';
const base='http://127.0.0.1:3397', db='/private/tmp/ratchet86.sqlite';
const out='tests/evidence/ratchet-polish-86';
const sql=q=>{let d=new DatabaseSync(db,{readOnly:true});try{return d.prepare(q).all()}finally{d.close()}};
const check=(ok,s,x='')=>{console.log(`${ok?'PASS':'FAIL'} ${s} ${JSON.stringify(x)}`);if(!ok)process.exitCode=1};
const snap=()=>JSON.stringify(sql("SELECT id,sections,editorJSON FROM pages WHERE snapshot='current' ORDER BY id"));
const b=await chromium.launch();let errors=[];
for(const width of [1280,390]){
 const p=await b.newPage({viewport:{width,height:1000}});p.on('pageerror',e=>errors.push(e.message));p.on('console',m=>{if(m.type()==='error')errors.push(m.text())});
 await p.goto(base+'/day/2026-10-18',{waitUntil:'networkidle'});await p.waitForTimeout(700);
 const start=snap();const styles=await p.locator('.editor-task-title').evaluateAll(es=>es.map(e=>({done:e.classList.contains('task-done'),dec:getComputedStyle(e).textDecorationLine,color:getComputedStyle(e).color})));
 check(styles.filter(s=>s.done).every(s=>s.dec.includes('line-through'))&&styles.some(s=>!s.done&&!s.dec.includes('line-through')),width+' done and open distinguishable',styles);
 check(await p.locator('.bn-block-content[data-content-type=heading] h2').first().evaluate(e=>getComputedStyle(e).fontSize)==='19px',width+' headings19');
 check(await p.locator('.bn-block-content[data-content-type=task]').first().evaluate(e=>getComputedStyle(e).borderLeftColor)==='rgba(0, 0, 0, 0)',width+' no blue task bar');
 check(await p.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),width+' no page horizontal overflow');
 check(snap()===start,width+' display does not persist changes');
 await p.screenshot({path:out+'/'+width+'.png',fullPage:true});
 // Type at the end of a saved task, undo normal input, and verify persisted title is restored.
 const t=p.locator('.editor-task-title').filter({hasText:'优化 Calendar'}).first();let original=await t.innerText();await t.click();await p.keyboard.press('End');await p.keyboard.type(' QA86');await p.waitForTimeout(1100);await p.keyboard.press('Meta+z');await p.waitForTimeout(1200);
 check((await t.innerText())===original,width+' task text typing Undo',await t.innerText());
 await p.reload({waitUntil:'networkidle'});await p.waitForTimeout(500);check((await p.locator('.editor-task-title').filter({hasText:'优化 Calendar'}).first().innerText())===original,width+' task Undo survives reload');
 // Copy past-day whole document through browser clipboard; hidden empty rows stay in underlying editor and storage.
 await p.context().grantPermissions(['clipboard-read','clipboard-write']);const note=p.locator('.bn-inline-content').filter({hasText:'English Lesson'}).first();await note.click();await p.keyboard.press('Meta+a');await p.keyboard.press('Meta+a');await p.keyboard.press('Meta+c');await p.waitForTimeout(200);let clip=await p.evaluate(()=>navigator.clipboard.readText());check(clip.includes('English Lesson')&&clip.includes('奥德赛'),width+' whole-document copy retains visible content',clip.slice(0,300));
 await p.close();
}
check(errors.length===0,'no page/console errors',errors);await b.close();
