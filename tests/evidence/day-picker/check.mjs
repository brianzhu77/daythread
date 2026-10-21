// The title's date picker (Brian a6bd90e4 / f092ae63), on a copy of Brian's data with today = 2026-10-20.
//   node check.mjs <base url> <db path> <playwright index.mjs>
import { DatabaseSync } from 'node:sqlite'
const [base, dbPath, pw] = process.argv.slice(2)
const { chromium } = await import(pw)
let failures = 0
const log = (ok, name, detail = '') => { console.log(`${ok ? 'ok  ' : 'FAIL'} ${name}${detail ? ` · ${detail}` : ''}`); if (!ok) failures++ }
const pages = date => { const d = new DatabaseSync(dbPath, { readOnly: true }); try { return d.prepare("SELECT count(*) n FROM pages WHERE snapshot='current' AND type='daily' AND date=?").get(date).n } finally { d.close() } }
const b = await chromium.launch(), errors = []
for (const width of [1280, 390]) {
  const p = await b.newPage({ viewport: { width, height: 900 } })
  p.on('pageerror', e => errors.push(e.message)); p.on('console', m => { if (m.type() === 'error') errors.push(m.text()) })
  const openPicker = async date => { await p.goto(`${base}/day/${date}`, { waitUntil: 'networkidle' }); await p.waitForTimeout(700); await p.locator('.day-title-trigger').click(); await p.waitForTimeout(300) }
  const cell = day => p.locator('.day-picker .calendar__cell:not([data-outside-month=true])').filter({ hasText: new RegExp(`^${day}$`) }).first()
  const state = day => cell(day).evaluate(c => ({ future: c.classList.contains('is-future'), dot: !!c.querySelector('.day-picker-dot'), color: getComputedStyle(c).color, cursor: getComputedStyle(c).cursor, selected: c.getAttribute('data-selected') === 'true', today: c.getAttribute('data-today') === 'true', disabled: c.getAttribute('data-disabled') === 'true' }))
  await openPicker('2026-10-18')
  const [d17, d18, d19, d20, d21, d25] = await Promise.all([17, 18, 19, 20, 21, 25].map(state))
  log(!d17.future && d17.color === 'rgb(28, 28, 30)' && !d17.dot, `${width}: a past day with nothing written: black, no dot (17)`)
  log(d18.selected && d18.dot, `${width}: the current page is selected (blue) and has its dot (18)`)
  log(d19.dot && !d19.selected, `${width}: a written past day has the dot (19)`)
  log(d20.today && d20.dot && !d20.selected, `${width}: today, not the current page, keeps the light-blue state (20)`)
  log(d21.future && !d21.dot && !d21.disabled, `${width}: a future day with an empty page: grey, no dot, enabled (21)`, d21.color)
  log([d17, d18, d19, d20, d21, d25].every(s => s.cursor === 'pointer'), `${width}: every day shows the pointer cursor`)
  await cell(25).click(); await p.waitForTimeout(1200)
  log(p.url().endsWith('/day/2026-10-25') && await p.getByText("hasn't happened yet").count() === 1 && pages('2026-10-25') === 0, `${width}: a future day opens its preview, and no page is created`)
  await openPicker('2026-10-18')
  const before = pages('2026-10-12')
  await cell(12).click(); await p.waitForTimeout(1500)
  log(p.url().endsWith('/day/2026-10-12') && await p.locator('.continuous-editor').count() === 1 && pages('2026-10-12') === 1, `${width}: a past day opens with a plain page`, `pages before: ${before}`)
  await openPicker('2026-10-12')
  log(!(await state(12)).dot, `${width}: just opening it doesn't give it a dot`)
  await p.close()
}
log(errors.length === 0, 'no page or console errors', errors.slice(0, 2).join(' | '))
await b.close()
console.log(`\n${failures ? `${failures} failed` : 'all passed'}`)
process.exitCode = failures ? 1 : 0
