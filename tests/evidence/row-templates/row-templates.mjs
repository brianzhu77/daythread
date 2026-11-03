// R3-12 Row templates in the built app, on a fresh store from board/seed-board.ts: `+ New ⌄`, making and editing one, values, body and to-dos
// on a new row, a default per view and for all views, Empty, a group and a filter, deleting one, and that it's no row anywhere.
// Usage: node tests/evidence/row-templates/row-templates.mjs <base-url> <store-path> <1280|390> [chromium|webkit] [shots-dir]  (a throwaway store the server at <base-url> reads, never his data)
import * as pw from '@playwright/test'
import { execSync } from 'node:child_process'
const [base, storePath, width, engine = 'chromium', shots] = process.argv.slice(2)
if (!base || !storePath || !width) { console.error('Usage: node tests/evidence/row-templates/row-templates.mjs <base-url> <store-path> <1280|390> [chromium|webkit] [shots-dir]'); process.exit(2) }
const wide = width === '1280'
execSync(`rm -f ${storePath} ${storePath}-wal ${storePath}-shm && node tests/evidence/board/seed-board.ts ${storePath}`, { stdio: 'ignore' })
const store = () => JSON.parse(execSync(`sqlite3 ${storePath} "select data from workspace"`, { maxBuffer: 1 << 26 }).toString())
const pageOf = id => store().pages.find(p => p.id === id)
const rowsNow = () => store().pages.filter(p => p.parentId === 'list' && !p.trashedAt)
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
const books = async () => { await page.goto(`${base}/pages?page=books`); await wait(2500) }
const chevron = () => block.locator('.database-table-wrap > .database-new-more')
const leaveNewRow = async () => { if (wide) { await page.keyboard.press('Escape'); await wait(400) } else { await page.goBack(); await wait(1800) } }
const newest = before => rowsNow().find(r => !before.has(r.id))
const ids = () => new Set(rowsNow().map(r => r.id))

await books()
check(await chevron().count() === 1, '+ New has its ⌄')
await tap(chevron()); await wait(400)
check(await menu.getByText('+ New template').count() === 1 && await menu.getByRole('menuitem', { name: 'Empty' }).count() === 0, 'no templates yet: only + New template, and no Empty')
await shot('none')

// Make one: name, values, a body with words and a to-do.
await tap(menu.getByText('+ New template')); await wait(2000)
check(page.url().includes('focus=title'), 'it opens to be named')
const templateId = new URL(page.url()).searchParams.get('page')
const template = () => pageOf(templateId)
check(template()?.type === 'template', 'a template page', template()?.type)
await page.locator('.page-head input, .page-head textarea, .page-head [contenteditable]').first().fill('Review'); await page.keyboard.press('Tab'); await wait(900)
check(template().title === 'Review', 'named', template().title)
check(await page.locator('.crumbs').getByText('Reading list').count() === 1, 'its way back is its database')
const kindRow = page.locator('.row-property', { hasText: 'Kind' })
await tap(kindRow.locator('.row-property-value')); await wait(400)
await page.getByRole('option', { name: 'Essay' }).or(page.getByText('Essay', { exact: true })).first().click({ force: !wide }); await wait(500)
await page.keyboard.press('Escape'); await wait(600)
if (!wide && await page.getByText('Done').count()) { await page.getByText('Done').last().tap().catch(() => {}); await wait(500) }
check(template().values?.kind === 'essay', 'values save on it', template().values)
await shot('template')
const line = page.locator('.ProseMirror').last()
await line.click(); await page.keyboard.type('Notes to fill'); await page.keyboard.press('Enter'); await wait(150)
await page.keyboard.type('[] Call the author'); await wait(2500)
const body = JSON.stringify(JSON.parse(template().document))
check(body.includes('Notes to fill') && body.includes('Call the author') && JSON.parse(template().document).some(n => n.type === 'task'), 'the body saves, a to-do in it', JSON.parse(template().document).map(n => n.type))
check(store().tasks.every(t => t.title !== 'Call the author'), 'and it makes no task')
const rowCount = rowsNow().length

