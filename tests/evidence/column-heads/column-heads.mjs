// R4-18 in the built app, on a fresh store from board/seed-board.ts: a click on a column head opens its menu under it, a drag on the edge resizes with one Undo,
// a drag on the head moves it with one Undo, across the frozen edge as R4-13 says. At 390 a head stays plain text.
// Usage: node tests/evidence/column-heads/column-heads.mjs <base-url> <store-path> [chromium|webkit] [shots-dir]  (a throwaway store, never his data)
import * as pw from '@playwright/test'
import { execSync } from 'node:child_process'
const [base, storePath, engine = 'chromium', shots] = process.argv.slice(2)
if (!base || !storePath) { console.error('Usage: node tests/evidence/column-heads/column-heads.mjs <base-url> <store-path> [chromium|webkit] [shots-dir]'); process.exit(2) }
execSync(`rm -f ${storePath} ${storePath}-wal ${storePath}-shm && node tests/evidence/board/seed-board.ts ${storePath}`, { stdio: 'ignore' })
const view = () => JSON.parse(execSync(`sqlite3 ${storePath} "select data from workspace"`, { maxBuffer: 1 << 26 }).toString()).pages.find(p => p.id === 'list').database.views[0]
const order = () => view().columns.map(c => c.id).join()
const browser = await pw[engine].launch({ headless: true })
const context = await browser.newContext({ viewport: { width: 1280, height: 900 }, serviceWorkers: 'block' })
const page = await context.newPage()
const errors = []; page.on('pageerror', e => { if (!/access control checks|ResizeObserver/.test(e.message)) errors.push(e.message) })
let fails = 0
const check = (ok, what, extra) => { if (!ok) fails++; console.log(ok ? 'PASS' : 'FAIL', what, extra === undefined ? '' : JSON.stringify(extra)) }
const wait = ms => page.waitForTimeout(ms)
const shot = async name => { if (shots) await page.screenshot({ path: `${shots}/${engine}-${name}.png` }) }
const menu = page.locator('.database-menu')
const head = name => page.locator('.database-th', { hasText: name }).first()
const box = async l => (await l.boundingBox())
const shownOrder = () => page.locator('.database-th[data-column-head]').evaluateAll(all => all.slice(1).map(t => t.dataset.columnHead.split('|')[1]).join())
const undo = async () => { await page.keyboard.press(`${process.platform === 'darwin' ? 'Meta' : 'Control'}+z`); await wait(900) }
const closeMenu = async () => { await page.keyboard.press('Escape'); await wait(300) }
const dragEdge = async (name, by, { release = true } = {}) => {
  // Its edge well inside the table, where a real pointer could reach it.
  await head(name).evaluate(th => { const el = th.closest('.database-scroll'), over = th.getBoundingClientRect().right - (el.getBoundingClientRect().right - 40); if (over > 0) el.scrollLeft += over }); await wait(150)
  const b = await box(head(name)), x = b.x + b.width - 3, y = b.y + b.height / 2
  await page.mouse.move(x, y); await page.mouse.down(); await page.mouse.move(x + by / 2, y, { steps: 4 }); await page.mouse.move(x + by, y, { steps: 4 }); await wait(120)
  if (release) { await page.mouse.up(); await wait(900) }
}
const dragHead = async (name, toName, { release = true, after = false } = {}) => {
  await head(name).scrollIntoViewIfNeeded(); await wait(100)
  const a = await box(head(name)), t = await box(head(toName)), y = a.y + a.height / 2
  await page.mouse.move(a.x + a.width / 2, y); await page.mouse.down(); await page.mouse.move(a.x + a.width / 2 + 10, y, { steps: 3 })
  await page.mouse.move(after ? t.x + t.width - 4 : t.x + 4, y, { steps: 10 }); await wait(160)
  if (release) { await page.mouse.up(); await wait(900) }
}

await page.goto(`${base}/pages?page=books`); await wait(2500)
const before = order(), text = () => page.evaluate(() => getSelection().toString())

