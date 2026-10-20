// Lead 2f917190 / d5723121: the empty-title task on Brian's Oct 19 is in no task list or count, its row stays on the
// page, and typing a title into that row brings it back. Built app over a copy of Brian's database.
//   node tests/evidence/blank-task-check.mjs <base url> <screenshot dir> <playwright index.mjs>
const [base, out, pw] = process.argv.slice(2)
const { chromium } = await import(pw)
const errors = []; const b = await chromium.launch()
const log = (ok, name, detail = '') => { console.log(`${ok ? 'ok  ' : 'FAIL'} ${name}${detail ? ` · ${detail}` : ''}`); if (!ok) process.exitCode = 1 }
const lines = async (p, re) => (await p.locator('body').innerText()).split('\n').filter(l => re.test(l))
for (const width of [1280, 390]) {
  const p = await b.newPage({ viewport: { width, height: 900 } })
  p.on('pageerror', e => errors.push(e.message)); p.on('console', m => { if (m.type() === 'error') errors.push(m.text()) })
  await p.goto(`${base}/`, { waitUntil: 'networkidle' }); await p.waitForTimeout(1000)
  const reasons = await lines(p, /Unfinished · from|Suggested last night/)
  log(reasons.length === 1, `${width}: the card has one task row, no blank one`, JSON.stringify(reasons))
  // With the card open its Calendar row isn't "other" (Lead 23a43f85); the blank task never counts.
  log((await lines(p, /other open task/)).length === 0, `${width}: no "other open task" line while the card shows the only named task`)
  await p.screenshot({ path: `${out}/${width}-today.png` })
  await p.goto(`${base}/tasks?view=open`, { waitUntil: 'networkidle' }); await p.waitForTimeout(600)
  const rows = await p.locator('.list-screen .task-row').evaluateAll(els => els.map(e => e.innerText.trim().split('\n')[0]))
  log(rows.length === 1 && rows.every(r => r.trim()), `${width}: Tasks › Open lists 1 named task`, JSON.stringify(rows))
  await p.screenshot({ path: `${out}/${width}-tasks-open.png` })
  await p.close()
}
// The page keeps its empty row; typing a title brings the task back to Open and the card.
const p = await b.newPage({ viewport: { width: 1280, height: 900 } })
p.on('pageerror', e => errors.push(e.message))
await p.goto(`${base}/day/2026-10-19`, { waitUntil: 'networkidle' }); await p.waitForTimeout(1000)
const other = p.locator('.bn-block-outer').filter({ has: p.locator('[data-content-type="heading"]', { hasText: 'TODO - Other' }) })
const last = await p.evaluate(() => {
  const blocks = [...document.querySelectorAll('.bn-block-outer')]
  const at = blocks.findIndex(b => b.querySelector('[data-content-type="heading"]')?.textContent === 'TODO - Other')
  const after = blocks.slice(at + 1)
  const end = after.findIndex(b => b.querySelector('[data-content-type="heading"]'))
  const section = end < 0 ? after : after.slice(0, end)
  return section.map(b => ({ type: b.querySelector('[data-content-type]')?.getAttribute('data-content-type'), text: b.innerText.trim(), id: b.getAttribute('data-id') }))
})
log(last.length > 0 && last.at(-1).type === 'task' && last.at(-1).text === '', 'Oct 19 TODO - Other still ends with its empty row', JSON.stringify(last))
await p.screenshot({ path: `${out}/1280-oct19.png` })
const id = last.at(-1).id
await p.locator(`.bn-block-outer[data-id="${id}"] .bn-inline-content`).click()
await p.keyboard.type('call the plumber'); await p.waitForTimeout(2000)
await p.goto(`${base}/tasks?view=open`, { waitUntil: 'networkidle' }); await p.waitForTimeout(600)
const rows = await p.locator('.list-screen .task-row').evaluateAll(els => els.map(e => e.innerText.trim().split('\n')[0]))
log(rows.some(r => r.includes('call the plumber')), 'after typing a title: it shows in Tasks › Open', JSON.stringify(rows))
await p.goto(`${base}/`, { waitUntil: 'networkidle' }); await p.waitForTimeout(1000)
log((await p.locator('body').innerText()).includes('call the plumber'), 'after typing a title: it shows on the morning card')
await p.screenshot({ path: `${out}/1280-today-after-typing.png` })
await b.close()
log(errors.length === 0, 'no page or console errors', errors.join(' | '))
