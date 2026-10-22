// Deleting a line with the keyboard puts the caret at the end of the line above (Brian 301105c0; Bumblebee 297884cd,
// Lead f8592dc0). Built server, sign-in off, fresh SQLite:
//   node tests/evidence/caret-after-delete/check.mjs <base> <width> [touch]          (today + document page)
//   node tests/evidence/caret-after-delete/check.mjs <base> <width> [touch] past     (past-day fixture, below)
//   node tests/evidence/caret-after-delete/check.mjs <base> <width> [touch] cards    (scripts/align-fixtures.ts)
// Past fixture: today's page with "past task", an empty row, then "after", moved to 2026-10-20 (see stray-line).
import { chromium } from '@playwright/test'
import { DatabaseSync } from 'node:sqlite'
// DB=<the server's SQLite path> also checks the task itself in the database after ⌘Z (Bumblebee a484cfac).
const DB = process.env.DB
const [BASE, W, mode1, mode2] = process.argv.slice(2), width = Number(W ?? 1280), touch = [mode1, mode2].includes('touch'), past = [mode1, mode2].includes('past'), cards = [mode1, mode2].includes('cards')
const b = await chromium.launch(); const ctx = await b.newContext({ viewport: { width, height: 900 }, ...(touch ? { hasTouch: true, isMobile: true } : {}) }); const p = await ctx.newPage()
let failed = 0
const log = (ok, what, d = '') => { if (!ok) failed++; console.log(`${ok ? 'ok  ' : 'FAIL'} ${width}${touch ? ' touch' : ''}: ${what}${d ? ` (${d})` : ''}`) }
const tap = async (x, y) => touch ? p.touchscreen.tap(x, y) : p.mouse.click(x, y)
const at = () => p.evaluate(() => { const s = window.getSelection(); const n = s.anchorNode; const el = n?.nodeType === 3 ? n.parentElement : n
  if (el?.closest?.('.page-title-field')) return { type: 'title', text: el.closest('.page-title-field').textContent, off: -1 }
  const block = el?.closest?.('[data-content-type]'), inline = block?.querySelector('.bn-inline-content') ?? block?.querySelector('h1,h2,h3')
  let off = -1; if (inline && n) { const r = document.createRange(); r.selectNodeContents(inline); try { r.setEnd(n, s.anchorOffset); off = r.toString().length } catch {} }
  return { type: block?.getAttribute('data-content-type'), text: (inline?.textContent ?? '').replace('⋯', ''), off } })
const atEndOf = async (text, what) => { const s = await at(); log(s.text === text && s.off === text.length, what, `${s.type} "${s.text}" @${s.off}`) }
const clickEnd = async text => { const bx = await p.locator('.bn-inline-content, h1, h2, h3', { hasText: text }).last().boundingBox(); await tap(bx.x + bx.width - 1, bx.y + bx.height - 4) }
const deleteLine = async n => { for (let i = 0; i <= n; i++) await p.keyboard.press('Backspace'); await p.waitForTimeout(700) }

