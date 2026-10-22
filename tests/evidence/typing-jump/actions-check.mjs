// "Make sure everything stable" (Brian cf4c4e65, Bumblebee ba51b8e2): the other things he does while writing must not
// move rows that are already there. Built server, sign-in off, fresh SQLite:
//   node tests/evidence/typing-jump/actions-check.mjs <width> [touch]
import { chromium } from '@playwright/test'
const width = Number(process.argv[2] ?? 1280), touch = process.argv[3] === 'touch', BASE = 'http://127.0.0.1:3490'
const b = await chromium.launch(); const ctx = await b.newContext({ viewport: { width, height: 900 }, ...(touch ? { hasTouch: true, isMobile: true } : {}) }); const p = await ctx.newPage()
let failed = 0
const log = (ok, what, d = '') => { if (!ok) failed++; console.log(`${ok ? 'ok  ' : 'FAIL'} ${width}${touch ? ' touch' : ''}: ${what}${d ? ` (${d})` : ''}`) }
const tap = async (x, y) => touch ? p.touchscreen.tap(x, y) : p.mouse.click(x, y)
const layout = () => p.evaluate(() => Object.fromEntries([...document.querySelectorAll('.bn-block-outer')].filter(o => o.getClientRects().length).map(o => { const r = o.getBoundingClientRect(); return [o.getAttribute('data-id'), `${r.top.toFixed(1)}+${r.height.toFixed(1)}`] })))
/** Rows that existed before and changed top or height, optionally only those above a given row. */
const moved = (a, z, above) => Object.keys(a).filter(id => z[id] !== undefined && a[id] !== z[id] && (!above || parseFloat(a[id]) < parseFloat(a[above] ?? 'Infinity')))
const caretRow = () => p.evaluate(() => { const n = window.getSelection().anchorNode; const el = n?.nodeType === 3 ? n.parentElement : n; return el?.closest?.('.bn-block-outer')?.getAttribute('data-id') })
async function settle() { await p.waitForTimeout(1800) }

// Day page: the 2nd and 3rd new task in a section, each made by Enter on a written task; rows above never move.
await p.goto(BASE + '/', { waitUntil: 'networkidle' }); await p.waitForTimeout(600)
const h = await p.locator('h1, h2, h3', { hasText: 'TODO - Top 3' }).first().boundingBox(); await tap(h.x + 140, h.y + h.height + 20); await p.waitForTimeout(300)
for (const [i, title] of ['first', 'second', 'third'].entries()) {
  const before = await layout()
  await p.keyboard.type(title); await settle()
  const typed = await layout(); const row = await caretRow()
  log(moved(before, typed).length === 0, `typing task ${i + 1} moves no row`, moved(before, typed).map(id => `${id}: ${before[id]} → ${typed[id]}`).slice(0, 2).join('; '))
  await p.keyboard.press('Enter'); await settle()
  const entered = await layout()
  const above = moved(typed, entered, row).filter(id => id !== row)
  log(above.length === 0 && typed[row] === entered[row], `Enter after task ${i + 1} moves neither it nor any row above`, above.concat(typed[row] !== entered[row] ? [row] : []).slice(0, 2).join('; '))
}
// Tick and untick a written task: no row moves.
const before = await layout()
const cb = p.locator('[data-content-type="task"] input[type=checkbox]').first(); const cbb = await cb.boundingBox()
await tap(cbb.x + cbb.width / 2, cbb.y + cbb.height / 2); await settle()
const ticked = await layout()
log(moved(before, ticked).length === 0, 'ticking a task moves no row', moved(before, ticked).slice(0, 2).map(id => `${id}: ${before[id]} → ${ticked[id]}`).join('; '))
await tap(cbb.x + cbb.width / 2, cbb.y + cbb.height / 2); await settle()
const unticked = await layout()
log(moved(before, unticked).length === 0, 'unticking it moves no row', moved(before, unticked).slice(0, 2).map(id => `${id}: ${before[id]} → ${unticked[id]}`).join('; '))

// A document page: a written line, then a task made with the slash menu, typed into: no row moves.
await p.goto(BASE + '/pages', { waitUntil: 'networkidle' }); await p.waitForTimeout(500)
await p.getByRole('button', { name: 'New page' }).first().click(); await p.waitForTimeout(1200)
await p.keyboard.type('Doc title'); await p.keyboard.press('Enter'); await p.waitForTimeout(400)
await p.keyboard.type('a line'); await p.keyboard.press('Enter'); await settle()
await p.keyboard.type('/task'); await p.waitForTimeout(500); await p.keyboard.press('Enter'); await settle()
const docBefore = await layout()
await p.keyboard.type('doc task'); await settle()
const docTyped = await layout()
log(moved(docBefore, docTyped).length === 0, 'document page: typing into a new task moves no row', moved(docBefore, docTyped).slice(0, 2).map(id => `${id}: ${docBefore[id]} → ${docTyped[id]}`).join('; '))
await p.keyboard.press('Enter'); await settle(); const docRowBefore = await layout()
await p.keyboard.type('next'); await settle()
log(moved(docRowBefore, await layout()).length === 0, 'document page: typing the second task moves no row')
await b.close()
console.log(failed ? `${failed} FAILED` : 'all passed'); process.exit(failed ? 1 : 0)
