// Delete/Backspace at a role section's edge (Brian's Delete bug, Lead). Run against a built server with sign-in off on
// a fresh SQLite: node tests/evidence/delete-section-end/edges-check.mjs <sqlite path> [width]
import { chromium } from '@playwright/test'
import { DatabaseSync } from 'node:sqlite'
const DB = process.argv[2], width = Number(process.argv[3] ?? 1280)
const b = await chromium.launch(); const p = await b.newPage({ viewport: { width, height: 900 } })
let failed = 0
const log = (ok, what, d = '') => { if (!ok) failed++; console.log(`${ok ? 'ok  ' : 'FAIL'} ${width}: ${what}${d ? ` (${d})` : ''}`) }
const rows = () => p.evaluate(() => [...document.querySelectorAll('[data-content-type]')].map(e => `${e.getAttribute('data-content-type')}:${e.querySelector('.bn-inline-content, h1, h2, h3')?.textContent ?? e.textContent}`).slice(0, 9).join(' | '))
const kinds = () => { const db = new DatabaseSync(DB); const r = db.prepare("select sections from pages where snapshot='current' and type='daily'").get(); db.close(); return JSON.parse(String(r?.sections ?? '[]')).map(s => s.kind).join(',') }
const ALL = 'top3,other,events,good-stuffs,notes'
const fresh = async () => { await p.goto((process.env.REVIEW_URL??'http://127.0.0.1:3426')+'/', { waitUntil: 'networkidle' }); await p.waitForTimeout(500) }
const typeIn = async (heading, text) => { const h = await p.locator('h1, h2, h3', { hasText: heading }).first().boundingBox(); await p.mouse.click(h.x + 120, h.y + h.height + 20); await p.keyboard.type(text); await p.waitForTimeout(2200) }
await fresh(); await typeIn('TODO - Top 3', 'only task')
const before = await rows()
await p.keyboard.press('Delete'); await p.waitForTimeout(2200)
log(await rows() === before && kinds() === ALL, 'Delete at the end of the last Top 3 task does nothing; every role kept', kinds())
const oh = await p.locator('h1, h2, h3', { hasText: 'TODO - Other' }).first().boundingBox(); await p.mouse.click(oh.x + 2, oh.y + oh.height / 2); await p.keyboard.press('Meta+ArrowLeft')
await p.keyboard.press('Backspace'); await p.waitForTimeout(2200)
log(await rows() === before && kinds() === ALL, 'Backspace at the start of "TODO - Other" does nothing', kinds())
await fresh(); await typeIn('Events', 'an event'); const evRows = await rows()
await p.keyboard.press('Delete'); await p.waitForTimeout(2200)
log(await rows() === evRows && kinds() === ALL, 'Delete at the end of a bullet before "Good Stuffs" does nothing', kinds())
// A selection across a heading is his choice: it deletes, and ⌘Z brings the heading back with its role.
await fresh(); await typeIn('TODO - Top 3', 'span ')
const tt = await p.locator('.bn-inline-content', { hasText: 'span' }).first().boundingBox(); await p.mouse.click(tt.x + 20, tt.y + tt.height / 2)
await p.keyboard.down('Shift'); await p.keyboard.press('ArrowDown'); await p.keyboard.press('ArrowDown'); await p.keyboard.up('Shift')
await p.keyboard.press('Delete'); await p.waitForTimeout(2200)
log(!kinds().includes('other'), 'a selection across "TODO - Other" deletes it', kinds())
await p.keyboard.press('Meta+z'); await p.waitForTimeout(2500)
log(kinds() === ALL, '⌘Z brings it back as the Other section, not custom', kinds())
await p.reload({ waitUntil: 'networkidle' }); await p.waitForTimeout(500)
log(kinds() === ALL && (await rows()).includes('heading:TODO - Other'), 'still Other after a reload', kinds())
await b.close()
console.log(failed ? `${failed} FAILED` : 'all passed'); process.exit(failed ? 1 : 0)
