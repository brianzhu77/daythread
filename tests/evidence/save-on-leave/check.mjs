// Save on leave (Lead d3c6ac0e-era decision, Ratchet, Bumblebee): an editor closed by in-app navigation saves what's
// unsaved. Fresh synthetic seed.ts store; every switch is a sidebar click (no reload), made straight after the edit.
//   node check.mjs <base url> <db copy> <playwright index.mjs>
import { DatabaseSync } from 'node:sqlite'
const [base, dbPath, pw] = process.argv.slice(2)
const { chromium } = await import(pw ?? '@playwright/test')
const TODAY = new Date().toLocaleDateString('en-CA', { timeZone: 'America/Vancouver' })
const ago = n => new Date(Date.parse(TODAY + 'T12:00:00Z') - n * 86400000).toISOString().slice(0, 10)
const SOURCE = ago(3), MIDDLE = ago(2), NEXT = ago(1)
if (!base || !['127.0.0.1', 'localhost'].includes(new URL(base).hostname) || new URL(base).port === '3000' || !dbPath?.startsWith('/tmp/ratchet-save-leave-')) throw Error('Use a disposable loopback server and freshly seeded /tmp/ratchet-save-leave-* store')
let failures = 0
const log = (ok, name, detail = '') => { console.log(`${ok ? 'ok  ' : 'FAIL'} ${name}${detail ? ` · ${detail}` : ''}`); if (!ok) failures++ }
const days = needle => { const d = new DatabaseSync(dbPath, { readOnly: true }); try { return d.prepare("SELECT date, editorJSON FROM pages WHERE snapshot='current' AND type='daily'").all().filter(r => (r.editorJSON ?? '').includes(needle)).map(r => r.date) } finally { d.close() } }
const browser = await chromium.launch(), errors = []
const ctx = await browser.newContext({ viewport: { width: 1280, height: 1000 }, permissions: ['clipboard-read', 'clipboard-write'] })
const tab = async (date = SOURCE) => { const p = await ctx.newPage(); p.on('pageerror', e => errors.push(e.message)); await p.goto(`${base}/day/${date}`, { waitUntil: 'networkidle' }); await p.waitForTimeout(1000); return p }
const go = async (p, date) => { await p.locator(`nav a[href="/day/${date}"], aside a[href="/day/${date}"], a[href="/day/${date}"]`).first().click(); await p.waitForTimeout(150) }
const line = (p, text) => p.locator('.continuous-editor .bn-inline-content').filter({ hasText: text }).first()
const typeAtEnd = async (p, text, add) => { await line(p, text).click(); await p.keyboard.press('Meta+ArrowRight'); await p.keyboard.type(add) }
const saveLine = p => p.locator('.editor-save-line').innerText()
const settle = ms => new Promise(r => setTimeout(r, ms))

// 1. Cut a line, switch at once, paste: the line is only on today, also after reloads; source day opens clean.
let p = await tab()
await line(p, '奥德赛').hover(); await p.waitForTimeout(200); await p.locator('.bn-side-menu [aria-label^="Select or drag"]').first().click(); await p.waitForTimeout(150)
await p.keyboard.press('Meta+X'); await go(p, TODAY); await p.waitForTimeout(1200)
await p.locator('.continuous-editor .bn-block-outer').last().locator('.bn-inline-content').first().click(); await p.keyboard.press('Meta+V'); await settle(2000)
log(JSON.stringify(days('奥德赛')) === JSON.stringify([TODAY]), '1. cut + switch at once + paste: the line is only on today', JSON.stringify(days('奥德赛')))
await p.reload({ waitUntil: 'networkidle' }); await settle(1000); await go(p, SOURCE); await p.waitForTimeout(1500)
log(!(await p.locator('.continuous-editor').innerText()).includes('奥德赛') && !/Recovered|draft kept/.test(await saveLine(p)), '1. source day opens without the line and without a recovered draft', JSON.stringify(await saveLine(p)))
log(JSON.stringify(days('奥德赛')) === JSON.stringify([TODAY]), '1. still only on today after reopening source day')
await p.close()

// 2. Typing, then switch at once: saved.
p = await tab()
await typeAtEnd(p, 'DRIVE Basketball', ' [T2]'); await go(p, TODAY); await settle(2000)
log(days('[T2]').includes(SOURCE), '2. typing then switching at once is saved', JSON.stringify(days('[T2]')))
await p.close()