// It's no row.
await books()
check(rowsNow().length === rowCount && !rowsNow().some(r => r.id === templateId), 'no row in the database')
check(await block.locator(`tr.database-row[data-row="${templateId}"]`).count() === 0, 'nor in the view')
await page.goto(`${base}/pages?view=templates`); await wait(1800)
check(await page.getByText('Review', { exact: true }).count() === 0, 'nor in the Templates list')
await books()

// A row from it.
let before = ids()
await tap(chevron()); await wait(400)
await shot('menu')
await tap(menu.getByRole('button', { name: 'Review', exact: false }).first()); await wait(1600)
let made = newest(before)
check(made?.title === 'Review' && made?.values?.kind === 'essay', 'a row with its title and values', made && { title: made.title, values: made.values })
const madeBody = JSON.parse(made.document)
check(madeBody.some(n => JSON.stringify(n).includes('Notes to fill')), 'and its body')
const todo = madeBody.find(n => n.type === 'task' && JSON.stringify(n).includes('Call the author'))
const task = store().tasks.find(t => t.id === todo?.props?.taskId)
check(task?.title === 'Call the author', 'its to-do is a real task now', task?.title)
await leaveNewRow()
before = ids()
await tap(chevron()); await wait(400); await tap(menu.getByRole('button', { name: 'Review', exact: false }).first()); await wait(1600)
const second = newest(before), secondTodo = JSON.parse(second.document).find(n => n.type === 'task' && JSON.stringify(n).includes('Call the author'))
check(secondTodo?.props?.taskId && secondTodo.props.taskId !== todo.props.taskId, "each row's to-dos are its own", [todo.props.taskId, secondTodo?.props?.taskId])
check(JSON.parse(pageOf(templateId).document).some(n => n.type === 'task') && store().tasks.filter(t => t.title === 'Call the author').length === 2, 'the template still makes none of its own')
await leaveNewRow()

// A plain + New is still empty.
before = ids()
await tap(block.locator('.database-table-wrap > .database-new')); await wait(1500)
made = newest(before)
check(made && !made.title && !made.values?.kind, 'with no default, + New is empty', made && made.values)
await leaveNewRow()

// Default for this view.
const openOptions = async () => { await tap(chevron()); await wait(400); await tap(menu.getByRole('button', { name: 'Review options' })); await wait(300) }
await openOptions()
await tap(menu.getByRole('menuitemcheckbox', { name: /this view/ })); await wait(800)
await shot('options')
check(pageOf('list').database.views[0].defaultTemplate === templateId, 'default for this view is saved on it')
await closeMenu()
before = ids()
await tap(block.locator('.database-table-wrap > .database-new')); await wait(1500)
made = newest(before)
check(made?.title === 'Review' && made?.values?.kind === 'essay', '+ New now starts from it', made?.title)
await leaveNewRow()
await tap(chevron()); await wait(400)
check(await menu.locator('.database-property-name', { hasText: 'default' }).count() === 1, 'the list says which')
before = ids()
await tap(menu.getByRole('menuitem', { name: 'Empty' })); await wait(1500)
made = newest(before)
check(made && !made.title && !made.values?.kind, 'Empty is still in reach', made?.values)
await leaveNewRow()

// For all views: another view takes it too; this view's own goes.
await openOptions()
await tap(menu.getByRole('menuitemcheckbox', { name: /all views/ })); await wait(1000)
check(pageOf('list').database.defaultTemplate === templateId && !pageOf('list').database.views[0].defaultTemplate, 'default for all views', [pageOf('list').database.defaultTemplate, pageOf('list').database.views[0].defaultTemplate])
await closeMenu()

