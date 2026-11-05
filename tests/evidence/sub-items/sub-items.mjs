// R4-4, first step: sub-items in a table and a list, read back from the store.
// Usage: node tests/evidence/sub-items/sub-items.mjs <base-url> <store-path> [chromium|webkit]  (a throwaway store the server at <base-url> uses)
import * as pw from '@playwright/test'
import { execSync } from 'node:child_process'
const [base, storePath, engine = 'chromium'] = process.argv.slice(2)
if (!base || !storePath) { console.error('Usage: node tests/evidence/sub-items/sub-items.mjs <base-url> <store-path> [chromium|webkit]'); process.exit(2) }
const store = () => JSON.parse(execSync(`sqlite3 ${storePath} "select data from workspace"`, { maxBuffer: 1 << 26 }).toString())
const work = () => store().pages.find(p => p.id === 'work').database
const live = () => store().pages.filter(p => p.parentId === 'work' && !p.trashedAt)
const wait = ms => new Promise(r => setTimeout(r, ms))
const browser = await pw[engine].launch({ headless: true })
const wide = { viewport: { width: 1280, height: 900 } }, phone = { viewport: { width: 390, height: 780 }, hasTouch: true }
let failed = 0
const scenario = async (name, seed, act, options = wide) => {
  if (process.env.ONLY && !new RegExp(process.env.ONLY).test(name)) return
  execSync(`rm -f ${storePath} ${storePath}-wal ${storePath}-shm && node --no-warnings tests/evidence/sub-items/seed.ts ${storePath} ${seed}`, { stdio: 'ignore' })
  const context = await browser.newContext(options)
  const page = await context.newPage(), errors = []
  page.on('pageerror', e => { if (!/ResizeObserver loop/.test(e.message)) errors.push(e.message) })
  let r
  try { await page.goto(`${base}/pages?page=work`); await wait(2200); r = await act(page) } catch (e) { r = { ok: false, threw: e.message.split('\n').slice(0, 3).join(' ') } }
  const ok = r.ok && !errors.length
  if (!ok) failed++
  console.log(ok ? 'PASS' : 'FAIL', name, JSON.stringify({ ...r, errors }))
  if (process.env.SHOTS) await page.screenshot({ path: `${process.env.SHOTS}/${name.replace(/\W+/g, '-').slice(0, 30)}-${engine}.png` }).catch(() => {})
  await context.close()
}
const menu = page => page.locator('.database-menu')
const more = async page => { await page.locator('.database-more-button').first().click(); await wait(250); await menu(page).getByRole('menuitem', { name: 'More settings' }).click(); await wait(250) }
const titles = page => page.locator('.database-row .database-title-cell').allInnerTexts()
const notices = page => page.locator('[role=alert], [role=status]').allInnerTexts().then(t => t.join(' | ').replace(/\s+/g, ' '))
const open = async (page, row) => { await page.locator(`.database-row[data-row="${row}"] .database-sub-toggle`).click(); await wait(200) }

