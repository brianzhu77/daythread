// A Formula date on a Calendar and a Timeline, the plan's own read-only way (timeline.md §3): the menu's pick is taken, rows sit on their days, nothing drags, and no "Not saved".
// Usage: node tests/evidence/formula-dates/formula-dates.mjs <base-url> <store-path> [chromium|webkit]  (a throwaway store the server at <base-url> uses)
import * as pw from '@playwright/test'
import { execSync } from 'node:child_process'
const [base, S, engine = 'chromium'] = process.argv.slice(2)
if (!base || !S) { console.error('Usage: node tests/evidence/formula-dates/formula-dates.mjs <base-url> <store-path> [chromium|webkit]'); process.exit(2) }
const store = () => JSON.parse(execSync(`sqlite3 ${S} "select data from workspace"`, { maxBuffer: 1 << 26 }).toString())
const plan = () => store().pages.find(p => p.id === 'plan').database
const wait = ms => new Promise(r => setTimeout(r, ms))
const browser = await pw[engine].launch({ headless: true })
let failed = 0
const scenario = async (name, act, options = { viewport: { width: 1280, height: 900 } }, seed = '') => {
  execSync(`rm -f ${S} ${S}-wal ${S}-shm && node --no-warnings tests/evidence/formula-dates/seed.ts ${S} ${seed}`, { stdio: 'ignore' })
  const context = await browser.newContext({ ...options, serviceWorkers: 'block' }), page = await context.newPage(), errors = []
  page.on('pageerror', e => { if (!/ResizeObserver loop/.test(e.message)) errors.push(e.message) })
  let r
  try { await page.goto(`${base}/pages?page=plan`); await page.locator('.database-more-button').first().waitFor(); await wait(1400); r = await act(page) } catch (e) { r = { ok: false, threw: e.message.split('\n').slice(0, 2).join(' ').slice(0, 240) } }
  const ok = r.ok && !errors.length
  if (!ok) failed++
  console.log(ok ? 'PASS' : 'FAIL', name, JSON.stringify({ ...r, errors }).slice(0, 460))
  await context.close()
}
const notices = page => page.locator('[role=alert], [role=status]').allInnerTexts().then(t => t.join(' | ').replace(/\s+/g, ' '))
const menu = page => page.locator('.database-menu')
const layout = async (page, name) => {
  await page.locator('.database-more-button').first().click(); await wait(250)
  await menu(page).getByRole('menuitem', { name: 'Layout' }).click(); await wait(250)
  await menu(page).getByRole('menuitemradio', { name }).click(); await wait(900)
  const r = { menuOffers: await menu(page).locator('select').first().locator('option').allInnerTexts().catch(() => []) }
  await page.keyboard.press('Escape'); await wait(400)
  return r
}
await scenario('Calendar, with a Formula the only date: tapping it works, rows sit on their days, and a drag is refused', async page => {
  const r = await layout(page, 'Calendar')
  r.notice = await notices(page); r.dateBy = plan().views[0].dateBy; r.layout = plan().views[0].layout
  const today = page.getByText('Today row', { exact: true }).first(), tomorrow = page.getByText('Tomorrow row', { exact: true }).first()
  r.shown = [await today.count(), await tomorrow.count()]
  const a = await today.boundingBox(), b = await tomorrow.boundingBox()
  r.apart = a && b ? Math.round(Math.abs(a.x - b.x) + Math.abs(a.y - b.y)) : null
  await page.mouse.move(a.x + 5, a.y + 5); await page.mouse.down(); await page.mouse.move(a.x + 120, a.y + 5, { steps: 6 }); await page.mouse.up(); await wait(900)
  const after = await today.boundingBox()
  r.moved = Math.round(Math.abs(after.x - a.x)); r.noticeAfterDrag = await notices(page); r.stored = Object.keys(store().pages.find(p => p.id === 'a').values).join()
  r.ok = r.layout === 'calendar' && r.dateBy === 'when' && !/Not saved/.test(r.notice) && r.shown.join() === '1,1' && r.apart > 0 && r.moved === 0 && !/Not saved/.test(r.noticeAfterDrag) && !r.stored.includes('when')
  return r
})
await scenario('Timeline, with a Formula the only date: bars are drawn read-only, a drag changes nothing, and it never says Not saved', async page => {
  const r = await layout(page, 'Timeline')
  r.notice = await notices(page); r.dateBy = plan().views[0].dateBy
  const bars = page.locator('.database-bar')
  r.bars = await bars.count(); r.readOnly = await page.locator('.database-bar.is-read-only').count()
  const box = await bars.first().boundingBox()
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2); await page.mouse.down(); await page.mouse.move(box.x + 150, box.y + box.height / 2, { steps: 6 }); await page.mouse.up(); await wait(900)
  r.noticeAfterDrag = await notices(page); r.stored = Object.keys(store().pages.find(p => p.id === 'a').values).join()
  r.ok = r.dateBy === 'when' && !/Not saved/.test(r.notice) && r.bars === 2 && r.readOnly === 2 && !/Not saved/.test(r.noticeAfterDrag) && !r.stored.includes('when')
  return r
})
await scenario('A new row on a Formula Timeline: it makes the row, sets no date of its own, and nothing refuses', async page => {
  await layout(page, 'Timeline')
  const before = store().pages.filter(p => p.parentId === 'plan').map(p => p.id)
  const add = page.locator('.database-new').first()
  const r = { button: await add.count() }
  await add.click(); await wait(1200)
  const made = store().pages.filter(p => p.parentId === 'plan' && !before.includes(p.id))
  r.rows = made.length; r.values = Object.keys(made[0]?.values ?? {}); r.notice = await notices(page)
  r.ok = r.button === 1 && r.rows === 1 && !r.values.includes('when') && !/Not saved/.test(r.notice)
  return r
})
await scenario('A Formula Calendar has no add on a day: the row couldn\'t land there', async page => {
  await layout(page, 'Calendar')
  const r = { adds: await page.locator('.database-day-add').count(), days: await page.locator('.database-calendar-day, [data-day]').count() }
  r.ok = r.adds === 0 && r.days > 0
  return r
})
await scenario('A Rollup with latest: offered, taken, on its day, read-only', async page => {
  const r = await layout(page, 'Calendar')
  r.notice = await notices(page); r.dateBy = plan().views[0].dateBy; r.shown = await page.getByText('Today row', { exact: true }).count(); r.adds = await page.locator('.database-day-add').count()
  const a = await page.getByText('Today row', { exact: true }).first().boundingBox().catch(() => null)
  if (a) { await page.mouse.move(a.x + 5, a.y + 5); await page.mouse.down(); await page.mouse.move(a.x + 120, a.y + 5, { steps: 6 }); await page.mouse.up(); await wait(800) }
  r.after = await notices(page); r.stored = Object.keys(store().pages.find(p => p.id === 'a').values).join()
  r.ok = r.dateBy === 'roll' && !/Not saved/.test(r.notice) && r.shown === 1 && r.adds === 0 && !/Not saved/.test(r.after) && !r.stored.includes('roll')
  return r
}, { viewport: { width: 1280, height: 900 } }, 'rollup')
await scenario('390: the Timeline reads as its list, by week, with the Formula date', async page => {
  await page.locator('.database-more-button').first().click(); await wait(350)
  await menu(page).getByRole('menuitem', { name: 'Layout' }).click(); await wait(300)
  await menu(page).getByRole('menuitemradio', { name: 'Timeline' }).click(); await wait(900)
  await page.mouse.click(195, 60); await wait(500)
  const r = { notice: await notices(page), dateBy: plan().views[0].dateBy, rows: (await page.locator('body').innerText()).includes('Today row'), overflow: await page.evaluate(() => document.documentElement.scrollWidth - innerWidth) }
  r.ok = r.dateBy === 'when' && !/Not saved/.test(r.notice) && r.rows && r.overflow <= 0
  return r
}, { viewport: { width: 390, height: 780 }, hasTouch: true })
await browser.close()
console.log(failed ? `${failed} FAILED` : 'ALL PASS')
process.exit(failed ? 1 : 0)
