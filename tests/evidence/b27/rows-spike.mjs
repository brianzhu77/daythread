// B27 rows spike (plan §4, Jazz b27-at-date-states §4): the day's events drawn under its Events heading as one
// widget, never part of the document. Checks what would send it to the header fallback, and takes the screenshots
// Jazz chooses from. Built server on a store made by seed.ts (fresh copy per run; it types and saves):
//   node tests/evidence/b27/rows-spike.mjs <base> <out dir> [webkit|chromium]
import * as pw from '@playwright/test'
const [base, out, engine = 'webkit'] = process.argv.slice(2)
if (!base || !out || new URL(base).hostname !== '127.0.0.1' || new URL(base).port === '3000') throw Error('Use a disposable loopback server')
const today = new Date().toLocaleDateString('en-CA', { timeZone: 'America/Vancouver' })
const KEYBOARD = 336
let failed = 0
const log = (ok, what, detail = '') => { if (!ok) failed++; console.log(`${ok ? 'ok  ' : 'FAIL'} ${engine}: ${what}${detail ? ` (${detail})` : ''}`) }
const browser = await pw[engine].launch()

/** Where the rows, the Events heading, its next line and a Notes bullet's text are, and what the DOM holds. */
const layout = p => p.evaluate(() => {
  const host = document.querySelector('.event-rows'), rect = e => e && e.getBoundingClientRect()
  const heading = [...document.querySelectorAll('.bn-editor [data-node-type="blockContainer"]')].find(b => b.querySelector('h2')?.textContent?.trim() === 'Events')
  const titles = [...document.querySelectorAll('.day-event-title')]
  const bullet = [...document.querySelectorAll('.bn-editor [data-content-type="bulletListItem"] .bn-inline-content')].find(e => e.textContent?.trim())
  const textX = el => { const r = document.createRange(); r.selectNodeContents(el); return r.getClientRects()[0]?.left }
  return {
    widgets: document.querySelectorAll('.event-rows').length,
    rows: titles.map(t => t.textContent),
    inside: Boolean(host?.closest('.bn-editor')),
    afterHeading: Boolean(heading && heading.closest('.bn-block-outer')?.nextElementSibling === host),
    rowsInBlocks: [...document.querySelectorAll('.bn-block-outer .day-event')].length,
    rowTop: rect(host)?.top, rowBottom: rect(host)?.bottom,
    headingBottom: rect(heading?.querySelector('.bn-block-content'))?.bottom,
    nextTop: rect(host?.nextElementSibling?.querySelector('.bn-block-content'))?.top,
    timeX: rect(document.querySelector('.day-event-time'))?.left,
    bulletTextX: bullet ? textX(bullet) : null,
    caretBlock: getSelection()?.anchorNode?.parentElement?.closest('[data-node-type="blockContainer"]')?.getAttribute('data-id') ?? null,
    headingId: heading?.getAttribute('data-id'),
  }
})

async function desktop() {
  const p = await browser.newPage({ viewport: { width: 1280, height: 900 } })
  const errors = []; p.on('pageerror', e => errors.push(e.message))
  // Record what a copy puts on the clipboard (the app's own copy handler writes text/plain).
  await p.addInitScript(() => { const set = DataTransfer.prototype.setData; window.__copied = []; DataTransfer.prototype.setData = function (t, v) { window.__copied.push([t, v]); return set.call(this, t, v) } })
  await p.goto(`${base}/day/${today}`, { waitUntil: 'networkidle' }); await p.waitForTimeout(1200)
  const later = p.getByRole('button', { name: 'Later', exact: true }); if (await later.count()) await later.click()
  let g = await layout(p)
  log(g.widgets === 1 && g.inside && g.afterHeading, 'one widget, inside the editor, right after the Events heading', JSON.stringify({ widgets: g.widgets, inside: g.inside, afterHeading: g.afterHeading }))
  log(JSON.stringify(g.rows) === JSON.stringify(['Bake sale at school', 'Call the plumber', 'Dentist']), 'rows: all-day first, then by time; the chip in this page\'s Notes shows too', JSON.stringify(g.rows))
  log(g.rowsInBlocks === 0, 'no row inside any block')
  log(g.bulletTextX !== null && Math.abs(g.timeX - g.bulletTextX) <= 1, 'the row starts at the bullet text column', `time x ${g.timeX}, bullet text x ${g.bulletTextX}`)
  const events = p.locator('.bn-editor h2', { hasText: /^Events$/ })
  await events.scrollIntoViewIfNeeded()
  await p.screenshot({ path: `${out}/rows-1280.png`, clip: { x: 300, y: Math.max(0, g.headingBottom - 120), width: 680, height: 320 } })
  // Hover the rows: the side menu must not offer a handle for them (they aren't blocks).
  const row = p.locator('.day-event').first()
  await row.hover(); await p.waitForTimeout(300)
  const handleAt = await p.evaluate(() => { const h = document.querySelector('.bn-side-menu'); const r = h?.getBoundingClientRect(); const row = document.querySelector('.day-event').getBoundingClientRect(); return r && r.height ? { top: r.top, rowTop: row.top, rowBottom: row.bottom } : null })
  log(!handleAt || handleAt.top + 1 < handleAt.rowTop || handleAt.top > handleAt.rowBottom - 1, 'hovering a row shows no handle on it', JSON.stringify(handleAt))
  await p.screenshot({ path: `${out}/rows-1280-hover.png`, clip: { x: 300, y: Math.max(0, g.headingBottom - 120), width: 680, height: 320 } })
  // Caret: end of the Events heading, ↓ goes to the line after the rows, ↑ comes back.
  await events.click(); await p.keyboard.press('End')
  await p.keyboard.press('ArrowDown'); await p.waitForTimeout(100)
  const down = await layout(p)
  const nextId = await p.evaluate(() => document.querySelector('.event-rows')?.nextElementSibling?.getAttribute('data-id'))
  log(down.caretBlock === nextId, '↓ from the heading lands on the line after the rows', `${down.caretBlock} vs ${nextId}`)
  await p.keyboard.press('ArrowUp'); await p.waitForTimeout(100)
  log((await layout(p)).caretBlock === g.headingId, '↑ comes back to the heading')
  // Type on the line after the rows, then select all and copy: the rows are not in the copy.
  await p.keyboard.press('ArrowDown'); await p.keyboard.type('Swim class'); await p.waitForTimeout(1500)
  g = await layout(p)
  log(g.widgets === 1 && g.afterHeading, 'after typing, still one widget after the heading')
  await p.keyboard.press('Meta+A'); await p.keyboard.press('Meta+A'); await p.keyboard.press('Meta+C'); await p.waitForTimeout(200)
  const copied = await p.evaluate(() => window.__copied.filter(([t]) => t === 'text/plain').map(([, v]) => v).join('\n'))
  log(copied.includes('Swim class') && !copied.includes('All day') && !copied.includes('Bake sale at school'), 'select all + copy: his lines, not the rows', JSON.stringify(copied.slice(0, 120)))
  await events.click(); await p.keyboard.press('End')
  await p.keyboard.press('Meta+Z'); await p.waitForTimeout(1500)
  g = await layout(p)
  log(g.widgets === 1 && g.afterHeading && g.rows.length === 3, 'after ⌘Z, still one widget with all rows')
  log(!errors.length, 'no page errors', errors.join(' | '))
  await p.close()
}