await scenario('Turn on with rows and off again: every row and value unchanged, both ways', '', async page => {
  const before = JSON.stringify(live().map(r => r.values))
  await more(page)
  await menu(page).getByRole('checkbox', { name: 'Sub-items' }).click(); await wait(1200)
  const r = { on: work().subItems, unchanged: JSON.stringify(live().map(p => p.values)) === before, columns: await page.locator('.database-th').allInnerTexts() }
  await menu(page).getByRole('checkbox', { name: 'Sub-items' }).click(); await wait(1200)
  r.off = work().subItems ?? null; r.after = JSON.stringify(live().map(p => p.values)) === before; r.kept = work().properties.filter(p => p.type === 'relation').length
  await menu(page).getByRole('checkbox', { name: 'Sub-items' }).click(); await wait(1200)
  r.again = work().subItems; r.same = JSON.stringify(r.again) === JSON.stringify(r.on)
  r.ok = Boolean(r.on) && r.unchanged && r.off === null && r.after && r.kept === 2 && r.same && !r.columns.join().includes('Parent item')
  return r
})
await scenario('Nested: toggles open and close, with the indent stopping at 4 levels; flat lists them all', 'on', async page => {
  const r = { closed: await titles(page) }
  await open(page, 'top'); await open(page, 'kid'); await open(page, 'grand'); await open(page, 'great'); await open(page, 'deep')
  r.opened = await titles(page)
  const left = async id => (await page.locator(`.database-row[data-row="${id}"] .database-title-cell`).boundingBox()).x
  r.steps = [await left('top'), await left('kid'), await left('grand'), await left('great'), await left('deep'), await left('deeper')].map(x => Math.round(x))
  r.lastLevel = r.steps[5] - r.steps[4]
  r.stepOne = r.steps[1] - r.steps[0]
  await open(page, 'top')
  r.closedAgain = await titles(page)
  await more(page)
  await menu(page).getByLabel('Show sub-items').selectOption('flat'); await wait(1000)
  await page.keyboard.press('Escape'); await wait(300)
  r.flat = await titles(page)
  r.ok = r.closed.join() === 'top,other' && r.opened.join() === 'top,kid,grand,great,deep,deeper,kid2,other' && r.stepOne === 16 && r.lastLevel === 0 && r.closedAgain.join() === 'top,other' && r.flat.length === 8
  return r
})
await scenario('Which rows: parents only, opening onto their sub-items, and sub-items only', 'on', async page => {
  await more(page)
  const r = {}
  await menu(page).getByLabel('Which rows').selectOption('parents'); await wait(1000)
  await page.keyboard.press('Escape'); await wait(300)
  r.parents = await titles(page)
  await open(page, 'top'); r.parentsOpen = await titles(page)
  await more(page); await menu(page).getByLabel('Which rows').selectOption('subs'); await wait(1000); await page.keyboard.press('Escape'); await wait(300)
  r.subs = await titles(page)
  r.ok = r.parents.join() === 'top,other' && r.parentsOpen.join() === 'top,kid,kid2,other' && r.subs.join() === 'kid,grand,great,deep,deeper,kid2'
  return r
})
await scenario('In a group a sub-item says whose it is, on every layout; a row with no parent says nothing', 'grouped', async page => {
  const r = {}
  r.table = await page.locator('.database-sub-parent').allInnerTexts()
  for (const name of ['list', 'board', 'gallery', 'timeline']) { await page.locator('.database-view-name').first().click(); await wait(250); await page.locator('.database-view-pick', { hasText: name }).click(); await wait(800); r[name] = await page.locator('.database-sub-parent').allInnerTexts() }
  r.ok = ['table', 'list', 'board', 'gallery', 'timeline'].every(k => r[k].join() === 'in top')
  return r
})
const lanes = page => page.locator('.database-bar-lane[data-row]').evaluateAll(l => l.map(n => [n.dataset.row, Boolean(n.querySelector('.database-bar:not(.is-ghost)')), Boolean(n.querySelector('.database-sub-toggle'))]))
const laneIds = async page => (await lanes(page)).map(l => l[0]).join()
const openLane = async (page, row) => { await page.locator(`.database-bar-lane[data-row="${row}"] .database-sub-toggle`).click(); await wait(250) }
await scenario('Timeline: nested in a toggle, with a dateless sub-item under its parent and a dateless parent kept for its sub-item; a loner stays on No date', 'timeline', async page => {
  const r = { closed: await laneIds(page) }
  const left = await page.locator('.database-scale-label').first().boundingBox()
  await openLane(page, 'top'); r.top = await laneIds(page)
  await openLane(page, 'kid'); r.kid = await laneIds(page)
  await openLane(page, 'great'); r.great = await laneIds(page)
  r.bars = (await lanes(page)).filter(l => l[1]).map(l => l[0]).join()
  r.indent = await page.locator('.database-bar-lane[data-row="grand"] .database-pane-name').evaluate(n => n.getBoundingClientRect().x) - await page.locator('.database-bar-lane[data-row="top"] .database-pane-name').evaluate(n => n.getBoundingClientRect().x)
  r.handles = [await page.locator('.database-bar-lane[data-row="top"] .database-pane-handle').count(), await page.locator('.database-bar-lane[data-row="kid"] .database-pane-handle').count()]
  r.noDate = await page.locator('.database-undated-head').innerText()
  r.scaleStill = Math.abs((await page.locator('.database-scale-label').first().boundingBox()).x - left.x) < 1
  r.ok = r.closed === 'top,great,kid2,other' && r.top === 'top,kid,great,kid2,other' && r.kid === 'top,kid,grand,great,kid2,other' && r.great === 'top,kid,grand,great,deep,kid2,other' && r.bars.split(',').includes('deep') && !r.bars.split(',').includes('grand') && r.indent > 20 && r.handles[0] === 1 && r.handles[1] === 0 && /No date · 1/.test(r.noDate) && r.scaleStill
  return r
})
await scenario('Timeline: with the table closed a parent\'s toggle still opens it; Flattened lists every row with no toggle; Sub-items only lists no parents', 'timeline', async page => {
  await page.locator('.database-timeline-toggle').click(); await wait(400)
  const r = { closedToggle: await page.locator('.database-lane-lead .database-sub-toggle').count() }
  // Beside the closed table's own handle, not under it (#143).
  const toggleBox = await page.locator('.database-bar-lane[data-row="top"] .database-sub-toggle').boundingBox(), gripBox = await page.locator('.database-bar-lane[data-row="top"] .database-lane-grip').boundingBox()
  r.apart = toggleBox.x >= gripBox.x + gripBox.width - 1
  r.kidHasGrip = await page.locator('.database-bar-lane[data-row="kid"] .database-lane-grip').count()
  // A dateless parent's name stays on its own line, beside its toggle.
  const lane = await page.locator('.database-bar-lane[data-row="great"]').boundingBox(), name = await page.locator('.database-bar-lane[data-row="great"] .database-bar-off').boundingBox(), toggle = await page.locator('.database-bar-lane[data-row="great"] .database-sub-toggle').boundingBox()
  r.nameOnLine = name.y >= lane.y - 1 && name.y + name.height <= lane.y + lane.height + 1 && name.x >= toggle.x + toggle.width - 1 && toggle.y >= lane.y - 1 && toggle.y + toggle.height <= lane.y + lane.height + 1
  await page.screenshot({ path: '/tmp/rb-csv/tl-closed.png' })
  await page.locator('.database-bar-lane[data-row="top"] .database-sub-toggle').click(); await wait(300)
  r.opened = await page.locator('.database-bar-lane[data-row="kid"] .database-bar').count()
  await page.locator('.database-timeline-toggle').click(); await wait(300)
  await more(page)
  await menu(page).getByLabel('Show sub-items').selectOption('flat'); await wait(900)
  r.flat = await laneIds(page); r.flatToggles = await page.locator('.database-timeline .database-sub-toggle').count()
  await menu(page).getByLabel('Which rows').selectOption('subs'); await wait(900)
  r.subs = await laneIds(page)
  r.ok = r.apart && r.nameOnLine && r.kidHasGrip === 0 && r.closedToggle >= 2 && r.opened === 1 && r.flat.split(',').includes('deep') && r.flat.split(',').includes('kid') && r.flatToggles === 0 && !r.subs.split(',').includes('top') && r.subs.split(',').includes('kid')
  return r
})
await scenario('A new sub-item from a parent\'s +', 'on', async page => {
  const r = {}
  await page.locator('.database-row[data-row="other"]').hover(); await wait(150)
  await page.getByRole('button', { name: 'New sub-item in other' }).click(); await wait(1500)
  const made = live().find(p => !['top', 'kid', 'grand', 'great', 'deep', 'deeper', 'kid2', 'other'].includes(p.id))
  r.madeParent = made?.values?.par; r.otherSub = store().pages.find(p => p.id === 'other').values?.sub
  r.ok = r.madeParent?.join() === 'other' && r.otherSub?.join() === made?.id
  return r
})
await scenario('Delete a parent: the count, one trash batch, one Undo restores them all', 'on', async page => {
  await page.goto(`${base}/pages?page=kid`); await wait(1800)
  await page.locator('.page-more').first().click(); await wait(200)
  await page.getByRole('menuitem', { name: 'Delete row' }).click(); await wait(1500)
  const r = { notice: await notices(page), left: live().map(p => p.id).sort(), trashIds: new Set(store().pages.filter(p => p.trashedAt).map(p => p.trashId)).size }
  await page.getByRole('button', { name: 'Undo' }).first().click(); await wait(1500)
  r.back = live().length
  r.ok = /Row deleted · 4 sub-items/.test(r.notice) && r.left.join() === 'kid2,other,top' && r.trashIds === 1 && r.back === 8
  return r
})
await scenario('Duplicate a parent: the tree comes, with its own links', 'on', async page => {
  await page.goto(`${base}/pages?page=kid`); await wait(1800)
  await page.locator('.page-more').first().click(); await wait(200)
  await page.getByRole('menuitem', { name: 'Duplicate row' }).click(); await wait(1800)
  const all = live(), copy = all.find(p => p.title === 'kid (copy)'), kid = all.find(p => p.id === 'kid')
  const r = { rows: all.length, copyPar: copy?.values?.par, copySub: copy?.values?.sub?.length, kidSub: kid.values.sub }
  r.ok = r.rows === 13 && r.copyPar?.join() === 'top' && r.copySub === 1 && r.kidSub.join() === 'grand'
  return r
})
await scenario('A list nests too', 'on', async page => {
  await page.locator('.database-more-button').first().click(); await wait(250)
  await menu(page).getByRole('menuitem', { name: /Layout/ }).click(); await wait(250)
  await menu(page).getByRole('menuitemradio', { name: 'List' }).click(); await wait(1000)
  await page.keyboard.press('Escape'); await wait(300)
  const names = () => page.locator('.database-list-row .database-list-title').allInnerTexts()
  const r = { closed: await names() }
  await page.locator('.database-list-row[data-row="top"] .database-sub-toggle').click(); await wait(200)
  r.opened = await names()
  r.ok = r.closed.join() === 'top,other' && r.opened.join() === 'top,kid,kid2,other'
  return r
})
await scenario('Cards: a gallery shows parents with their sub-items on the card, and flat shows them all', 'on', async page => {
  await page.locator('.database-more-button').first().click(); await wait(250)
  await menu(page).getByRole('menuitem', { name: /Layout/ }).click(); await wait(250)
  await menu(page).getByRole('menuitemradio', { name: 'Gallery' }).click(); await wait(1000)
  await page.keyboard.press('Escape'); await wait(300)
  const cards = () => page.locator('.database-gallery-title').allInnerTexts()
  const r = { gallery: await cards(), onCard: await page.locator('.database-gallery-card[data-row="top"] .database-card-subs').innerText() }
  await more(page); await menu(page).getByLabel('Show sub-items').selectOption('flat'); await wait(1000); await page.keyboard.press('Escape'); await wait(300)
  r.flat = await cards(); r.flatOnCard = await page.locator('.database-card-subs').count()
  r.ok = r.gallery.join() === 'top,other' && /kid/.test(r.onCard) && /kid2/.test(r.onCard) && r.flat.length === 8 && r.flatOnCard === 0
  return r
})
await scenario('390: toggles take a tap, nothing past the edge', 'on', async page => {
  await page.locator('.database-row[data-row="top"] .database-sub-toggle').click(); await wait(250)
  const box = await page.locator('.database-row[data-row="top"] .database-sub-toggle').boundingBox()
  const r = { opened: await titles(page), height: box.height, overflow: await page.evaluate(() => document.documentElement.scrollWidth - innerWidth) }
  r.ok = r.opened.join() === 'top,kid,kid2,other' && r.height >= 44 && r.overflow <= 0
  return r
}, phone)
await browser.close()
console.log(failed ? `${failed} FAILED` : 'ALL PASS')
process.exit(failed ? 1 : 0)
