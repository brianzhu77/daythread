import {SqliteWorkspaceRepository} from '../../../src/server/sqlite-repository.ts';
// B44 (Jazz's states §1–§5, §9; Lead 17ab8da6 for §4a): pasting a link gives a plain link and a menu; every way out
// keeps the link; "Bookmark page" makes A2's card and page as a second undo step; a kept link is still remembered and
// goes with its line. Built server, sign-in off, a fresh store per run:
//   DB=<store> node tests/evidence/b44/menu-check.mjs <base> <keep|bookmark|several|typing|sentence|saved|phone-bookmark|three|good-stuffs|offline|offline-closed> [width]
import { chromium, webkit } from '@playwright/test'
import { DatabaseSync } from 'node:sqlite'
const [base, mode = 'keep', width = '1280'] = process.argv.slice(2), DB = process.env.DB
if (!base || !['127.0.0.1', 'localhost'].includes(new URL(base).hostname) || new URL(base).port === '3000' || !DB?.startsWith('/tmp/rb-b44-')) throw Error('Use a disposable loopback server and a fresh /tmp/rb-b44-* store')
const phone = Number(width) < 600, mod = process.platform === 'darwin' ? 'Meta' : 'Control'
const browser = await (phone ? webkit : chromium).launch()
const context = await browser.newContext({ viewport: { width: Number(width), height: 900 }, ...(phone ? { hasTouch: true, isMobile: true } : {}) })
let p = await context.newPage()
const errors = []; p.on('pageerror', e => { errors.push(e.message); if (process.env.STACK) console.log('pageerror', e.stack?.slice(0, 1200)) })
let failed = 0
const log = (ok, what, detail = '') => { if (!ok) failed++; console.log(`${ok ? 'ok  ' : 'FAIL'} ${width} ${mode}: ${what}${detail ? ` (${detail})` : ''}`) }
const q = (sql, ...args) => { const d = new DatabaseSync(DB, { readOnly: true }); try { return d.prepare(sql).all(...args) } finally { d.close() } }
/** Waits up to 6 s for the store to reach a state (saves land a moment after the edit). */
const until = async (check, ms = 6000) => { for (const end = Date.now() + ms; Date.now() < end; await p.waitForTimeout(200)) if (await check()) return true; return Boolean(await check()) }
const pagesFor = url => q("SELECT id, title FROM pages WHERE snapshot='current' AND url = ?", url)
const materialFor = url => q("SELECT id, sources FROM materials WHERE snapshot='current' AND url = ?", url)[0]
const today = new Date().toLocaleDateString('en-CA', { timeZone: 'America/Vancouver' })
const U = 'https://www.xiachufang.com/recipe/10324/', U2 = 'https://sspai.com/post/12345'
const menu = () => p.locator('.paste-menu')
const menuText = async () => (await menu().count()) ? (await menu().innerText()).replace(/\s+/g, ' ').trim() : ''
const paste = text => p.evaluate(v => { const dt = new DataTransfer(); dt.setData('text/plain', v); document.activeElement.dispatchEvent(new ClipboardEvent('paste', { clipboardData: dt, bubbles: true, cancelable: true })) }, text)
const notes = `day:${today}:notes:template:0`
const clickNotes = () => p.locator(`.bn-block-outer[data-id="${notes}"] .bn-inline-content`).first().click()
const cards = () => p.locator('.continuous-editor [data-content-type="pageLink"]').count()
const lineTexts = () => p.locator('.continuous-editor .bn-inline-content').allInnerTexts()
await p.goto(`${base}/`, { waitUntil: 'networkidle' }); await p.waitForTimeout(800)

