// A Button property in the built app (buttons.md, G3-9): the pill on every layout and the row page, not opening the row, with one Undo, and on several chosen rows.
// Usage: node tests/evidence/buttons/property.mjs <base-url> <store-path> [chromium|webkit] [shots-dir]  (a throwaway store the server at <base-url> uses)
import * as pw from '@playwright/test'
import { execSync } from 'node:child_process'
const [base, S, engine = 'chromium', shots] = process.argv.slice(2)
if (!base || !S) { console.error('Usage: node tests/evidence/buttons/property.mjs <base-url> <store-path> [chromium|webkit] [shots-dir]'); process.exit(2) }
const store = () => JSON.parse(execSync(`sqlite3 ${S} "select data from workspace"`, { maxBuffer: 1 << 26 }).toString())
const valueOf = id => store().pages.find(p => p.id === id).values?.n
const wait = ms => new Promise(r => setTimeout(r, ms))
const browser = await pw[engine].launch({ headless: true })
let failed = 0
const scenario = async (name, act, options = { viewport: { width: 1280, height: 900 } }, path = '/pages?page=runs', seedArg = '') => {
  if (process.env.ONLY && !name.includes(process.env.ONLY)) return
  execSync(`rm -f ${S} ${S}-wal ${S}-shm && node --no-warnings tests/evidence/buttons/seed.ts ${S} property ${seedArg}`, { stdio: 'ignore' })
  const context = await browser.newContext({ ...options, serviceWorkers: 'block' }), page = await context.newPage(), errors = []
  page.on('pageerror', e => { if (!/ResizeObserver loop/.test(e.message)) errors.push(e.message) })
  let r
  try { await page.goto(`${base}${path}`); await wait(2000); r = await act(page) } catch (e) { r = { ok: false, threw: e.message.split('\n').slice(0, 4).join(' ') } }
  const ok = r.ok && !errors.length
  if (!ok) failed++
  console.log(ok ? 'PASS' : 'FAIL', name, JSON.stringify({ ...r, errors }).slice(0, 620))
  if (shots) await page.screenshot({ path: `${shots}/prop-${name.replace(/\W+/g, '-').slice(0, 26)}-${engine}.png` }).catch(() => {})
  await context.close()
}
const pills = page => page.locator('.editor-button-pill.is-cell')
const notices = page => page.locator('[role=alert], [role=status]').allTextContents().then(t => t.join(' | ').replace(/\s+/g, ' '))
await scenario('In a table: a tap runs it on its row, stays on the page, and has one Undo', async page => {
  const count = await pills(page).count(), height = (await pills(page).first().boundingBox()).height, at = page.url()
  await pills(page).first().click(); await wait(900)
  const stayed = page.url() === at && await page.locator('.peek').count() === 0, words = await notices(page), one = valueOf('r1'), other = valueOf('r2')
  await page.getByRole('button', { name: 'Undo' }).first().click(); await wait(800)
  return { ok: count === 2 && height === 28 && stayed && /1 row changed/.test(words) && one === 5 && other === 2 && valueOf('r1') === 1, count, height, stayed, words, one, other, back: valueOf('r1') }
})
for (const layout of ['list', 'board', 'gallery']) await scenario(`On ${layout}: the pill shows, and a tap doesn't open the card`, async page => {
  const menu = page.locator('.database-menu')
  await page.locator('.database-more-button').first().click(); await wait(300); await menu.getByRole('menuitem', { name: 'Layout' }).click(); await wait(300); await menu.getByRole('menuitemradio', { name: new RegExp(`^${layout}`, 'i') }).click(); await wait(800); await page.keyboard.press('Escape'); await wait(200)
  const count = await pills(page).count(), at = page.url()
  // A near miss, 3 px above what's drawn, still takes it rather than opening the card.
  const box = await pills(page).first().boundingBox()
  const near = await page.evaluate(([x, y]) => Boolean(document.elementFromPoint(x, y)?.closest('.editor-button-pill')), [box.x + box.width / 2, box.y - 3])
  await pills(page).first().click(); await wait(900)
  return { ok: count === 2 && near && page.url() === at && await page.locator('.peek').count() === 0 && (valueOf('r1') === 5 || valueOf('r2') === 5), count, near, r1: valueOf('r1'), r2: valueOf('r2') }
})
await scenario('On a Timeline\'s table: a pill that runs, and no button inside a button', async page => {
  const pill = page.locator('.database-pane .editor-button-pill').first(), count = await page.locator('.database-pane .editor-button-pill').count(), nested = await page.locator('button button').count()
  await pill.click(); await wait(900)
  return { ok: count >= 1 && nested === 0 && (valueOf('r1') === 5 || valueOf('r2') === 5), count, nested, r1: valueOf('r1'), r2: valueOf('r2') }
}, undefined, '/pages?page=runs', 'timeline')
await scenario('390: a long label stays on the row page, ending in an ellipsis, and on a list', async page => {
  const pill = page.locator('.editor-button-pill').first(), box = await pill.boundingBox(), ell = await pill.locator('span').evaluate(n => n.scrollWidth > n.clientWidth), height = box.height
  const over = await page.evaluate(() => document.documentElement.scrollWidth > innerWidth)
  return { ok: box.x + box.width <= 390 && ell && height === 28 && !over, box, ell, over }
}, { viewport: { width: 390, height: 780 }, hasTouch: true }, '/pages?page=r1', 'long')
await scenario('In a table cell: Enter runs it, and Delete does nothing', async page => {
  const cell = page.locator('.database-cell.is-read-only', { has: page.locator('.editor-button-pill') }).first()
  await cell.focus(); await page.keyboard.press('Delete'); await wait(400)
  const untouched = valueOf('r1')
  await page.keyboard.press('Enter'); await wait(900)
  return { ok: untouched === 1 && valueOf('r1') === 5, untouched, after: valueOf('r1') }
})
await scenario('On the row page: in the property list, and it runs on that row', async page => {
  const count = await page.locator('.editor-button-pill').count()
  await page.locator('.editor-button-pill').first().click(); await wait(900)
  return { ok: count === 1 && valueOf('r2') === 5 && valueOf('r1') === 1, count, r1: valueOf('r1'), r2: valueOf('r2') }
}, undefined, '/pages?page=r2')
await scenario('Several chosen: the bar runs it on each, with one Undo', async page => {
  for (const name of ['One', 'Two']) { const row = page.locator('tr', { hasText: name }).first(); await row.hover(); await row.locator('.database-row-pick').click(); await wait(100) }
  await page.locator('.database-picked-bar').getByRole('button', { name: 'Bump' }).click(); await wait(900)
  const words = await notices(page), both = [valueOf('r1'), valueOf('r2')]
  await page.getByRole('button', { name: 'Undo' }).first().click(); await wait(800)
  return { ok: /2 rows changed/.test(words) && both.join() === '5,5' && [valueOf('r1'), valueOf('r2')].join() === '1,2', words, both, back: [valueOf('r1'), valueOf('r2')] }
})
await scenario('Edit button opens the steps, and a property offers no Insert blocks', async page => {
  await page.locator('.database-more-button').first().click(); await wait(250)
  const menu = page.locator('.database-menu')
  await menu.getByRole('menuitem', { name: 'Properties' }).click(); await wait(250)
  await menu.locator('.database-property-name', { hasText: 'Go' }).click(); await wait(250)
  await menu.getByRole('menuitem', { name: 'Edit button' }).click(); await wait(400)
  const editor = page.locator('.button-editor'), step = await editor.locator('.button-step-open').first().textContent()
  await editor.getByRole('menuitem', { name: '+ Add step' }).click(); await wait(150)
  const kinds = await editor.getByRole('menuitem').allTextContents()
  return { ok: /Set N/.test(step) && kinds.includes('Edit property') && !kinds.includes('Insert blocks'), step, kinds }
})
await browser.close()
console.log(failed ? `${failed} failed` : 'all passed')
process.exit(failed ? 1 : 0)
