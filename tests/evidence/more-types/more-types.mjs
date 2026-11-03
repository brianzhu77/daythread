// R3-9, R3-10 Created time, Edited time, ID, Email and Phone in the built app, on a fresh store: made from the property menu, read-only
// cells, links, what moves Edited, filter, group, + New, other layouts, a reload.
// Usage: node tests/evidence/more-types/more-types.mjs <base-url> <store-path> <1280|390> [chromium|webkit] [shots-dir]  (a throwaway store the server at <base-url> reads, never his data)
import * as pw from '@playwright/test'
import { execSync } from 'node:child_process'
const [base, storePath, width, engine = 'chromium', shots] = process.argv.slice(2)
if (!base || !storePath || !width) { console.error('Usage: node tests/evidence/more-types/more-types.mjs <base-url> <store-path> <1280|390> [chromium|webkit] [shots-dir]'); process.exit(2) }
const wide = width === '1280'
execSync(`rm -f ${storePath} ${storePath}-wal ${storePath}-shm && node tests/evidence/more-types/seed-types.ts ${storePath}`, { stdio: 'ignore' })
const store = () => JSON.parse(execSync(`sqlite3 ${storePath} "select data from workspace"`, { maxBuffer: 1 << 26 }).toString())
const row = id => store().pages.find(p => p.id === id)
const browser = await pw[engine].launch({ headless: true })
const context = await browser.newContext({ viewport: { width: Number(width), height: wide ? 900 : 844 }, hasTouch: !wide, serviceWorkers: 'block' })
const page = await context.newPage()
const errors = []; page.on('pageerror', e => { if (!/access control checks|ResizeObserver/.test(e.message)) errors.push(e.message) })
let fails = 0
const check = (ok, what, extra) => { if (!ok) fails++; console.log(ok ? 'PASS' : 'FAIL', what, extra === undefined ? '' : JSON.stringify(extra)) }
const wait = ms => page.waitForTimeout(ms)
const shot = async name => { if (shots) await page.screenshot({ path: `${shots}/${engine}-${width}-${name}.png` }) }
const tap = l => wide ? l.click() : l.tap()
const block = page.locator('.database-block').first(), menu = page.locator('.database-menu')
const closeMenu = async () => { await page.keyboard.press('Escape'); await wait(250); if (await menu.count()) { await page.locator('.database-menu-scrim').click({ position: { x: 5, y: 5 } }).catch(() => {}); await wait(250) } }
const openMenu = async panel => { await tap(block.locator('.database-more-button')); await wait(300); await tap(menu.getByRole(panel === 'Filter' || panel === 'Group' ? 'button' : 'menuitem', { name: panel }).first()); await wait(300) }
const cell = (id, type) => block.locator(`tr.database-row[data-row="${id}"] td.is-${type}`)
const shown = async () => new Set(await block.locator('tr.database-row').evaluateAll(l => l.map(e => e.dataset.row)))

await page.goto(`${base}/pages?page=books`); await wait(2500)
for (const [name, label] of [['Made', 'Created time'], ['Changed', 'Edited time'], ['No.', 'ID'], ['Mail', 'Email'], ['Tel', 'Phone']]) {
  await openMenu('Properties'); await tap(menu.getByRole('menuitem', { name: '+ Add property' })); await wait(250)
  await menu.getByLabel('Property name').fill(name)
  await tap(menu.getByRole('menuitem', { name: label, exact: true })); await wait(800)
  await closeMenu()
}
const db = () => row('list').database
check(['createdTime', 'editedTime', 'id', 'email', 'phone'].every(t => db().properties.some(p => p.type === t)), 'all five made from the property menu', db().properties.map(p => p.type))
check(row('dune').values['@id'] === 1 && row('old').values['@id'] === 35 && db().nextRowNumber === 36, 'rows numbered in order, the next one kept', [row('dune').values['@id'], row('old').values['@id'], db().nextRowNumber])
await shot('table')

// Read-only cells: they show, and nothing edits them.
check((await cell('dune', 'id').innerText()).trim() === '1', 'ID shows the number', await cell('dune', 'id').innerText())
check((await cell('emma', 'createdTime').innerText()).trim().length > 0 && (await cell('dune', 'editedTime').innerText()).trim().length > 0, 'the times show', [await cell('emma', 'createdTime').innerText(), await cell('dune', 'editedTime').innerText()])
check(await cell('dune', 'id').locator('button').count() === 0 && await cell('dune', 'createdTime').locator('button').count() === 0, 'read-only cells hold no button')
const before = JSON.stringify(row('dune').values), editedBefore = row('dune').editedAt
await tap(cell('dune', 'createdTime')); await wait(300)
check(await page.locator('.property-field').count() === 0, 'a tap opens no editor')
if (wide) {
  await cell('dune', 'id').locator('[data-nav]').focus()
  await page.keyboard.press('x'); await wait(200)
  check(await page.locator('.property-field').count() === 0, 'typing opens no editor')
  await page.keyboard.press('Delete'); await wait(300)
  await cell('dune', 'id').locator('[data-nav]').evaluate(el => { const d = new DataTransfer(); d.setData('text/plain', '99'); el.dispatchEvent(new ClipboardEvent('paste', { clipboardData: d, bubbles: true, cancelable: true })) }); await wait(500)
  check(JSON.stringify(row('dune').values) === before && row('dune').editedAt === editedBefore, 'Delete and paste change nothing')
}

