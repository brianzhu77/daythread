import {SqliteWorkspaceRepository} from '../../../src/server/sqlite-repository.ts';
// B44 (Jazz's states §1–§5, §9; Lead 17ab8da6 for §4a): pasting a link gives a plain link and a menu; every way out
// keeps the link; "Bookmark page" makes A2's card and page as a second undo step; a kept link is still remembered and
// goes with its line. Built server, sign-in off, a fresh store per run:
//   DB=<store> node tests/evidence/b44/menu-check.mjs <base> <keep|bookmark|several|typing|sentence|saved> [width]
import { chromium, webkit } from '@playwright/test'
import { DatabaseSync } from 'node:sqlite'
const [base, mode = 'keep', width = '1280'] = process.argv.slice(2), DB = process.env.DB
if (!base || !['127.0.0.1', 'localhost'].includes(new URL(base).hostname) || new URL(base).port === '3000' || !DB?.startsWith('/tmp/rb-b44-')) throw Error('Use a disposable loopback server and a fresh /tmp/rb-b44-* store')
const phone = Number(width) < 600, mod = process.platform === 'darwin' ? 'Meta' : 'Control'
const browser = await (phone ? webkit : chromium).launch()
const p = await browser.newPage({ viewport: { width: Number(width), height: 900 }, ...(phone ? { hasTouch: true, isMobile: true } : {}) })
const errors = []; p.on('pageerror', e => errors.push(e.message))
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
const book=async()=>{if(phone)await p.locator('#paste-menu-bookmark').tap();else{await p.keyboard.press('ArrowDown');await p.keyboard.press('Enter')}await p.waitForTimeout(1800)};
if(scenario==='copy'){
 await p.locator('.continuous-editor .bn-inline-content').last().click();await p.keyboard.press('Enter');await paste(U);await p.waitForTimeout(800);log(await menu().count()===1&&pagesFor(U).length===0,'real row copy: menu and no automatic page');await book();log(pagesFor(U).length===1&&await cards()>0,'real row copy: bookmark made');
}else if(scenario==='title'){
 await repo.executeOnLatest(crypto.randomUUID(),{type:'create-document',pageId:'title-test',title:'Document',body:''});await p.goto(`${base}/pages?page=title-test`,{waitUntil:'networkidle'});await p.waitForTimeout(800);await p.locator('.page-title-field').click();await paste(U);await p.waitForTimeout(400);log(await menu().count()===0,'title paste has no menu');
}else if(scenario==='offlinekeep'){
 await clickNotes();await p.context().setOffline(true);await paste(U);await p.waitForTimeout(800);await p.keyboard.press('Escape');await p.waitForTimeout(800);await p.context().setOffline(false);await p.waitForTimeout(6500);
 log((await lineTexts()).some(t=>t.includes(U)),'offline kept text retained');log(Boolean(materialFor(U)),'offline kept link is remembered after reconnect',JSON.stringify(materialFor(U)??null));
}else if(scenario==='notice'){
 await clickNotes();await paste(U);await p.waitForTimeout(300);await book();
 await p.locator('[role="alert"], [data-slot="toast"]').getByRole('button',{name:'Undo'}).first().click();await p.waitForTimeout(1800);
 log(await cards()===0&&pagesFor(U).length===0&&Boolean(materialFor(U)),'notice Undo restores plain link and retains material');
 // A real user can refocus; verify the second history step too.
 await p.locator(`.bn-block-outer[data-id="${notes}"] .bn-inline-content`).first().click();await p.keyboard.press(`${mod}+z`);
 log(await until(()=>!materialFor(U)),'after notice Undo, refocused history Undo removes original paste');
}else if(scenario==='trash'){
 await clickNotes();await paste(U);await p.waitForTimeout(300);await book();const id=pagesFor(U)[0]?.id;
 await repo.executeOnLatest(crypto.randomUUID(),{type:'delete-page',pageId:id,at:new Date().toISOString()});await p.reload({waitUntil:'networkidle'});await p.waitForTimeout(800);
 await p.locator('.continuous-editor .bn-inline-content').last().click();await p.keyboard.press('Enter');await paste(U);await p.waitForTimeout(400);
 log(/Restores it from the trash/.test(await menuText()),'trash explanation before choosing',await menuText());await book();
 const ws=await repo.load();log(ws.pages.filter(p=>p.url===U).length===1&&!ws.pages.find(p=>p.id===id)?.trashedAt,'restored same page once');
}else if(scenario==='html'){
 await clickNotes();await p.evaluate(url=>{const dt=new DataTransfer();dt.setData('text/html',`<a href="${url}">Recipe title</a>`);dt.setData('text/plain','Recipe title');document.activeElement.dispatchEvent(new ClipboardEvent('paste',{clipboardData:dt,bubbles:true,cancelable:true}))},U);await p.waitForTimeout(400);
 log((await lineTexts()).some(t=>t.includes('Recipe title'))&&await menu().count()===1,'copied HTML link keeps its label and offers menu');await book();log(pagesFor(U)[0]?.title==='Recipe title','bookmark uses copied title');
}else if(scenario==='many'){
 await clickNotes();await paste(`${U}\n${U2}\nhttps://example.org/third`);await p.waitForTimeout(400);log(/Bookmark 3 pages/.test(await menuText()),'one menu for three');await p.screenshot({path:`/tmp/ratchet187-many-${width}.png`});console.log('menu/toolbar',await p.evaluate(()=>{const m=document.querySelector('#paste-menu-bookmark').getBoundingClientRect(),t=document.querySelector('.editor-phone-toolbar')?.getBoundingClientRect();return{menu:{top:m.top,bottom:m.bottom},toolbar:t?{top:t.top,bottom:t.bottom}:null,hit:document.elementFromPoint(m.x+m.width/2,m.y+m.height/2)?.outerHTML.slice(0,150)}}));await book();log(await cards()===3,'three cards');const ws=await repo.load();log(ws.pages.filter(p=>[U,U2,'https://example.org/third'].includes(p.url)).length===3,'three pages');
}else if(scenario==='offline'){
 await clickNotes();await paste(U);await p.waitForTimeout(800);await p.context().setOffline(true);await book();await p.waitForTimeout(2000);
 log(await p.getByText('Not created',{exact:false}).count()>0,'offline card refuses with Retry');await p.context().setOffline(false);
 await p.locator('.editor-page-card-failed').first().click();log(await until(()=>pagesFor(U).length===1),'Retry makes page once');
}else if(scenario==='exclusions'){
 await clickNotes();await p.keyboard.type('[] ');await paste(U);await p.waitForTimeout(400);log(await menu().count()===0,'task paste has no menu');
 await p.keyboard.press('Enter');await p.keyboard.press('Backspace');await p.keyboard.type('not a link');await paste(' ordinary words');await p.waitForTimeout(300);log(await menu().count()===0,'ordinary text has no menu');
 await p.locator('.continuous-editor .bn-inline-content').last().click();await p.keyboard.press('Enter');await paste('mailto:hello@example.com');await p.waitForTimeout(300);log(await menu().count()===0,'mailto has no menu');
}else if(scenario==='close'){
 await clickNotes();await paste(U);await p.waitForTimeout(300);await p.keyboard.press('ArrowLeft');await p.waitForTimeout(100);log(await menu().count()===0,'caret movement keeps and closes');
 await p.keyboard.press(`${mod}+z`);await p.waitForTimeout(800);await clickNotes();await paste(U2);await p.waitForTimeout(300);await p.locator('h1').first().click();log(await menu().count()===0,'click outside keeps and closes');
}
log(errors.length===0,'no page errors',errors.join(' / '));await browser.close();process.exitCode=failed?1:0;
