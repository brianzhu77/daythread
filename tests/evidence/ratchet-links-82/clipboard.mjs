// A2 in the built app (vite preview) on a copy of Brian's database: Jazz link-pages-states §6 checks 1–7 plus the
// plan's §7 browser cases (his real Notes bullets, ⌘Z, Undo mid-typing, a save still pending, two devices, Good Stuffs).
// Check 8 (server stopped mid-paste) is server-stop-check.sh.
//   node ui-check.mjs <base url> <db path> <pristine copy> <shots dir> <playwright index.mjs>
import { copyFileSync, rmSync } from 'node:fs'
import { DatabaseSync } from 'node:sqlite'
const [base, dbPath, pristine, out, pw] = process.argv.slice(2)
const { chromium } = await import(pw)
const today = '2026-10-20'
const errors = [], external = []
const log = (ok, name, detail = '') => { console.log(`${ok ? 'ok  ' : 'FAIL'} ${name}${detail ? ` · ${detail}` : ''}`); if (!ok) process.exitCode = 1 }
const reset = () => { for (const f of [dbPath, `${dbPath}-wal`, `${dbPath}-shm`]) rmSync(f, { force: true }); copyFileSync(pristine, dbPath) }
const sql = q => { const d = new DatabaseSync(dbPath, { readOnly: true }); try { return d.prepare(q).all() } finally { d.close() } }
const linkPages = () => sql("SELECT id, title, url, parentId, trashedAt, trashId FROM pages WHERE snapshot='current' AND url IS NOT NULL")
const pageRow = id => sql(`SELECT * FROM pages WHERE snapshot='current' AND id='${id}'`)[0]
const flat = list => list.flatMap(n => [n, ...flat(n.children ?? [])])
const doc = id => JSON.parse(pageRow(id).editorJSON ?? '[]')
const text = c => typeof c === 'string' ? c : Array.isArray(c) ? c.map(x => x.text ?? text(x.content)).join('') : ''
const b = await chromium.launch()
async function open(path = '/', width = 1280, ctx = b) {
  const p = await ctx.newPage({ viewport: { width, height: 900 } })
  p.on('pageerror', e => errors.push(e.message)); p.on('console', m => { if (m.type() === 'error') errors.push(m.text()) })
  p.on('request', r => { if (!r.url().startsWith(base) && !r.url().startsWith('data:')) external.push(r.url()) })
  await p.goto(`${base}${path}`, { waitUntil: 'networkidle' }); await p.waitForTimeout(700)
  return p
}
const paste = (p, t) => p.evaluate(v => { const dt = new DataTransfer(); dt.setData('text/plain', v); document.activeElement.dispatchEvent(new ClipboardEvent('paste', { clipboardData: dt, bubbles: true, cancelable: true })) }, t)
const block = (p, id) => p.locator(`.bn-block-outer[data-id="${id}"]`)
const clickLine = (p, id) => block(p, id).locator('.bn-inline-content').first().click()
const toast = p => p.locator('[role="alert"], [data-slot="toast"]').filter({ hasText: /./ })
const toastText = async p => (await toast(p).allInnerTexts()).join(' | ')
const toastUndo = p => toast(p).getByRole('button', { name: 'Undo' }).first()
const settle = p => p.waitForTimeout(1200)
const cards = async p => p.evaluate(() => [...document.querySelectorAll('.bn-block-outer')].filter(el => el.querySelector('[data-content-type="pageLink"]')).map(el => el.getAttribute('data-id')))
const notes = `day:${today}:notes:template:0`, gs = `day:${today}:good-stuffs:template:0`
const U = 'https://www.xiachufang.com/recipe/10324/'


for(const [name,plain,html] of [['plain control','https://clipboard.example/plain',''],['HTML plus URL plain','https://clipboard.example/html','<a href="https://clipboard.example/html">A recipe title</a>'],['HTML plus title plain','A recipe title','<a href="https://clipboard.example/title">A recipe title</a>']]){reset();const p=await open();await clickLine(p,notes);await p.evaluate(({plain,html})=>{const dt=new DataTransfer();dt.setData('text/plain',plain);if(html)dt.setData('text/html',html);document.activeElement.dispatchEvent(new ClipboardEvent('paste',{clipboardData:dt,bubbles:true,cancelable:true}))},{plain,html});await settle(p);console.log(name,JSON.stringify(linkPages()));await p.close()}
await b.close();
