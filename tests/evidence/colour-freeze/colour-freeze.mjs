// R4-12 and R4-13 in the built app, on a fresh store from board/seed-board.ts: a rule starts grey, the highest that matches wins, row or one cell, on each layout, in a reload; freezing a column
// keeps it while the rest scroll, tinted too, and a window too narrow for them lets them all scroll. Usage: node tests/evidence/colour-freeze/colour-freeze.mjs <base-url> <store-path> <1280|390> [chromium|webkit] [shots-dir]  (a throwaway store, never his data)
import * as pw from '@playwright/test'
import { execSync } from 'node:child_process'
const [base, storePath, width, engine = 'chromium', shots] = process.argv.slice(2)
if (!base || !storePath || !width) { console.error('Usage: node tests/evidence/colour-freeze/colour-freeze.mjs <base-url> <store-path> <1280|390> [chromium|webkit] [shots-dir]'); process.exit(2) }
const wide = width === '1280'
execSync(`rm -f ${storePath} ${storePath}-wal ${storePath}-shm && node tests/evidence/board/seed-board.ts ${storePath}`, { stdio: 'ignore' })
const store = () => JSON.parse(execSync(`sqlite3 ${storePath} "select data from workspace"`, { maxBuffer: 1 << 26 }).toString())
const firstView = () => store().pages.find(p => p.id === 'list').database.views[0]
const browser = await pw[engine].launch({ headless: true })
const page = await (await browser.newContext({ viewport: { width: Number(width), height: wide ? 900 : 844 }, hasTouch: !wide, serviceWorkers: 'block' })).newPage()
const errors = []; page.on('pageerror', e => { if (!/access control checks|ResizeObserver/.test(e.message)) errors.push(e.message) })
let fails = 0
const check = (ok, what, extra) => { if (!ok) fails++; console.log(ok ? 'PASS' : 'FAIL', what, extra === undefined ? '' : JSON.stringify(extra)) }
const wait = ms => page.waitForTimeout(ms)
const shot = async name => { if (shots) await page.screenshot({ path: `${shots}/${engine}-${width}-${name}.png` }) }
const tap = l => wide ? l.click() : l.tap()
const block = page.locator('.database-block').first(), menu = page.locator('.database-menu')
const closeMenu = async () => { await page.keyboard.press('Escape'); await wait(250); if (await menu.count()) { await page.locator('.database-menu-scrim').click({ position: { x: 5, y: 5 } }).catch(() => {}); await wait(250) } }
const openLayout = async () => { await tap(block.locator('.database-more-button')); await wait(300); await tap(menu.getByRole('menuitem', { name: 'Layout' })); await wait(300) }
const openColour = async () => { await openLayout(); await tap(menu.getByRole('menuitem', { name: /Conditional colour/ })); await wait(300) }
const bg = async sel => block.locator(sel).first().evaluate(el => getComputedStyle(el).backgroundColor)
const row = id => `tr.database-row[data-row="${id}"]`
const layoutTo = async name => { await openLayout(); await tap(menu.getByRole('menuitemradio', { name })); await wait(700); if (await menu.getByRole('menuitem', { name: 'Status' }).count()) { await tap(menu.getByRole('menuitem', { name: 'Status' }).first()); await wait(600) } await closeMenu() }

await page.goto(`${base}/pages?page=books`); await wait(2500)
const plain = await bg(`${row('ubik')} td.is-number`)
check(!firstView().colourRules, 'no view has a rule until he makes one')

await openColour()
await tap(menu.getByRole('button', { name: '+ Add rule' })); await wait(600)
check(firstView().colourRules?.[0]?.tint === 'gray', 'a new rule starts grey', firstView().colourRules)
const rules = menu.locator('.database-colour-rule')
await rules.first().getByLabel('Property').selectOption({ label: 'Status' }); await wait(500)
const ruleBox = rules.first().locator('input[type=checkbox]')
await rules.first().getByLabel('Finished', { exact: false }).first().click({ force: !wide }).catch(async () => { await ruleBox.last().click({ force: true }) }); await wait(500)
await shot('panel')
await closeMenu()
const grey = await bg(`${row('ubik')} td.is-number`)
check(grey !== plain, 'a matching row takes the tint', [plain, grey])
check(await bg(`${row('dune')} td.is-number`) === plain, 'and a row that does not match stays plain')

await openColour()
await rules.first().getByLabel('Colour', { exact: true }).selectOption('red'); await wait(600)
await closeMenu()
const red = await bg(`${row('ubik')} td.is-number`)
check(red !== grey && firstView().colourRules[0].tint === 'red', 'colour is a deliberate choice', red)
await shot('row')

// Several: the highest wins, and they reorder.
await openColour()
await tap(menu.getByRole('button', { name: '+ Add rule' })); await wait(500)
await rules.nth(1).getByLabel('Property').selectOption({ label: 'Kind' }); await wait(400)
await rules.nth(1).getByLabel('Essay', { exact: false }).first().click({ force: !wide }).catch(() => {}); await wait(400)
await rules.nth(1).getByLabel('Colour', { exact: true }).selectOption('blue'); await wait(500)
await closeMenu()
check(await bg(`${row('ubik')} td.is-number`) === red, 'the highest rule that matches wins')
await openColour()
await tap(rules.nth(1).getByRole('button', { name: 'Move up' })); await wait(500)
await closeMenu()
const blue = await bg(`${row('ubik')} td.is-number`)
check(blue !== red, 'and moving a rule up changes which', blue)