// A click: the column's menu, under its head.
await head('Pages').click(); await wait(400)
const h = await box(head('Pages')), m = await box(menu)
check(await menu.count() === 1 && Math.abs(m.x - Math.min(h.x, 1280 - 300 - 8)) < 2 && Math.abs(m.y - (h.y + h.height + 4)) < 2, 'a click on a head opens a menu under it', { h, m })
const words = (await menu.innerText()).replace(/\s+/g, ' ')
for (const w of ['Pages', 'Type', 'Sort ascending', 'Sort descending', 'Filter', 'Freeze up to column', 'Hide in this view', 'Duplicate property', 'Delete property']) check(words.includes(w), `its menu has ${w}`)
await shot('menu')
await head('Pages').click(); await wait(300)
check(await menu.count() === 0, 'a second click closes it')
await head('Pages').click(); await wait(300); await head('Kind').click(); await wait(400)
check(await menu.getByRole('textbox', { name: 'Name', exact: true }).inputValue() === 'Kind' && Math.abs((await box(menu)).x - (await box(head('Kind'))).x) < 2, 'a click on another head moves to it')
await closeMenu()
check(await menu.count() === 0, 'Esc closes it')
await page.locator('.database-th.is-title').click(); await wait(400)
const nameWords = (await menu.innerText()).replace(/\s+/g, ' ')
check(nameWords.includes('Sort ascending') && nameWords.includes('Wrap Name') && !nameWords.includes('Delete') && !nameWords.includes('Hide'), 'Name has only what applies to it', nameWords)
await closeMenu()

// Sort and filter from the head.
await head('Pages').click(); await wait(300)
await menu.getByRole('menuitemcheckbox', { name: 'Sort descending' }).click(); await wait(800)
check(JSON.stringify(view().sort) === '[{"by":"pages","direction":"desc"}]', 'Sort descending is saved', view().sort)
check(await menu.getByRole('menuitemcheckbox', { name: 'Sort descending' }).getAttribute('aria-checked') === 'true', 'and says so')
await menu.getByRole('menuitemcheckbox', { name: 'Sort descending' }).click(); await wait(800)
check(view().sort.length === 0, 'choosing it again takes it off')
await menu.getByRole('menuitem', { name: 'Filter' }).click(); await wait(800)
check(view().filter.length === 1 && view().filter[0].by === 'pages' && await menu.locator('.database-rule select').first().inputValue() === 'pages', 'Filter adds a rule on this column and shows it', view().filter)
await menu.locator('.database-rule-remove').first().click(); await wait(800)
check(view().filter.length === 0, 'and it can be taken off there')
await closeMenu()

// Duplicate: its settings and values, beside it, and one Undo.
await head('Pages').click(); await wait(300)
await menu.getByRole('menuitem', { name: 'Duplicate property' }).click(); await wait(900)
const row = id => JSON.parse(execSync(`sqlite3 ${storePath} "select data from workspace"`, { maxBuffer: 1 << 26 }).toString()).pages.find(p => p.id === id)
const copy = order().split(',')[order().split(',').indexOf('pages') + 1]
check(await menu.getByRole('textbox', { name: 'Name', exact: true }).inputValue() === 'Pages copy' && row('dune').values[copy] === 412, 'Duplicate makes a copy beside it, with its values, and opens it', [order(), copy])
await closeMenu(); await wait(200)
await page.getByRole('button', { name: 'Undo' }).first().click(); await wait(900)
check(order() === before, 'its Undo takes it away', order())

// Insert left and right: the add form, and the new column beside this one, with one Undo.
await head('Pages').click(); await wait(300)
await menu.getByRole('menuitem', { name: 'Insert left' }).click(); await wait(300)
await menu.getByLabel('Property name').fill('Before pages'); await page.keyboard.press('Enter'); await wait(900)
const made = order().split(','), at = made.indexOf('pages')
check(made.length === before.split(',').length + 1 && !before.split(',').includes(made[at - 1]), 'Insert left puts it just before', made)
await closeMenu(); await wait(200)
await head('Before pages').click(); await wait(300)
await menu.getByRole('menuitem', { name: 'Delete property' }).click(); await wait(900); await closeMenu()
check(order() === before, 'and it can go again', order())
await head('Pages').click(); await wait(300)
await menu.getByRole('menuitem', { name: 'Insert right' }).click(); await wait(300)
await menu.getByLabel('Property name').fill('After pages'); await page.keyboard.press('Enter'); await wait(900)
const made2 = order().split(',')
check(made2.indexOf('pages') + 1 === made2.indexOf(made2.find(id => !before.split(',').includes(id))), 'Insert right puts it just after', made2)
await closeMenu(); await wait(200)
await head('After pages').click(); await wait(300)
await menu.getByRole('menuitem', { name: 'Delete property' }).click(); await wait(900); await closeMenu()
await page.locator('.database-th.is-title').click(); await wait(300)
await menu.getByRole('menuitem', { name: 'Insert right' }).click(); await wait(300)
await menu.getByLabel('Property name').fill('First now'); await page.keyboard.press('Enter'); await wait(900)
check(!before.split(',').includes(order().split(',')[0]), 'Insert right on Name makes it the first column', order())
await closeMenu(); await wait(200)
await head('First now').click(); await wait(300)
await menu.getByRole('menuitem', { name: 'Delete property' }).click(); await wait(900); await closeMenu()
check(order() === before, 'back to where it was', order())

