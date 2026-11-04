// R4-6: repeating row templates in the built app: set in the menu, made on opening, once across two tabs, the notice, pause.
// Usage: node tests/evidence/repeats/repeats.mjs <base-url> <store-path> [chromium|webkit]  (a throwaway store the server at <base-url> uses)
import * as pw from '@playwright/test'
import { execSync } from 'node:child_process'
const [base, S, engine = 'chromium'] = process.argv.slice(2)
if (!base || !S) { console.error('Usage: node tests/evidence/repeats/repeats.mjs <base-url> <store-path> [chromium|webkit]'); process.exit(2) }
const store = () => JSON.parse(execSync(`sqlite3 ${S} "select data from workspace"`, { maxBuffer: 1 << 26 }).toString())
const rows = () => store().pages.filter(p => p.parentId === 'log' && !p.trashedAt)
const repeat = () => store().pages.find(p => p.id === 'log').database.repeats?.weekly
const wait = ms => new Promise(r => setTimeout(r, ms))
const browser = await pw[engine].launch({ headless: true })
let failed = 0
const scenario = async (name, seed, act, options = { viewport: { width: 1280, height: 900 } }) => {
  execSync(`rm -f ${S} ${S}-wal ${S}-shm && node --no-warnings tests/evidence/repeats/seed.ts ${S} ${seed}`, { stdio: 'ignore' })
  const context = await browser.newContext(options), page = await context.newPage(), errors = []
  page.on('pageerror', e => { if (!/ResizeObserver loop/.test(e.message)) errors.push(e.message) })
  let r
  try { r = await act(page, context) } catch (e) { r = { ok: false, threw: e.message.split('\n').slice(0, 3).join(' ') } }
  const ok = r.ok && !errors.length
  if (!ok) failed++
  console.log(ok ? 'PASS' : 'FAIL', name, JSON.stringify({ ...r, errors }))
  await context.close()
}
const notices = page => page.locator('[role=alert], [role=status]').allInnerTexts().then(t => t.join(' | ').replace(/\s+/g, ' '))
const open = async page => { await page.goto(`${base}/pages?page=log`); await wait(2600) }
const menu = page => page.locator('.database-menu')
await scenario('Set in the template\'s menu: every field stored, off clears it and leaves the rows', 'none', async page => {
  await open(page)
  await page.locator('.database-more-button').first().click(); await wait(250)
  await menu(page).getByRole('menuitem', { name: 'Templates' }).click(); await wait(250)
  await menu(page).getByRole('button', { name: 'Weekly review options' }).click(); await wait(300)
  const r = { panel: (await menu(page).innerText()).replace(/\s+/g, ' ').slice(0, 120) }
  await menu(page).getByLabel('Repeat', { exact: true }).selectOption('month'); await wait(900)
  await menu(page).getByLabel('Every how many').fill('2'); await wait(900)
  await menu(page).getByLabel('At', { exact: true }).fill('23:59'); await wait(900)
  r.stored = repeat(); r.rows = rows().length
  await menu(page).getByRole('checkbox', { name: 'Make every missed one' }).click(); await wait(900)
  r.every = repeat().everyMissed
  await menu(page).getByRole('checkbox', { name: 'Paused' }).click(); await wait(900)
  r.paused = repeat().paused
  await menu(page).getByLabel('Repeat', { exact: true }).selectOption('off'); await wait(900)
  r.off = repeat() ?? null
  r.ok = r.stored.every === 'month' && r.stored.interval === 2 && r.stored.time === '23:59' && Boolean(r.stored.notBefore) && r.every === true && r.paused === true && r.off === null
  return r
})
await scenario('Due today: opening the app makes one row from the template, with its body, unasked and with no notice', 'week', async page => {
  await open(page)
  const list = rows(), r = { rows: list.map(p => p.title), id: list[0]?.id, body: list[0] && JSON.parse(list[0].document).map(n => n.content?.[0]?.text).join(), last: repeat().last, shown: await page.locator('.database-row').count(), notice: await notices(page) }
  r.ok = list.length === 1 && r.rows[0] === 'Weekly review' && /What went well/.test(r.body) && r.shown === 1 && !/skipped/.test(r.notice)
  return r
})
await scenario('Two tabs opening at once make one row', 'week', async (page, context) => {
  const other = await context.newPage()
  await Promise.all([page.goto(`${base}/pages?page=log`), other.goto(`${base}/pages?page=log`)])
  await wait(4000)
  const r = { rows: rows().length, notice: await notices(page), otherNotice: await notices(other) }
  r.ok = r.rows === 1 && !/went wrong|couldn't|failed/i.test(r.notice + r.otherNotice)
  return r
})
await scenario('Away for weeks: the latest only, one notice saying what it skipped', 'missed', async page => {
  await open(page)
  const r = { rows: rows().length, notice: await notices(page) }
  r.ok = r.rows === 1 && /Weekly review · 3 earlier weeks skipped/.test(r.notice)
  return r
})
await scenario('With Make every missed one: all of them', 'every', async page => {
  await open(page)
  const r = { rows: rows().length, notice: await notices(page) }
  r.ok = r.rows === 4 && !/skipped/.test(r.notice)
  return r
})
await scenario('Paused: nothing', 'paused', async page => {
  await open(page); await wait(800)
  const r = { rows: rows().length }
  r.ok = r.rows === 0
  return r
})
await scenario('Turned back on after a pause: nothing for the periods it was paused, no notice, and the next row is named', 'paused', async page => {
  await open(page); await wait(800)
  await page.locator('.database-more-button').first().click(); await wait(250)
  await menu(page).getByRole('menuitem', { name: 'Templates' }).click(); await wait(250)
  const listed = (await menu(page).innerText()).replace(/\s+/g, ' ')
  await menu(page).getByRole('button', { name: 'Weekly review options' }).click(); await wait(300)
  await menu(page).getByRole('checkbox', { name: 'Paused' }).click(); await wait(1500)
  const r = { listed, rows: rows().length, notice: await notices(page), next: /Next row \w+, \w+ \d+/.test(await menu(page).innerText()) }
  r.ok = /· Paused/.test(listed) && r.rows === 0 && !/skipped/.test(r.notice) && r.next
  return r
})
await scenario('Every can be emptied while typing: 1, backspace, 2 gives 2; left empty it goes back', 'week', async page => {
  await open(page)
  await page.locator('.database-more-button').first().click(); await wait(250)
  await menu(page).getByRole('menuitem', { name: 'Templates' }).click(); await wait(250)
  await menu(page).getByRole('button', { name: 'Weekly review options' }).click(); await wait(300)
  const every = menu(page).getByLabel('Every how many')
  await every.click(); await page.keyboard.press('End'); await page.keyboard.press('Backspace'); await wait(300)
  const emptied = await every.inputValue()
  await page.keyboard.type('2'); await wait(900)
  const r = { emptied, typed: await every.inputValue(), stored: repeat().interval, unit: /weeks/.test(await menu(page).innerText()) }
  await page.keyboard.press('Backspace'); await menu(page).getByText('Paused').hover(); await every.blur(); await wait(300)
  r.left = await every.inputValue()
  r.ok = emptied === '' && r.typed === '2' && r.stored === 2 && r.unit && r.left === '2'
  return r
})
await scenario('A row deleted after it\'s made stays deleted across a reopen', 'week', async page => {
  await open(page)
  const id = rows()[0].id
  await page.goto(`${base}/pages?page=${encodeURIComponent(id)}`); await wait(1600)
  await page.locator('.page-more').first().click(); await wait(200)
  await page.getByRole('menuitem', { name: 'Delete row' }).click(); await wait(1500)
  await open(page); await wait(500)
  const r = { rows: rows().length, trashed: store().pages.find(p => p.id === id)?.trashedAt != null }
  r.ok = r.rows === 0 && r.trashed
  return r
})
await browser.close()
console.log(failed ? `${failed} FAILED` : 'ALL PASS')
process.exit(failed ? 1 : 0)