// Only this property.
if (wide) {
  await openColour()
  await rules.first().getByLabel('What it colours').selectOption('property'); await wait(500)
  await closeMenu()
  check(await bg(`${row('ubik')} td.is-select`) !== plain && (await bg(`${row('ubik')} td.is-number`)) !== blue, 'only this property colours that cell', [await bg(`${row('ubik')} td.is-select`), await bg(`${row('ubik')} td.is-number`), firstView().colourRules.map(r => [r.rule.by, r.tint, r.scope]), await block.locator(row('ubik')).getAttribute('class'), await block.locator(`${row('ubik')} td.is-number`).getAttribute('class')])
  await shot('cell')
  await openColour(); await rules.first().getByLabel('What it colours').selectOption('row'); await wait(500); await closeMenu()
}
await page.reload(); await wait(2500)
check(await bg(`${row('ubik')} td.is-number`) === blue, 'a reload keeps it')

for (const [name, sel] of [['List', '.database-list-row[data-row="ubik"]'], ['Board', '.database-card[data-card="ubik"]'], ['Gallery', '.database-gallery-card[data-row="ubik"]']]) {
  await layoutTo(name)
  check(await bg(sel) === blue, `${name}: the card takes the tint`, await bg(sel))
  await shot(`tint-${name}`)
  if (wide) { await block.locator(sel).first().hover(); await wait(150); check(await block.locator(sel).first().evaluate(el => getComputedStyle(el).backgroundImage !== 'none'), `${name}: a hover still shows on the tint`); await page.mouse.move(2, 2); await wait(100) }
}
await layoutTo('Table')

// Freezing, at 1280 only.
await tap(block.locator('.database-more-button')); await wait(300); await tap(menu.getByRole('menuitem', { name: 'Properties' })); await wait(300)
await tap(menu.locator('.database-property-name', { hasText: 'Status' }).first()); await wait(300)
const freeze = menu.getByRole('menuitem', { name: 'Freeze up to column' })
if (!wide) {
  check(await freeze.count() === 0, 'a phone has no freezing: Name stays pinned as it is')
} else {
  await freeze.click(); await wait(700); await closeMenu()
  check(firstView().frozenThrough === 'status', 'freezing is saved on the view', firstView().frozenThrough)
  const scroll = block.locator('.database-scroll').first()
  const x = async sel => (await block.locator(sel).first().boundingBox()).x
  const frozenX = await x(`${row('ubik')} td.is-status`), otherX = await x(`${row('ubik')} td.is-number`)
  await scroll.evaluate(el => { el.scrollLeft = 200 }); await wait(250)
  check(Math.abs(await x(`${row('ubik')} td.is-status`) - frozenX) <= 1, 'the frozen column stays', [frozenX, await x(`${row('ubik')} td.is-status`)])
  check(await x(`${row('ubik')} td.is-number`) < otherX, 'and the rest scroll under it')
  const head = (await block.locator('.database-th[data-type="status"]').boundingBox()).x
  check(Math.abs(head - await x(`${row('ubik')} td.is-status`)) <= 1, 'its head stays over it')
  check(await bg(`${row('ubik')} td.is-status`) === blue, 'a tinted frozen cell is opaque', await bg(`${row('ubik')} td.is-status`))
  await shot('frozen')
  await scroll.evaluate(el => { el.scrollLeft = 0 }); await wait(200)
  // Wider than the window leaves: nothing stays, so nothing's out of reach.
  await page.setViewportSize({ width: 920, height: 900 }); await wait(500)
  await block.locator('.database-more-button').click(); await wait(300); await menu.getByRole('menuitem', { name: 'Properties' }).click(); await wait(300)
  await menu.locator('.database-property-name', { hasText: 'Due' }).first().click(); await wait(300)
  await menu.getByRole('menuitem', { name: 'Freeze up to column' }).click(); await wait(700); await closeMenu()
  const stuck = await block.locator('td.is-frozen').count()
  check(stuck === 0, 'frozen columns wider than the window all scroll', stuck)
  await page.setViewportSize({ width: 1280, height: 900 }); await wait(500)
  await block.locator('.database-more-button').click(); await wait(300); await menu.getByRole('menuitem', { name: 'Properties' }).click(); await wait(300)
  await menu.locator('.database-property-name', { hasText: 'Due' }).first().click(); await wait(300)
  await menu.getByRole('menuitem', { name: 'Unfreeze column' }).click(); await wait(700); await closeMenu()
  check(!firstView().frozenThrough, 'Unfreeze undoes it')
}
await closeMenu()
await openColour()
while (await rules.count()) { await tap(rules.first().getByRole('button', { name: 'Remove rule' })); await wait(400) }
await closeMenu()
check(await bg(`${row('ubik')} td.is-number`) === plain, 'removing the rules takes the colour off')
check(errors.length === 0, 'no page errors', errors)
console.log(fails ? `${fails} FAILED` : 'ALL PASS')
await browser.close()
process.exit(fails ? 1 : 0)