// Email and Phone.
const mailId = db().properties.find(p => p.type === 'email').id, telId = db().properties.find(p => p.type === 'phone').id
const fill = async (id, type, text, link) => {
  await cell(id, type).scrollIntoViewIfNeeded()
  await tap(cell(id, type).locator('button.database-cell')); await wait(350)
  const field = page.locator('.property-field')
  check(await field.getAttribute('inputmode') === (type === 'email' ? 'email' : 'tel'), `${type}: its own keyboard`, await field.getAttribute('inputmode'))
  await field.fill(text); await wait(150)
  if (!wide) check(await page.getByText(link).count() === (type === 'email' ? /@/.test(text) : /\d/.test(text)) * 1, `${type}: the sheet's link follows the words`, text)
  await shot(`editor-${type}`)
  await page.keyboard.press('Enter'); await wait(wide ? 900 : 300)
  if (!wide && await field.count()) { await page.locator('.property-sheet-scrim, .sheet-scrim').first().click({ position: { x: 5, y: 5 } }).catch(() => {}); await wait(500) }
  await wait(600)
}
await fill('dune', 'email', 'dune@example.com', 'Email ↗')
check(row('dune').values[mailId] === 'dune@example.com', 'email saved', row('dune').values[mailId])
await fill('dune', 'phone', '+1 (415) 555-0100', 'Call ↗')
check(row('dune').values[telId] === '+1 (415) 555-0100', 'phone saved as typed', row('dune').values[telId])
const emmaEdited = row('emma').editedAt
await wait(50)
await fill('emma', 'email', 'ask at the desk', 'Email ↗')
check(row('emma').values[mailId] === 'ask at the desk', 'words that are no address are kept')
check(row('emma').editedAt > emmaEdited, 'a value moves Edited time', [emmaEdited, row('emma').editedAt])
check(await cell('emma', 'email').locator('a').count() === 0 && await cell('emma', 'email').locator('.cell-url').count() === 0, 'and read as plain text')
if (wide) {
  check(await cell('dune', 'email').locator('a[href="mailto:dune@example.com"]').count() === 1, 'an address is a mail link')
  check(await cell('dune', 'phone').locator('a[href="tel:+14155550100"]').count() === 1, 'a number is a phone link')
  check(await cell('dune', 'email').locator('button.database-url-edit').count() === 1, 'with the pencil to edit it')
} else check(await cell('dune', 'email').locator('.cell-url').count() === 1, 'an address reads as a link at 390')
await shot('filled')

// Row page: read-only rows there too; opening moves nothing; the body does.
const ubik = row('ubik').editedAt
await page.goto(`${base}/pages?page=ubik`); await wait(2500)
check(await page.locator('.row-property-value.is-read-only').count() === 3, 'three read-only rows on the row page', await page.locator('.row-property-value.is-read-only').count())
await shot('row-page')
check(row('ubik').editedAt === ubik, 'opening a row moves nothing')
await page.locator('.ProseMirror').last().click(); await page.keyboard.type('A line'); await wait(2500)
check(row('ubik').editedAt > ubik, 'a changed body moves Edited time', [ubik, row('ubik').editedAt])
await page.goto(`${base}/pages?page=books`); await wait(2500)

