// B33 notices follow the save's result (Ratchet 164, Jazz 57dd5a4e). Store from notice-seed.ts; built server.
//   DB=<sqlite> node tests/evidence/b33/notice-check.mjs <base>
import { chromium } from '@playwright/test'
import { DatabaseSync } from 'node:sqlite'
const [BASE] = process.argv.slice(2), DB = process.env.DB
const b = await chromium.launch(), p = await (await b.newContext({ viewport: { width: 1280, height: 900 } })).newPage()
let failed = 0; const log = (ok, what, d = '') => { if (!ok) failed++; console.log(`${ok ? 'ok  ' : 'FAIL'} 1280: ${what}${d ? ` (${d})` : ''}`) }
const planned = title => { const db = new DatabaseSync(DB, { readOnly: true }); try { return db.prepare("SELECT plannedOn FROM tasks WHERE snapshot='current' AND title=?").get(title)?.plannedOn ?? null } finally { db.close() } }
const exists = title => { const db = new DatabaseSync(DB, { readOnly: true }); try { return Boolean(db.prepare("SELECT 1 FROM tasks WHERE snapshot='current' AND title=?").get(title)) } finally { db.close() } }
const notice = async () => (await p.locator('[data-slot="toast"], [role="alert"], [role="status"]').allInnerTexts()).join(' | ')
const selectRow = async loc => { await p.mouse.move(1, 1); await loc.locator('.editor-task-title').hover(); await p.waitForTimeout(300); await p.locator('.bn-side-menu [aria-label^="Select or drag"]').first().click(); await p.waitForTimeout(300) }
await p.goto(BASE + '/', { waitUntil: 'networkidle' }); await p.waitForTimeout(800)
await selectRow(p.locator('[data-node-type="blockContainer"]', { has: p.locator('.editor-task-title', { hasText: 'Also on Doc' }) }).first())
await p.keyboard.press('Delete'); await p.waitForTimeout(1800)
let text = await notice()
log(text.includes('Removed from today · still in Doc') && !text.includes('To-do deleted') && !text.includes('Not today'), 'a new to-do with a line on another page: "Removed from today · still in Doc"', text)
log(exists('Also on Doc'), 'and the task really stays')
await selectRow(p.locator('[data-node-type="blockContainer"]', { has: p.locator('.editor-task-title', { hasText: 'Twice here' }) }).first())
await p.keyboard.press('Delete'); await p.waitForTimeout(1800)
text = await notice()
log(!/To-do deleted|Not today|Content removed/.test(text.replace(/Removed from today · still in Doc/g, '')) && exists('Twice here'), 'one of two lines on the same page: no notice (Lead 2fd18667)', text)
log(planned('Twice here') !== null, 'and the task stays planned for today (its other line is still here)', planned('Twice here'))
console.log(failed ? `${failed} FAILED` : 'all passed'); await b.close(); process.exit(failed ? 1 : 0)