// Under a filter and a group: what the view asks wins.
await tap(block.locator('.database-more-button')); await wait(300); await tap(menu.getByRole('button', { name: 'Filter' })); await wait(300)
await tap(menu.getByText('+ Add filter')); await wait(700)
await menu.getByLabel('Property').last().selectOption({ label: 'Kind' }); await wait(700)
await menu.getByLabel('Novel').last().click({ force: !wide }); await wait(900)
await closeMenu()
before = ids()
await tap(block.locator('.database-table-wrap > .database-new')); await wait(1500)
made = newest(before)
check(made?.values?.kind === 'novel' && made?.title === 'Review', 'the filter wins over the template', made?.values)
await leaveNewRow()
check(await page.getByText("hidden by this view's filter").count() === 0, 'and it stays in sight')
await tap(block.locator('.database-more-button')); await wait(300); await tap(menu.getByRole('button', { name: 'Filter' })); await wait(300)
await tap(menu.getByLabel('Remove filter').first()); await wait(800); await closeMenu()
await tap(block.locator('.database-more-button')); await wait(300); await tap(menu.getByRole('button', { name: 'Group' })); await wait(300)
await menu.locator('label.database-menu-row', { hasText: 'Group by' }).locator('select').selectOption({ label: 'Kind' }); await wait(800); await closeMenu()
const footMore = block.locator('tr.database-group-foot[data-group="novel"] .database-new-more')
check(await footMore.count() === 1, 'a group has its own ⌄')
before = ids()
await tap(footMore); await wait(400); await tap(menu.getByRole('button', { name: 'Review', exact: false }).first()); await wait(1500)
made = newest(before)
check(made?.values?.kind === 'novel', 'made under a group, it lands in that group', made?.values)
await leaveNewRow()
await shot('group')
await tap(block.locator('.database-more-button')); await wait(300); await tap(menu.getByRole('button', { name: 'Group' })); await wait(300)
await menu.locator('label.database-menu-row', { hasText: 'Group by' }).locator('select').selectOption(''); await wait(800); await closeMenu()

// Other layouts, and `⋯`'s way in.
for (const [layout, at] of [['List', '.database-table-wrap > .database-new-more'], ['Gallery', '.database-table-wrap > .database-new-more']]) {
  await tap(block.locator('.database-more-button')); await wait(300); await tap(menu.getByRole('menuitem', { name: 'Layout' })); await wait(300); await tap(menu.getByRole('menuitemradio', { name: layout })); await wait(900); await closeMenu()
  check(await block.locator(at).count() === 1, `${layout} has the ⌄`)
}
await tap(block.locator('.database-more-button')); await wait(300); await tap(menu.getByRole('menuitem', { name: 'Layout' })); await wait(300); await tap(menu.getByRole('menuitemradio', { name: 'Table' })); await wait(900); await closeMenu()
await tap(block.locator('.database-more-button')); await wait(300); await tap(menu.getByRole('menuitem', { name: 'Templates' })); await wait(300)
await tap(menu.getByRole('button', { name: 'Review', exact: false }).first()); await wait(1800)
check(page.url().includes(templateId), 'from ⋯ a tap opens it to edit', page.url().slice(-40))

// Delete: rows stay, and the default goes with it.
await books()
const kept = rowsNow().length, one = JSON.stringify(rowsNow().find(r => r.title === 'Review'))
await openOptions()
await tap(menu.getByRole('menuitem', { name: 'Delete' })); await wait(1000)
check(!pageOf(templateId) && rowsNow().length === kept && JSON.stringify(rowsNow().find(r => r.title === 'Review')) === one, 'deleted, and its rows are as they were')
await closeMenu()
before = ids()
await tap(block.locator('.database-table-wrap > .database-new')); await wait(1500)
made = newest(before)
check(made && !made.title, 'its default goes with it', made?.title)
await leaveNewRow()
check(errors.length === 0, 'no page errors', errors)
console.log(fails ? `${fails} FAILED` : 'ALL PASS')
await browser.close()
process.exit(fails ? 1 : 0)
