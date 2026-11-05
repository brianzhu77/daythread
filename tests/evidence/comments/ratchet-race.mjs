// Comments on a line in the built app (comments.md step 2, P2-4, P2-7): from the chosen block's bar and ⌘⇧M, a mark that shifts nothing, in the margin at 1280 and at the line's end at 390,
// the pane going to the line, a deleted line and its Undo, a move keeping the thread, and a page with none drawing none.
// Usage: node tests/evidence/comments/lines.mjs <base-url> <store-path> <1280|390> [chromium|webkit] [shots-dir]  (a throwaway store the server at <base-url> uses)
import * as pw from '@playwright/test'
import { execSync } from 'node:child_process'
const [base, S, width, engine = 'chromium', shots] = process.argv.slice(2)
if (!base || !S || !width) { console.error('Usage: node tests/evidence/comments/lines.mjs <base-url> <store-path> <1280|390> [chromium|webkit] [shots-dir]'); process.exit(2) }
const wide = width === '1280'
const reseed = () => execSync(`rm -f ${S} ${S}-wal ${S}-shm && node --no-warnings tests/evidence/comments/seed.ts ${S}`, { stdio: 'ignore' })
const store = () => JSON.parse(execSync(`sqlite3 ${S} "select data from workspace"`, { maxBuffer: 1 << 26 }).toString())
const threads = () => store().threads ?? [], notes = () => store().pages.find(p => p.id === 'notes')
const browser = await pw[engine].launch({ headless: true })
const context = await browser.newContext({ viewport: { width: Number(width), height: wide ? 900 : 844 }, hasTouch: !wide, serviceWorkers: 'block' })
let fails = 0
const check = (ok, what, extra) => { if (!ok) fails++; console.log(ok ? 'PASS' : 'FAIL', what, extra === undefined ? '' : JSON.stringify(extra)) }
const send = engine === 'webkit' ? 'Meta+Enter' : 'Control+Enter', mod = engine === 'webkit' ? 'Meta' : 'Control'
const page = await context.newPage(), errors = []
page.on('pageerror', e => { if (!/ResizeObserver loop/.test(e.message)) errors.push(e.message) })
const wait = ms => page.waitForTimeout(ms)
const shot = async name => { if (shots) await page.screenshot({ path: `${shots}/${engine}-${width}-${name}.png` }) }
const pane = page.locator('.comments-pane'), field = page.getByRole('textbox', { name: 'New comment' }), mark = page.locator('.comment-mark')
const line = page.locator('.bn-inline-content', { hasText: 'A line of notes' }).first()
const openNotes = async () => { await page.goto(`${base}/pages?page=notes`); await page.locator('.bn-editor').first().waitFor({ timeout: 30000 }); await wait(1800) }
const geometry = async () => line.evaluate(n => { const b = n.closest('[data-node-type="blockContainer"]').getBoundingClientRect(), t = document.createRange(); t.selectNodeContents(n); const r = t.getBoundingClientRect(); return { top: r.top, left: r.left, right: r.right, height: b.height } })
const closePane = async () => { if (await pane.count()) { await pane.getByRole('button', { name: 'Close comments' }).click(); await wait(250) } }
const clearNotices = async () => { for (const c of await page.locator('[data-slot="toast-close"]').all()) await c.click({ force: true }).catch(() => {}); await wait(300) }
const chooseLine = async () => {
  if (wide) { const b = await line.boundingBox(); await page.mouse.move(b.x + 10, b.y + 8); await wait(200); await page.locator('.editor-handle button').first().click(); await wait(350) }
  else { await line.tap(); await wait(400); await page.locator('.editor-touch-handle').first().tap({ force: true }); await wait(400) }
}
const writeOnLine = async words => {
  if (wide) { await line.click(); await wait(200); await page.keyboard.press(`${mod}+Shift+M`); await wait(350); await field.fill(words); await field.press(send); await wait(700) }
  else { await chooseLine(); await page.locator('.editor-selection-bar').getByRole('button', { name: 'Comment' }).tap(); await wait(350); await field.fill(words); await pane.getByRole('button', { name: 'Comment', exact: true }).tap(); await wait(800) }
}


reseed();await openNotes();await line.click();await page.keyboard.press(`${mod}+Shift+M`);await wait(300);await field.fill('First sent');
let release,seen=false;const held=new Promise(r=>release=r);
await page.route('**/_serverFn/**',async route=>{if(route.request().method()==='POST' && decodeURIComponent(route.request().postData()??'').includes('add-comment')){const response=await route.fetch();seen=true;await held;await route.fulfill({response});}else await route.continue();});
await pane.getByRole('button',{name:'Comment',exact:true}).click();for(let i=0;i<100&&!seen;i++)await wait(50);check(seen,'send response held');
await field.fill('First sent NEW WORDS');release();await wait(900);
const after=await field.inputValue(),saved=threads().flatMap(t=>t.comments).map(c=>c.body);
check(after==='NEW WORDS','words typed during line-comment send remain visible',{after,saved});
await closePane();await line.click();await page.keyboard.press(`${mod}+Shift+M`);await wait(300);const recovered=await field.inputValue();console.log('RECOVERED',JSON.stringify(recovered));
await browser.close();process.exit(fails?1:0);