if (cards) {
  // Fixture: scripts/align-fixtures.ts (three cards under Notes on /day/2026-12-31). An empty to-do right under the link
  // card ("[] " after the selected card), deleted: the caret skips the cards to the nearest text line, "Notes".
  await p.goto(`${BASE}/day/2026-12-31`, { waitUntil: 'networkidle' }); await p.waitForTimeout(800)
  const card = await p.locator('[data-content-type="pageLink"]').last().boundingBox()
  await tap(card.x + card.width - 6, card.y + card.height / 2); await p.waitForTimeout(300); await p.keyboard.press('Enter'); await p.waitForTimeout(400)
  await p.keyboard.type('[] '); await p.waitForTimeout(800)
  const order = await p.evaluate(() => [...document.querySelectorAll('[data-content-type]')].map(e => e.getAttribute('data-content-type')).join(','))
  log(/pageLink,pageLink,pageLink,task/.test(order), 'an empty to-do right under the cards')
  await p.keyboard.type('y'); await p.waitForTimeout(1800); await deleteLine(1)
  await atEndOf('Notes', 'the lines above are cards: the caret goes to the nearest text line above them')
} else if (past) {
  await p.goto(`${BASE}/day/2026-10-20`, { waitUntil: 'networkidle' }); await p.waitForTimeout(600)
  await clickEnd('after'); await deleteLine('after'.length)
  await atEndOf('past task', 'past day: deleting "after" skips the hidden empty row above and lands at the end of "past task"')
} else {
  await p.goto(BASE + '/', { waitUntil: 'networkidle' }); await p.waitForTimeout(500)
  const h = await p.locator('h1, h2, h3', { hasText: 'TODO - Top 3' }).first().boundingBox(); await tap(h.x + 140, h.y + h.height + 20)
  const long = 'a long second line that wraps onto another visual line at phone width so the end is on its last line'
  await p.keyboard.type('first'); await p.keyboard.press('Enter'); await p.keyboard.type(long); await p.keyboard.press('Enter'); await p.keyboard.type('third'); await p.waitForTimeout(1800)
  await deleteLine('third'.length)
  await atEndOf(long, 'a task deleted letter by letter: the caret is at the end of the (wrapping) line above')
  await p.keyboard.type('!'); await p.waitForTimeout(300)
  log((await at()).text === long + '!', 'and typing continues that line')
  await p.keyboard.press('Backspace'); await p.waitForTimeout(1800)
  const tasksBefore = await p.locator('[data-content-type="task"]').count()
  // ⌘Z right after deleting a row brings it back.
  await p.keyboard.press('Enter'); await p.keyboard.type('undo me'); await p.waitForTimeout(1800)
  await p.waitForTimeout(400)
  // Deleting a to-do's row on a day page takes it off the day (its placement is excluded, plannedOn cleared); the task
  // itself stays. ⌘Z must put the same task back on the day.
  const task = () => { if (!DB) return null; const db = new DatabaseSync(DB, { readOnly: true })
    const r = db.prepare("select t.id, t.status, t.plannedOn as planned, p.state from tasks t left join placements p on p.snapshot = 'current' and p.taskId = t.id where t.snapshot = 'current' and t.title = 'undo me'").all(); db.close(); return r }
  const saved = task()
  await deleteLine('undo me'.length); await p.waitForTimeout(2000)
  const gone = task()
  await p.keyboard.press('Meta+z'); await p.waitForTimeout(2500)
  if (DB) {
    const back = task(), on = r => r?.length === 1 && r[0].status === 'open' && r[0].state === 'included' && !!r[0].planned
    log(on(saved) && gone?.[0]?.state === 'excluded' && !gone[0].planned && on(back) && back[0].id === saved[0].id,
      '⌘Z puts the same task back on the day (database: included and planned again)', `before ${JSON.stringify(saved)} · deleted ${JSON.stringify(gone)} · after ⌘Z ${JSON.stringify(back)}`)
  }
  const rows = await p.locator('[data-content-type="task"] .bn-inline-content').allTextContents()
  log(rows.some(t => t.startsWith('undo me') || t.startsWith('undo m')) || rows.length > tasksBefore, '⌘Z brings the deleted row back', rows.join(' | ').slice(0, 120))
  // The line above is a section heading: the only row under "TODO - Other".
  await p.goto(BASE + '/', { waitUntil: 'networkidle' }); await p.waitForTimeout(500)
  const o = await p.locator('h1, h2, h3', { hasText: 'TODO - Other' }).first().boundingBox(); await tap(o.x + 140, o.y + o.height + 20); await p.waitForTimeout(300)
  await p.keyboard.type('x'); await p.waitForTimeout(1800); await deleteLine(1)
  await atEndOf('TODO - Other', 'the line above is a section heading: the caret is at the end of its text')
}
await b.close()
console.log(failed ? `${failed} FAILED` : 'all passed'); process.exit(failed ? 1 : 0)