// 3. Quick switching across pages, an edit on each: all saved.
p = await tab()
await typeAtEnd(p, 'DRIVE Basketball', ' [Q18]'); await go(p, MIDDLE); await p.waitForTimeout(900)
await p.locator('.continuous-editor .bn-inline-content').filter({ hasText: /\S/ }).first().click(); await p.keyboard.press('Meta+ArrowRight'); await p.keyboard.type(' [Q19]')
await go(p, NEXT); await p.waitForTimeout(400); await go(p, TODAY); await settle(2500)
log(days('[Q18]').includes(SOURCE) && days('[Q19]').includes(MIDDLE), '3. quick switching: both edits saved', `Q18 ${JSON.stringify(days('[Q18]'))} Q19 ${JSON.stringify(days('[Q19]'))}`)
await p.close()

// 4. Conflict: B is stale on source day (A saved meanwhile); B types and leaves at once. Refused, never dropped.
const A = await tab(), B = await tab()
await A.bringToFront(); await typeAtEnd(A, 'DRIVE Basketball', ' [A4]'); await settle(1500)
await B.bringToFront(); await typeAtEnd(B, 'English Lesson', ' [B4]'); await go(B, TODAY); await settle(2000)
log(days('[A4]').includes(SOURCE) && !days('[B4]').length, '4. the stale leave-save is refused; A\'s edit stays', `A4 ${JSON.stringify(days('[A4]'))} B4 ${JSON.stringify(days('[B4]'))}`)
await go(B, SOURCE); await B.waitForTimeout(1500)
const s4 = await saveLine(B)
log(/Changed (in another tab|on another device)/.test(s4) && /Load latest/.test(s4) && (await B.locator('.continuous-editor').innerText()).includes('[B4]'), '4. back on source day, B\'s text is there with Load latest', JSON.stringify(s4))
await B.getByRole('button', { name: 'Load latest' }).click(); await settle(2000)
log(days('[A4]').includes(SOURCE) && days('[B4]').includes(SOURCE), '4. Load latest keeps both')
await A.close(); await B.close()

// 5. Network failure on leave: stays stashed; on return (page unchanged) it saves by itself (Bumblebee).
p = await tab()
await p.route('**/_serverFn/**', r => r.request().method() === 'POST' ? r.abort() : r.continue())
await typeAtEnd(p, 'DRIVE Basketball', ' [N5]'); await go(p, TODAY); await settle(1500)
log(!days('[N5]').length, '5. offline: not saved')
await p.unroute('**/_serverFn/**')
await go(p, SOURCE); await settle(2000)
log(days('[N5]').includes(SOURCE) && !/Recovered|draft kept/.test(await saveLine(p)), '5. back online and back on the page: the stashed draft saves by itself', JSON.stringify(await saveLine(p)))
await p.close()

// 6. A draft stuck from before this fix (stash whose start is the page as it is now) saves on opening.
const d6 = new DatabaseSync(dbPath, { readOnly: true }); const row = d6.prepare("SELECT id, sections, editorJSON FROM pages WHERE snapshot='current' AND type='daily' AND date=?").get(MIDDLE); d6.close()
const key6 = JSON.stringify([JSON.parse(row.sections), row.editorJSON]), doc6 = JSON.parse(row.editorJSON)
const first = (function find(ns) { for (const n of ns) { if (Array.isArray(n.content) && n.content.some(c => c.text?.trim())) return n; const c = find(n.children ?? []); if (c) return c } })(doc6)
first.content = [...first.content, { type: 'text', text: ' [S6]', styles: {} }]
const c6 = await browser.newContext({ viewport: { width: 1280, height: 1000 } })
await c6.addInitScript(([k, base, document]) => { if (!sessionStorage.getItem('seeded')) { localStorage.setItem(k, JSON.stringify({ base, document })); sessionStorage.setItem('seeded', '1') } }, [`daythread:editor:${row.id}`, key6, JSON.stringify(doc6)])
p = await c6.newPage(); await p.goto(`${base}/day/${MIDDLE}`, { waitUntil: 'networkidle' }); await settle(2000)
log(days('[S6]').includes(MIDDLE) && !/Recovered|draft kept/.test(await saveLine(p)), '6. a stuck draft from the unchanged page saves on opening', JSON.stringify(await saveLine(p)))
await c6.close()
log(errors.length === 0, 'no page errors', errors.slice(0, 3).join(' / '))
await browser.close()
console.log(failures ? `${failures} failed` : 'all passed')

process.exitCode = failures ? 1 : 0