// The head's + and a row page's + Add property say so too, as Safari leaves no focus for ⌘Z after a click.
await page.locator('.database-th.is-add button').click(); await wait(900)
check(order() !== before && await page.getByRole('button', { name: 'Undo' }).count() > 0, 'the head\'s + has a notice with Undo', order())
await page.getByRole('button', { name: 'Undo' }).first().click(); await wait(900)
check(order() === before, 'and its Undo takes the column away', order())
await page.goto(`${base}/pages?page=dune`); await wait(1800)
await page.locator('.row-property-add').click(); await wait(900)
const addedFromRow = order().split(',').length
await page.getByRole('button', { name: 'Undo' }).first().click(); await wait(900)
check(addedFromRow === before.split(',').length + 1 && order() === before, 'a row page\'s + Add property too', order())
await page.goto(`${base}/pages?page=books`); await wait(2300)

// Insert has a notice with Undo, and a closed menu leaves focus where ⌘Z reaches the table.
await head('Pages').click(); await wait(300)
await menu.getByRole('menuitem', { name: 'Insert left' }).click(); await wait(300)
await menu.getByLabel('Property name').fill('With a notice'); await page.keyboard.press('Enter'); await wait(900)
await page.getByRole('button', { name: 'Undo' }).first().click(); await wait(900)
check(order() === before, 'Insert\'s notice has Undo, which takes it away', order())
await closeMenu(); await wait(200)
await head('Pages').click(); await wait(300)
await menu.getByRole('menuitemcheckbox', { name: 'Sort descending' }).click(); await wait(800)
await closeMenu(); await wait(200)
const focused = () => page.evaluate(() => document.activeElement?.closest?.('th')?.innerText?.trim() ?? document.activeElement?.tagName)
check(await focused() === 'Pages', 'closing a head\'s menu puts focus back on it', await focused())
await undo()
check(view().sort.length === 0, 'so ⌘Z undoes what was done in the menu', view().sort)
await head('Pages').click(); await wait(300)
await page.locator('.bn-inline-content', { hasText: 'The line above' }).click(); await wait(400)
check(await menu.count() === 0 && await page.evaluate(() => !!document.activeElement?.closest?.('.ProseMirror')), 'a tap elsewhere keeps its focus there', await focused())
await head('Pages').click(); await wait(300)
await menu.getByRole('menuitem', { name: 'Hide in this view' }).click(); await wait(800)
check(await menu.count() === 0, 'hiding a column closes its menu, with the head gone')
check(await focused() === 'Name', 'a column just hidden hands focus to Name', await focused())
await undo()
check(order() === before, 'and ⌘Z brings it back', order())

