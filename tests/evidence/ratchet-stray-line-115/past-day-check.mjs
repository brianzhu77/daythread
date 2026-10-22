// Past day with hidden empty rows (B19), for row-arrows.ts (Ratchet #115). Fixture: run past-day-fixture.mjs on a fresh
// SQLite (it writes "past task" on today's page, so the template rows exist), stop the server, then move that page into
// the past: sqlite3 w.sqlite "update pages set date='2026-10-20' where snapshot='current' and type='daily'". Serve it again.
import { chromium } from '@playwright/test'
const BASE = 'http://127.0.0.1:3425', DAY = process.argv[2] ?? '2026-10-20'
const b = await chromium.launch(); const p = await b.newPage({ viewport: { width: 1280, height: 900 } })
let failed = 0
const log = (ok, what, d = '') => { if (!ok) failed++; console.log(`${ok ? 'ok  ' : 'FAIL'} ${what}${d ? ` (${d})` : ''}`) }
const at = () => p.evaluate(() => { const s = window.getSelection(); const n = s.anchorNode; const el = n?.nodeType === 3 ? n.parentElement : n
  const block = el?.closest('[data-content-type]'); return { text: block?.querySelector('.bn-inline-content')?.textContent ?? block?.textContent ?? '', type: block?.getAttribute('data-content-type') } })
// Seeded through the app's commands (seed.ts): Oct 20 with one written Top 3 task beside its empty template rows.
await p.goto(`${BASE}/day/${DAY}`, { waitUntil: 'networkidle' }); await p.waitForTimeout(600)
const hidden = await p.evaluate(() => [...document.querySelectorAll('.bn-block-outer')].filter(e => e.getClientRects().length === 0).length)
log(hidden > 0, 'past day: unused empty rows are hidden after reopening', `${hidden} hidden`)
const hiddenIds = () => p.evaluate(() => [...document.querySelectorAll('.bn-block-outer')].filter(e => e.getClientRects().length === 0).map(e => e.getAttribute('data-id')))
const before = await hiddenIds()
// ↑ from the "Events" heading: the block just above is Other's hidden empty row; the caret passes over it to the heading.
const ev = await p.locator('h1, h2, h3', { hasText: 'Events' }).first().boundingBox()
await p.mouse.click(ev.x + 5, ev.y + ev.height / 2); await p.waitForTimeout(250)
await p.keyboard.press('ArrowUp'); await p.waitForTimeout(300)
let s = await at()
log(s.type === 'heading' && s.text === 'TODO - Other', '↑ from "Events" passes over the hidden empty row to "TODO - Other"', `${s.type} "${s.text}"`)
// On a heading its section's hidden rows show (6b2591a), and ↓ goes into them.
await p.keyboard.press('ArrowDown'); await p.waitForTimeout(300); s = await at()
log(s.type === 'task' && s.text === '', 'from "TODO - Other", ↓ enters its revealed empty row', `${s.type} "${s.text}"`)
// ↓ from a written task whose next row is hidden passes over it: write a task in Other, reopen, ↓ from it.
await p.keyboard.type('other task'); await p.waitForTimeout(2500)
await p.reload({ waitUntil: 'networkidle' }); await p.waitForTimeout(600)
const ot = await p.locator('.bn-inline-content', { hasText: 'other task' }).boundingBox()
await p.mouse.click(ot.x + ot.width - 1, ot.y + ot.height / 2); await p.waitForTimeout(250)
await p.keyboard.press('ArrowDown'); await p.waitForTimeout(300); s = await at()
log(s.type === 'heading' && s.text === 'Events', '↓ from a written task passes over hidden rows to the next heading', `${s.type} "${s.text}"`)
await b.close()
console.log(failed ? `${failed} FAILED` : 'all passed'); process.exit(failed ? 1 : 0)
