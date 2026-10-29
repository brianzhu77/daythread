// B68 layout (Jazz on PR #32): a pending row's state sits on its own line under the title, so the title keeps the
// row's width. scripts/check-alignment.mjs doesn't measure the Tomorrow block, so this measures its rows directly, at
// 390 and 1280, light and dark, with a same-evening row and a carried row on screen. Screenshots go next to this file.
//   check 1: pending titles, saved titles and the input share one text column (within 1 px);
//   check 2: each to-do box is centred on its row's first text line (within 1 px), as the saved rows' boxes are;
//   check 3: the state line starts below the title's last line, and the title is as wide as the row's text column;
//   check 4: Jazz's long title wraps to at most 3 lines at 390 (it was 8 beside the old inline label).
// Throwaway SQLite, sign-in off, fake clock. Never point it at production: it writes.
//   node tests/evidence/tomorrow-lost/layout.mjs http://127.0.0.1:3590
import { chromium, webkit } from '@playwright/test'
import { dirname } from 'node:path'
import { fileURLToPath } from 'node:url'

const base = (process.argv[2] ?? '').replace(/\/$/, '')
if (!/^http:\/\/(127\.0\.0\.1|localhost)(:\d+)?$/.test(base)) { console.error('usage: layout.mjs http://127.0.0.1:<port> (local only: it writes)'); process.exit(2) }
const here = dirname(fileURLToPath(import.meta.url))
let failed = 0
const check = (name, ok, detail) => { if (!ok) failed++; console.log(`${ok ? 'ok  ' : 'FAIL'} ${name}${detail ? ` (${detail})` : ''}`) }
const isAdd = route => route.request().method() === 'POST' && (route.request().postData() ?? '').includes('"add-task"')
const long = 'Call about the roof, and ask whether the gutter guard is covered too'

/** Per row: text left, first-line centre, box centre, title bottom, state top, title width, text column width, title lines. */
const measure = page => page.evaluate(() => {
  const firstLine = el => { const r = document.createRange(); r.setStart(el.firstChild ?? el, 0); r.setEnd(el.firstChild ?? el, 1); return r.getClientRects()[0] }
  const lines = el => { const r = document.createRange(); r.selectNodeContents(el); return new Set([...r.getClientRects()].map(x => Math.round(x.top))).size }
  const rows = [...document.querySelectorAll('.tomorrow-list > .task-row')]
  return rows.map(row => {
    const title = row.querySelector('.task-title'), box = row.querySelector('.tomorrow-box').getBoundingClientRect()
    const state = row.querySelector('.tomorrow-line-state'), column = row.querySelector('.tomorrow-pending-text') ?? title
    const isInput = title.tagName === 'INPUT'
    const first = isInput ? title.getBoundingClientRect() : firstLine(title)
    const t = title.getBoundingClientRect()
    const textLeft = isInput ? t.left + parseFloat(getComputedStyle(title).paddingLeft) : first.left
    const lineMid = isInput ? t.top + t.height / 2 : first.top + first.height / 2
    return {
      kind: row.classList.contains('tomorrow-pending') ? 'pending' : isInput ? 'input' : 'saved',
      text: isInput ? '(input)' : title.textContent.slice(0, 24),
      textLeft, lineMid, boxMid: box.top + box.height / 2,
      titleBottom: isInput ? t.bottom : Math.max(...[...(() => { const r = document.createRange(); r.selectNodeContents(title); return r.getClientRects() })()].map(x => x.bottom)),
      stateTop: state?.getBoundingClientRect().top ?? null,
      titleWidth: t.width, columnWidth: column.getBoundingClientRect().width,
      lines: isInput ? 1 : lines(title),
    }
  })
})

