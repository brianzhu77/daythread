// Today's behaviour (main): cut a line on Oct 18, switch page straight away inside the app, paste on today, reload.
//   node cut-switch.mjs <base url> <db copy> <playwright index.mjs> [waitMs before switching]
import { DatabaseSync } from 'node:sqlite'
const [base, dbPath, pw, waitArg] = process.argv.slice(2)
const wait = Number(waitArg ?? 0)
const { chromium } = await import(pw)
const TODAY = new Date().toLocaleDateString('en-CA', { timeZone: 'America/Vancouver' })
const count = (needle) => { const d = new DatabaseSync(dbPath, { readOnly: true }); try { return d.prepare("SELECT date, editorJSON FROM pages WHERE snapshot='current' AND type='daily'").all().filter(r => (r.editorJSON ?? '').includes(needle)).map(r => r.date) } finally { d.close() } }
const b = await chromium.launch(), ctx = await b.newContext({ viewport: { width: 1280, height: 1000 }, permissions: ['clipboard-read', 'clipboard-write'] }), p = await ctx.newPage()
await p.goto(`${base}/day/2026-10-18`, { waitUntil: 'networkidle' }); await p.waitForTimeout(1200)
const line = p.locator('.continuous-editor .bn-block-content[data-content-type=bulletListItem] .bn-inline-content').filter({ hasText: '奥德赛' }).first()
const text = '奥德赛'
console.log('before:', JSON.stringify(count(text)))
// select the whole line as a block (handle click) and cut
await line.hover(); await p.waitForTimeout(200)
await p.locator('.bn-side-menu [draggable=true]').first().click(); await p.waitForTimeout(200)
await p.keyboard.press('Meta+X'); await p.waitForTimeout(wait)
// switch page inside the app: the sidebar's Today link (client-side navigation, no reload)
await p.locator('a[href="/day/' + TODAY + '"], a[href="/"]').first().click(); await p.waitForTimeout(1200)
await p.locator('.continuous-editor .bn-block-outer').last().locator('.bn-inline-content').first().click()
await p.keyboard.press('Meta+V'); await p.waitForTimeout(2000)
console.log('after paste, on days:', JSON.stringify(count(text)))
await p.reload({ waitUntil: 'networkidle' }); await p.waitForTimeout(1500)
console.log('after reload, on days:', JSON.stringify(count(text)))
await p.goto(`${base}/day/2026-10-18`, { waitUntil: 'networkidle' }); await p.waitForTimeout(2500)
const shown18 = await p.locator('.continuous-editor').innerText()
console.log('Oct 18 editor shows the line again:', shown18.includes(text), '| status:', JSON.stringify(await p.locator('.editor-save-line').innerText()))
await p.waitForTimeout(2000)
console.log('after reopening Oct 18 (its stashed draft recovered and saved?), on days:', JSON.stringify(count(text)))
await b.close()