// The edge: follows the pointer, saved once on release, one Undo, and a reload keeps it.
const start = (await box(head('Pages'))).width
await dragEdge('Pages', 80, { release: false })
const mid = (await box(head('Pages'))).width, line = await page.locator('.database-column-edge.is-active').count()
check(Math.abs(mid - start - 80) <= 2 && line === 1, 'a drag on the edge follows the pointer', { start, mid })
const unsaved = view().columns.find(c => c.id === 'pages').width
await shot('resize')
await page.mouse.up(); await wait(900)
check(unsaved === undefined && view().columns.find(c => c.id === 'pages').width === Math.round(mid), 'it saves on release, not on the way', { unsaved, saved: view().columns.find(c => c.id === 'pages').width })
check(await menu.count() === 0, 'and no menu opens')
check(Math.abs((await box(head('Pages'))).width - mid) <= 1, 'it stays where it was dropped')
await undo()
check(view().columns.find(c => c.id === 'pages').width === undefined && Math.abs((await box(head('Pages'))).width - start) <= 1, 'one Undo puts it back')
await dragEdge('Pages', 40, { release: false }); await page.keyboard.press('Escape'); await wait(200); await page.mouse.up(); await wait(500)
check(view().columns.find(c => c.id === 'pages').width === undefined && Math.abs((await box(head('Pages'))).width - start) <= 1, 'Esc during the drag cancels it')
await dragEdge('Pages', -500)
check(view().columns.find(c => c.id === 'pages').width === 60, 'it stops at its narrowest', view().columns.find(c => c.id === 'pages').width)
await dragEdge('Pages', 100)
await page.reload(); await wait(2500)
check(Math.abs((await box(head('Pages'))).width - 160) <= 1, 'a reload keeps it')
const name0 = (await box(page.locator('.database-th.is-title'))).width
await dragEdge('Name', 60)
check(view().nameWidth === Math.round(name0 + 60) && Math.abs((await box(page.locator('.database-th.is-title'))).width - name0 - 60) <= 1, 'Name resizes too', view().nameWidth)
await undo()
check(view().nameWidth === undefined, 'with one Undo')

// The head: a line where it would land, one Undo, and no menu.
await dragHead('Status', 'Pages', { release: false })
check(await page.locator('.database-column-drop').count() === 1 && await page.locator('.database-column-ghost').innerText() === 'Status' && await head('Status').evaluate(e => e.classList.contains('is-moving')), 'moving a head shows where it would land')
check(order() === before, 'nothing is saved on the way')
await shot('move')
await page.mouse.up(); await wait(900)
const moved = order()
check(moved !== before && moved.split(',').indexOf('status') === moved.split(',').indexOf('pages') - 1 && await shownOrder() === moved, 'dropped, it lands there', moved)
check(await menu.count() === 0, 'and no menu opens')
await undo()
check(order() === before, 'one Undo puts it back', order())
await dragHead('Status', 'Pages', { release: false }); await page.keyboard.press('Escape'); await wait(200); await page.mouse.up(); await wait(500)
check(order() === before && await page.locator('.database-column-drop').count() === 0, 'Esc during the drag cancels it')
await dragHead('Status', 'Owned', { after: true })
check(order().endsWith('status'), 'the far end works', order())
await undo()

// Across the frozen edge: only which columns are frozen changes.
await head('Kind').click(); await wait(300)
await menu.getByRole('menuitem', { name: 'Freeze up to column' }).click(); await wait(800); await closeMenu()
check(view().frozenThrough === 'kind', 'freezing is in the head\'s menu', view().frozenThrough)
await dragHead('Status', 'Due', { after: true })
check(view().frozenThrough === 'kind' && order().split(',').indexOf('status') > order().split(',').indexOf('kind'), 'a frozen column dragged past the edge leaves the frozen ones', [order(), view().frozenThrough])
check(!(await head('Status').evaluate(e => e.classList.contains('is-frozen'))), 'and scrolls')
await dragHead('Owned', 'Kind')
check(await head('Owned').evaluate(e => e.classList.contains('is-frozen')) && view().frozenThrough === 'kind', 'one dragged in among them joins them', [order(), view().frozenThrough])
const lefts = await page.locator('.database-th.is-frozen').evaluateAll(all => all.map(t => Math.round(t.getBoundingClientRect().left)))
const rights = await page.locator('.database-th.is-frozen').evaluateAll(all => all.map(t => Math.round(t.getBoundingClientRect().right)))
check(lefts.every((l, i) => i === 0 || Math.abs(l - rights[i - 1]) <= 1), 'the frozen ones stay side by side', [lefts, rights])
await shot('frozen')

// The page around it: a drag doesn't select the text beside it, and Esc on a head's menu only closes the menu.
check((await text()) === '', 'a drag leaves nothing selected on the page', await text())
await head('Pages').click(); await wait(300); await closeMenu()
check((await text()) === '', 'nor does Esc on its menu', await text())
check(errors.length === 0, 'no page errors', errors)
await context.close()