for (const [engine, width] of [[chromium, 1280], [webkit, 390]]) {
  for (const scheme of ['light', 'dark']) {
    const browser = await engine.launch()
    const tag = `${width} ${engine.name()} ${scheme}`, stamp = Date.now().toString(36)
    const context = await browser.newContext({ viewport: { width, height: 1000 }, timezoneId: 'America/Vancouver', colorScheme: scheme, serviceWorkers: 'block' })
    const page = await context.newPage()
    const open = async when => { await page.clock.setSystemTime(when); await page.goto(base + '/', { waitUntil: 'networkidle' }); await page.locator('.tomorrow').waitFor({ timeout: 30000 }) }
    const type = async title => { const i = page.getByRole('textbox', { name: 'Add a to-do for tomorrow' }); await i.fill(title); await i.press('Enter') }
    await page.clock.install({ time: new Date('2026-11-10T21:00:00-08:00') })
    // Nov 10 evening: one saved line, one carried line (left on Retry), then Nov 11: a same-evening line on Retry.
    await open(new Date('2026-11-10T21:00:00-08:00'))
    await type(`Saved ${stamp}`)
    await page.locator('.tomorrow-row', { hasText: `Saved ${stamp}` }).waitFor({ timeout: 15000 })
    await page.route('**/_serverFn/**', route => (isAdd(route) ? route.abort() : route.continue()))
    await type(`${long} ${stamp}`)
    await page.locator('.tomorrow-pending', { hasText: stamp }).getByText('Not added').waitFor({ timeout: 15000 })
    await open(new Date('2026-11-11T21:00:00-08:00'))
    await type(`Saved ${stamp}`.replace('Saved', 'Same evening'))
    await page.locator('.tomorrow-pending', { hasText: 'Same evening' }).getByText('Not added').waitFor({ timeout: 15000 })
    await page.unroute('**/_serverFn/**')
    // A saved row for tomorrow, to compare against (adds work again; the pending rows stay as they are until a retry).
    await type(`Saved row ${stamp}`)
    await page.locator('.tomorrow-row', { hasText: `Saved row ${stamp}` }).waitFor({ timeout: 15000 })
    await page.locator('.tomorrow').scrollIntoViewIfNeeded()
    await page.locator('.tomorrow').screenshot({ path: `${here}/layout-${width}-${scheme}.png` })
    const rows = (await measure(page)).filter(r => r.kind !== 'saved' || r.text.includes(stamp) || r.kind === 'input')
    const pending = rows.filter(r => r.kind === 'pending'), others = rows.filter(r => r.kind !== 'pending')
    const column = others[0].textLeft
    const states = await page.locator('.tomorrow-pending .tomorrow-line-state').allInnerTexts()
    check(`${tag}: both pending rows on screen (same evening and carried)`, pending.length >= 2 && states.some(s => s.startsWith('Not added ·')) && states.some(s => s.startsWith('From last night · Not added to today')), states.join(' | '))
    check(`${tag}: one text column for pending, saved and input`, rows.every(r => Math.abs(r.textLeft - column) <= 1), rows.map(r => `${r.kind} ${r.textLeft.toFixed(1)}`).join(', '))
    check(`${tag}: each box centred on its first text line`, rows.every(r => Math.abs(r.boxMid - r.lineMid) <= 1), rows.map(r => `${r.kind} ${(r.boxMid - r.lineMid).toFixed(1)}`).join(', '))
    check(`${tag}: state under the title, title full width`, pending.every(r => r.stateTop !== null && r.stateTop >= r.titleBottom - 0.5 && Math.abs(r.titleWidth - r.columnWidth) <= 1), pending.map(r => `gap ${(r.stateTop - r.titleBottom).toFixed(1)} w ${r.titleWidth.toFixed(0)}/${r.columnWidth.toFixed(0)}`).join(', '))
    if (width === 390) check(`${tag}: the long title wraps to at most 3 lines`, pending.every(r => r.lines <= 3), pending.map(r => `${r.lines} lines`).join(', '))
    await context.close()
    await browser.close()
  }
}
console.log(failed ? `${failed} failed` : 'all passed')
process.exit(failed ? 1 : 0)