// Filter: ID as a number, Created time as a date, + New.
await openMenu('Filter'); await tap(menu.getByText('+ Add filter')); await wait(700)
await menu.getByLabel('Property').last().selectOption({ label: 'No.' }); await wait(700)
await menu.getByLabel('Condition').last().selectOption('gt'); await wait(500)
await menu.getByLabel('Value').last().fill('33'); await page.keyboard.press('Enter'); await wait(900)
await closeMenu()
const high = await shown()
check(high.size === 2 && high.has('f30') && high.has('old'), 'ID filters as a number', [...high])
await tap(block.locator('.database-table-wrap > .database-new')); await wait(1300)
const made = store().pages.filter(p => p.parentId === 'list').at(-1)
check(made.values['@id'] === 36 && Object.keys(made.values).length === 1, '+ New takes the next number and no value', made.values)
if (wide) { await page.keyboard.press('Escape'); await wait(400) } else { await page.goBack(); await wait(1800) }
check(await page.getByText("hidden by this view's filter").count() === 0, 'and says nothing, since it shows')
await openMenu('Filter')
await menu.getByLabel('Condition').last().selectOption('lt'); await wait(500)
await menu.getByLabel('Value').last().fill('2'); await page.keyboard.press('Enter'); await wait(900)
await closeMenu()
await tap(block.locator('.database-table-wrap > .database-new')); await wait(1300)
if (wide) { await page.keyboard.press('Escape'); await wait(400) } else { await page.goBack(); await wait(1800) }
check(await page.getByText("hidden by this view's filter").count() === 1, "a number that doesn't fit says it's hidden")
await openMenu('Filter')
await menu.getByLabel('Property').last().selectOption({ label: 'Made' }); await wait(700)
await menu.getByLabel('Condition').last().selectOption('before'); await wait(500)
await menu.getByLabel('Day').last().selectOption('today'); await wait(900)
await closeMenu()
const early = await shown()
check(early.size === 1 && early.has('old'), 'Created time filters as a date', [...early])
await openMenu('Filter'); await tap(menu.getByLabel('Remove filter').first()); await wait(800); await closeMenu()

// Group by Created time: months, nothing to drag to, + New sets nothing.
await openMenu('Group')
const groupSelect = menu.locator('label.database-menu-row', { hasText: 'Group by' }).locator('select')
check(!(await groupSelect.locator('option').allInnerTexts()).includes('No.'), 'ID is not offered to group by')
await groupSelect.selectOption({ label: 'Made' }); await wait(800)
check(await menu.getByLabel('By', { exact: true }).count() === 1, 'a time groups by day, week or month')
await closeMenu()
const names = await block.locator('.database-group-head').allInnerTexts()
check(names.some(n => /January 2026/.test(n)) && names.length === 2, 'grouped by month', names)
await shot('grouped')
const was = row('old').createdAt
if (wide) {
  const a = await block.locator('tr.database-row[data-row="old"]').boundingBox()
  await block.locator('tr.database-row[data-row="old"]').hover()
  const h = await block.locator('tr.database-row[data-row="old"] .database-row-handle').boundingBox()
  const to = await block.locator('tr.database-group-foot').last().boundingBox()
  await page.mouse.move(h.x + h.width / 2, h.y + h.height / 2); await page.mouse.down()
  await page.mouse.move(h.x + 8, h.y + 8, { steps: 3 }); await wait(80)
  await page.mouse.move(to.x + to.width / 2, to.y + to.height * 0.2, { steps: 8 }); await wait(150)
  await page.mouse.up(); await wait(900)
  check(a && await page.getByText("Made can't be changed").count() === 1 && row('old').createdAt === was, 'dragging to another month says no and changes nothing')
}
const count = store().pages.filter(p => p.parentId === 'list').length
await tap(block.locator('tr.database-group-foot .database-new').first()); await wait(1300)
const under = store().pages.filter(p => p.parentId === 'list').at(-1)
check(store().pages.filter(p => p.parentId === 'list').length === count + 1 && Object.keys(under.values).join() === '@id', '+ New under a month sets nothing', under.values)
if (wide) { await page.keyboard.press('Escape'); await wait(400) } else { await page.goBack(); await wait(1800) }
await openMenu('Group'); await menu.locator('label.database-menu-row', { hasText: 'Group by' }).locator('select').selectOption(''); await wait(800); await closeMenu()

// The other layouts draw them, in a database of only these types.
await page.goto(`${base}/pages?page=people`); await wait(2500)
const listWords = await page.locator('.database-list [data-row="ann"]').first().innerText()
check(listWords.includes('ann@example.com') && listWords.includes('+1 415 555 0100') && /\b1\b/.test(listWords), 'List draws them', listWords.replace(/\n/g, ' | '))
await shot('list')
await openMenu('Layout'); await tap(menu.getByRole('menuitemradio', { name: 'Gallery' })); await wait(900); await closeMenu()
const galleryWords = await page.locator('.database-gallery-card[data-row="ann"]').first().innerText()
check(galleryWords.includes('ann@example.com') && /\d:\d\d/.test(galleryWords), 'Gallery draws them', galleryWords.replace(/\n/g, ' | '))
await shot('gallery')
await page.goto(`${base}/pages?page=books`); await wait(2500)

await page.reload(); await wait(2500)
check((await cell('dune', 'id').innerText()).trim() === '1', 'they stay after a reload')
check(errors.length === 0, 'no page errors', errors)
console.log(fails ? `${fails} FAILED` : 'ALL PASS')
await browser.close()
process.exit(fails ? 1 : 0)