// At 390 it stays as it is.
const phone = await browser.newContext({ viewport: { width: 390, height: 844 }, hasTouch: true, serviceWorkers: 'block' })
const p = await phone.newPage()
await p.goto(`${base}/pages?page=books`); await p.waitForTimeout(2500)
const th = p.locator('.database-th', { hasText: 'Pages' }).first()
check(await p.locator('[data-column-head], .database-column-edge').count() === 0, 'at 390 a head is plain text')
await th.click(); await p.waitForTimeout(400)
check(await p.locator('.database-menu').count() === 0, 'and a tap opens nothing')
await phone.close()
// A frozen column beside a sub-item's toggle (R4-13): head and cells stay lined up, opened and scrolled.
execSync(`rm -f ${storePath} ${storePath}-wal ${storePath}-shm && node --no-warnings tests/evidence/sub-items/seed.ts ${storePath} on`, { stdio: 'ignore' })
const subs = await browser.newContext({ viewport: { width: 1280, height: 900 }, serviceWorkers: 'block' })
const u = await subs.newPage()
await u.goto(`${base}/pages?page=work`); await u.waitForTimeout(2500)
const firstColumn = u.locator('.database-th[data-column-head]').nth(1)
await firstColumn.click(); await u.waitForTimeout(300)
await u.locator('.database-menu').getByRole('menuitem', { name: 'Freeze up to column' }).click(); await u.waitForTimeout(700)
await u.keyboard.press('Escape'); await u.waitForTimeout(300)
await u.locator('.database-sub-toggle').first().click(); await u.waitForTimeout(500)
const lined = () => u.evaluate(() => { const th = document.querySelector('th.is-frozen').getBoundingClientRect(); const name = document.querySelector('th.is-title').getBoundingClientRect(); const tds = [...document.querySelectorAll('td.is-frozen')].map(t => t.getBoundingClientRect()); const toggles = [...document.querySelectorAll('.database-sub-toggle')].map(t => t.getBoundingClientRect()); return { head: th.left, off: tds.filter(t => Math.abs(t.left - th.left) > 1).length, cells: tds.length, inName: toggles.every(t => t.left >= name.left && t.right <= th.left), toggles: toggles.length } })
const opened = await lined()
check(opened.cells > 1 && opened.off === 0 && opened.inName && opened.toggles > 0, 'a frozen column lines up on a row with its toggle open', opened)
await u.locator('.database-scroll').first().evaluate(el => { el.scrollLeft = 200 }); await u.waitForTimeout(300)
const scrolled = await lined()
check(scrolled.off === 0 && scrolled.inName && Math.abs(scrolled.head - opened.head) <= 1, 'and scrolled sideways, it stays there', scrolled)
await subs.close()

// To-dos' columns are the app's own: the menu has only how this view shows them, and they resize like any others.
execSync(`rm -f ${storePath} ${storePath}-wal ${storePath}-shm && node --no-warnings tests/evidence/todo-card/seed-todo-card.ts ${storePath}`, { stdio: 'ignore' })
const todos = await browser.newContext({ viewport: { width: 1280, height: 900 }, serviceWorkers: 'block' })
const t = await todos.newPage()
await t.goto(`${base}/pages?page=todos`); await t.waitForTimeout(2500)
const todoHead = t.locator('.database-th[data-column-head]').nth(1)
const todoName = await todoHead.innerText()
await todoHead.click(); await t.waitForTimeout(400)
const todoWords = (await t.locator('.database-menu').innerText()).replace(/\s+/g, ' ')
check(todoWords.includes('Sort ascending') && todoWords.includes('Hide in this view') && !todoWords.includes('Type') && !todoWords.includes('Delete') && !todoWords.includes('Duplicate'), 'on To-dos the menu has only the view\'s own rows', todoWords)
await t.keyboard.press('Escape'); await t.waitForTimeout(300)
const tb = await todoHead.boundingBox()
await t.mouse.move(tb.x + tb.width - 3, tb.y + 10); await t.mouse.down(); await t.mouse.move(tb.x + tb.width + 37, tb.y + 10, { steps: 6 }); await t.waitForTimeout(100)
const tw = (await todoHead.boundingBox()).width
check(Math.abs(tw - tb.width - 40) <= 2, 'and its edge follows the pointer, with no + column to take up the slack', [todoName, tb.width, tw])
await t.keyboard.press('Escape'); await t.waitForTimeout(200); await t.mouse.up()
await todos.close()
console.log(fails ? `${fails} FAILED` : 'ALL PASS')
await browser.close()
process.exit(fails ? 1 : 0)