const scenario=process.env.CASE;const repo=new SqliteWorkspaceRepository(DB);
await context.addInitScript(()=>{globalThis.__daythreadGoneAfterMs=1500});
const U3='https://example.net/kept-race';
if(scenario==='immediate'){
 let block=true;await p.route('**/*',r=>block&&r.request().method()==='POST'&&(r.request().postData()??'').includes('save-editor')?r.abort('failed'):r.continue());
 await clickNotes();await paste(U);if(phone)await p.locator('#paste-menu-bookmark').tap();else await p.locator('#paste-menu-bookmark').click();
 log(await until(()=>pagesFor(U).length===1),'immediate Bookmark creates its page while editor saves fail');
 block=false;await p.evaluate(()=>window.dispatchEvent(new Event('online')));log(await until(()=>Boolean(materialFor(U)),8000),'first successful card save remembers pending kept link');
 await p.locator('[role="alert"], [data-slot="toast"]').getByRole('button',{name:'Undo'}).first().click();await p.waitForTimeout(1500);log(await cards()===0&&pagesFor(U).length===0&&Boolean(materialFor(U)),'notice Undo returns plain link and keeps material');
 await p.locator(`.bn-block-outer[data-id="${notes}"] .bn-inline-content`).first().click();await p.keyboard.press(`${mod}+z`);log(await until(()=>!materialFor(U)),'second Undo removes original paste and material');
}else if(scenario==='leave'){
 await clickNotes();await context.setOffline(true);await paste(U);await p.keyboard.press('Escape');await p.waitForTimeout(900);await p.locator('a[href="/pages"]:visible').first().click();await p.waitForTimeout(800);await context.setOffline(false);
 log(await until(()=>Boolean(materialFor(U)),15000),'leaving editor: B40 background save carries this tab kept link');const ws=await repo.load();log(ws.pages.find(x=>x.id===`day:${today}`).editorJSON.includes(U),'background save keeps text');
}else if(scenario==='lostreply'){
 let lost=false;await p.route('**/*',async r=>{if(!lost&&r.request().method()==='POST'&&(r.request().postData()??'').includes('keptPlainLinks')){lost=true;await r.fetch();await r.abort('failed')}else await r.continue()});
 await clickNotes();await paste(U);await p.keyboard.press('Escape');await p.waitForTimeout(6500);const m=materialFor(U);log(lost&&Boolean(m)&&JSON.parse(m.sources).length===1,'lost save reply replays intent once');
 await p.locator(`.bn-block-outer[data-id="${notes}"] .bn-inline-content`).first().evaluate(el=>{const r=document.createRange();r.selectNodeContents(el);getSelection().removeAllRanges();getSelection().addRange(r)});await p.keyboard.press('Backspace');log(await until(()=>!materialFor(U)),'deleting after reply recovery removes material');
}else if(scenario==='undo'){
 await clickNotes();await context.setOffline(true);await paste(U);await p.waitForTimeout(500);await p.keyboard.press(`${mod}+z`);await p.waitForTimeout(1000);await context.setOffline(false);await p.waitForTimeout(6500);
 log(!(await lineTexts()).some(t=>t.includes(U))&&!materialFor(U),'offline paste undone before reconnect: no text or material resurrected');
}else if(scenario==='merge'||scenario==='loadlatest'){
 await p.route('**/*',route=>route.request().method()==='POST'?route.abort('failed'):route.continue());
 await clickNotes();await paste(U);await p.keyboard.press('Escape');await p.waitForTimeout(900);
 const b=await context.newPage();b.on('pageerror',e=>errors.push(e.message));await b.goto(`${base}/`,{waitUntil:'networkidle'});await b.waitForTimeout(600);
 await b.locator(`.bn-block-outer[data-id="${notes}"] .bn-inline-content`).first().click();await b.keyboard.type('other device words');
 log(await until(()=>q("SELECT editorJSON FROM pages WHERE snapshot='current' AND id=?",`day:${today}`)[0]?.editorJSON?.includes('other device words')),'other tab saved competing line');
 if(scenario==='merge'){
  await p.close({runBeforeUnload:true});await b.waitForTimeout(1700);p=b;await p.reload({waitUntil:'networkidle'});
 }else{
  await p.unroute('**/*');await p.evaluate(()=>window.dispatchEvent(new Event('online')));await p.waitForTimeout(5000);
  const latest=p.getByRole('button',{name:'Load latest',exact:true});log(await latest.count()===1,'conflicting owner gets Load latest');await latest.click();
 }
 const ok=await until(()=>Boolean(materialFor(U)),12000);const ws=await repo.load(),page=ws.pages.find(x=>x.id===`day:${today}`),nodes=JSON.parse(page.editorJSON??'[]');
 const all=[];const walk=ns=>ns.forEach(n=>{all.push(n);walk(n.children??[])});walk(nodes);
 const sources=JSON.parse(materialFor(U)?.sources??'[]'),matching=all.filter(n=>JSON.stringify(n.content).includes(U));
 log(ok&&sources.length===1&&matching.some(n=>n.id===sources[0].blockId),'kept intent follows remapped line exactly once',JSON.stringify({sources,ids:matching.map(n=>n.id)}));
 log(page.editorJSON.includes('other device words'),'other device words preserved');
}else if(scenario==='race'){
 const b=await context.newPage(),c=await context.newPage();for(const t of[b,c]){t.on('pageerror',e=>errors.push(e.message));await t.goto(`${base}/pages`,{waitUntil:'networkidle'})}
 await p.route('**/*',r=>r.request().method()==='POST'?r.abort('failed'):r.continue());await clickNotes();await paste(U3);await p.keyboard.press('Escape');await p.waitForTimeout(500);
 // Both survivors inspect the live owner's draft; neither may take it.
 await Promise.all([b,c].map(t=>t.evaluate(()=>window.dispatchEvent(new Event('online')))));await p.waitForTimeout(300);log(!materialFor(U3),'live other-tab draft not taken');
 await p.close({runBeforeUnload:true});p=b;await b.waitForTimeout(1700);
 await Promise.all([b,c].map(t=>t.evaluate(()=>window.dispatchEvent(new Event('online')))));
 log(await until(()=>Boolean(materialFor(U3)),12000),'two survivors recover closed-tab intent');
 const ws=await repo.load(),pg=ws.pages.find(x=>x.id===`day:${today}`),sources=JSON.parse(materialFor(U3)?.sources??'[]');
 const all=[];const walk=ns=>ns.forEach(n=>{all.push(n);walk(n.children??[])});walk(JSON.parse(pg.editorJSON??'[]'));
 log(ws.materials.filter(m=>m.url===U3).length===1&&sources.length===1&&all.filter(n=>JSON.stringify(n.content).includes(U3)).length===1,'one material, one source, one recovered line',JSON.stringify(sources));
}
log(errors.length===0,'no page errors',errors.join(' / '));await browser.close();process.exitCode=failed?1:0;
