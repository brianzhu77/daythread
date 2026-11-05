// R3-16 in the built app: Text to Select and Multi-select make options, Date and Checkbox to Text keep their words, Select to Relation counts as lost; changing back restores each.
// Usage: node tests/evidence/type-conversions/conversions.mjs <base-url> <store-path> [chromium|webkit]  (a throwaway store the server at <base-url> uses)
import * as pw from '@playwright/test'
import { execSync } from 'node:child_process'
const [base, S, engine = 'chromium'] = process.argv.slice(2)
if (!base || !S) { console.error('Usage: node tests/evidence/type-conversions/conversions.mjs <base-url> <store-path> [chromium|webkit]'); process.exit(2) }
const store = () => JSON.parse(execSync(`sqlite3 ${S} "select data from workspace"`, { maxBuffer: 1 << 26 }).toString())
const row = id => store().pages.find(p => p.id === id)
const prop = id => store().pages.find(p => p.id === 'shelf').database.properties.find(p => p.id === id)
const wait = ms => new Promise(r => setTimeout(r, ms))
const browser = await pw[engine].launch({ headless: true })
let failed = 0
const scenario = async (name, act) => {
  execSync(`rm -f ${S} ${S}-wal ${S}-shm && node --no-warnings tests/evidence/type-conversions/seed.ts ${S}`, { stdio: 'ignore' })
  const context = await browser.newContext({ viewport: { width: 1280, height: 900 }, serviceWorkers: 'block' }), page = await context.newPage(), errors = []
  page.on('pageerror', e => { if (!/ResizeObserver loop/.test(e.message)) errors.push(e.message) })
  let r
  try { await page.goto(`${base}/pages?page=shelf`); await page.locator('.database-row').first().waitFor(); await wait(1200); r = await act(page) } catch (e) { r = { ok: false, threw: e.message.split('\n').slice(0, 2).join(' ').slice(0, 240) } }
  const ok = r.ok && !errors.length
  if (!ok) failed++
  console.log(ok ? 'PASS' : 'FAIL', name, JSON.stringify({ ...r, errors }).slice(0, 520))
  await context.close()
}
const menu = page => page.locator('.database-menu')
const notices = page => page.locator('[role=alert], [role=status]').allInnerTexts().then(t => t.join(' | ').replace(/\s+/g, ' '))
const openProperty = async (page, name) => {
  await page.locator('.database-more-button').first().click(); await wait(250)
  await menu(page).getByRole('menuitem', { name: /Properties/ }).click(); await wait(250)
  await menu(page).getByRole('button', { name: new RegExp(`^${name}`) }).click(); await wait(250)
}
const setType = async (page, name, type) => { await openProperty(page, name); await menu(page).getByLabel('Type').selectOption(type); await wait(900); const n = await notices(page); await page.keyboard.press('Escape'); await wait(300); return n }
const cell = (page, id, n) => page.locator(`.database-row[data-row="${id}"] .database-td:not(.is-title)`).nth(n).innerText().then(t => t.replace(/\s+/g, ' ').trim())
await scenario('Text to Select: options made, cells read them, the rows keep their words, and back to Text is what it was', async page => {
  const r = { notice: await setType(page, 'Kind', 'select') }
  r.options = prop('kind').options.map(o => o.name); r.cells = [await cell(page, 'r1', 0), await cell(page, 'r2', 0)]; r.raw = row('r1').values.kind
  r.back = await setType(page, 'Kind', 'text'); r.cellsBack = [await cell(page, 'r1', 0), await cell(page, 'r2', 0)]
  r.ok = /Changed to Select/.test(r.notice) && !/empty/.test(r.notice) && r.options.join() === 'Alpha,Beta' && r.cells.join() === 'Alpha,Beta' && r.raw === 'Alpha' && r.cellsBack.join() === 'Alpha,Beta'
  return r
})
await scenario('Renaming an option made from Text keeps its rows, through the menu', async page => {
  await setType(page, 'Kind', 'select')
  await openProperty(page, 'Kind')
  const field = menu(page).getByLabel('Option name').first()
  const r = { field: await field.inputValue() }
  await field.fill('First'); await field.press('Enter'); await wait(900)
  await page.keyboard.press('Escape'); await wait(300)
  r.options = prop('kind').options.map(o => [o.name, o.from]); r.cell = await cell(page, 'r1', 0)
  r.ok = r.field === 'Alpha' && r.options[0][0] === 'First' && r.options[0][1] === 'alpha' && r.cell === 'First'
  return r
})
await scenario('Text to Multi-select splits on commas; each shows, and back to Text is what it was', async page => {
  const r = { notice: await setType(page, 'Tags', 'multiSelect') }
  r.options = prop('tags').options.map(o => o.name); r.cell = await cell(page, 'r1', 1)
  await setType(page, 'Tags', 'text'); r.back = await cell(page, 'r1', 1)
  r.ok = r.options.join() === 'red,green' && /red/.test(r.cell) && /green/.test(r.cell) && r.back === 'red, green' && !/empty/.test(r.notice)
  return r
})
await scenario('Date and Checkbox to Text keep their words, with no count of lost values, and back again', async page => {
  const r = { dueNotice: await setType(page, 'Due', 'text'), okNotice: await setType(page, 'Ok', 'text') }
  r.cells = [await cell(page, 'r1', 2), await cell(page, 'r2', 2), await cell(page, 'r1', 3), await cell(page, 'r2', 3)]
  await setType(page, 'Due', 'date'); await setType(page, 'Ok', 'checkbox')
  r.raw = row('r2').values.due; r.tick = row('r1').values.ok
  r.ok = !/empty/.test(r.dueNotice + r.okNotice) && r.cells[0] === '2026-11-05' && r.cells[1] === '2026-11-05 → 2026-11-07' && r.cells[2] === 'Yes' && r.cells[3] === '' && r.raw.end === '2026-11-07' && r.tick === true
  return r
})
await scenario('A Select to Relation counts them as lost, and back to Select they return', async page => {
  await setType(page, 'Kind', 'select')
  const r = { notice: await setType(page, 'Kind', 'relation') }
  r.cell = await cell(page, 'r1', 0)
  await setType(page, 'Kind', 'select'); r.back = await cell(page, 'r1', 0)
  r.ok = /2 values show as empty/.test(r.notice) && r.cell === '' && r.back === 'Alpha'
  return r
})
await browser.close()
console.log(failed ? `${failed} FAILED` : 'ALL PASS')
process.exit(failed ? 1 : 0)