async function phone() {
  const p = await browser.newPage({ viewport: { width: 390, height: 844 }, hasTouch: true })
  const errors = []; p.on('pageerror', e => errors.push(e.message))
  await p.addInitScript(keyboard => {
    const vv = window.visualViewport
    let up = 0
    Object.defineProperty(vv, 'height', { configurable: true, get: () => window.innerHeight - up })
    const fire = () => vv.dispatchEvent(new Event('resize'))
    const typing = () => Boolean(document.activeElement?.closest('[contenteditable="true"], input, textarea'))
    document.addEventListener('focusin', () => setTimeout(() => { if (typing() && !up) { up = keyboard; fire() } }, 60))
    document.addEventListener('focusout', () => setTimeout(() => { if (!typing() && up) { up = 0; fire() } }, 60))
  }, KEYBOARD)
  await p.goto(`${base}/day/${today}`, { waitUntil: 'networkidle' }); await p.waitForTimeout(1200)
  const later = p.getByRole('button', { name: 'Later', exact: true }); if (await later.count()) await later.tap()
  let g = await layout(p)
  log(g.widgets === 1 && g.afterHeading && Math.abs(g.timeX - g.bulletTextX) <= 1, '390: rows after the heading, at the bullet text column', `time x ${g.timeX}, bullet text x ${g.bulletTextX}`)
  const events = p.locator('.bn-editor h2', { hasText: /^Events$/ })
  await events.scrollIntoViewIfNeeded()
  await p.screenshot({ path: `${out}/rows-390.png` })
  // Caret on the line just above the rows (the Events heading), keyboard up.
  await events.tap(); await p.waitForTimeout(600)
  g = await layout(p)
  const bar = await p.evaluate(() => { const b = document.querySelector('.editor-phone-toolbar')?.getBoundingClientRect(); return b ? { top: b.top, bottom: b.bottom } : null })
  const handle = await p.evaluate(() => { const h = document.querySelector('.editor-touch-handle')?.getBoundingClientRect(); const head = [...document.querySelectorAll('.bn-editor h2')].find(e => e.textContent?.trim() === 'Events')?.getBoundingClientRect(); return h && head ? { handle: h.top + h.height / 2, line: head.top + head.height / 2 } : null })
  log(g.caretBlock === g.headingId, '390 keyboard up: the caret is on the Events heading')
  log(bar && g.headingBottom <= bar.top - 8, '390 keyboard up: the caret\'s line is clear of the toolbar', JSON.stringify({ headingBottom: g.headingBottom, bar }))
  log(handle && Math.abs(handle.handle - handle.line) <= 12, '390 keyboard up: the touch handle sits on the caret\'s line', JSON.stringify(handle))
  log(!(await p.evaluate(() => { const t = document.querySelector('nav.tab-bar'); return t && getComputedStyle(t).display !== 'none' && t.getBoundingClientRect().height > 0 })), '390 keyboard up: the tab bar is hidden')
  await p.screenshot({ path: `${out}/rows-390-keyboard.png` })
  // ↓ from the heading skips the rows to the next line.
  await p.keyboard.press('ArrowDown'); await p.waitForTimeout(100)
  const nextId = await p.evaluate(() => document.querySelector('.event-rows')?.nextElementSibling?.getAttribute('data-id'))
  log((await layout(p)).caretBlock === nextId, '390: ↓ from the heading lands on the line after the rows')
  log(!errors.length, '390: no page errors', errors.join(' | '))
  await p.close()
}

await desktop()
await phone()
await browser.close()
console.log(failed ? `${failed} FAILED` : 'all passed')
process.exit(failed ? 1 : 0)
