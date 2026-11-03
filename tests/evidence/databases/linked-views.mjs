// R2-1, R2-2, R2-3, R2-14: a linked view shows the source's rows through its own settings, and removing it takes only itself.
// Usage: node tests/evidence/databases/linked-views.mjs <base-url> <store-path> [chromium|webkit]  (a throwaway SQLite file, reseeded for each scenario)
import * as pw from '@playwright/test'
import { execSync } from 'node:child_process'
if (!process.argv[2] || !process.argv[3]) { console.error('Usage: node tests/evidence/databases/linked-views.mjs <base-url> <store-path> [chromium|webkit]'); process.exit(2) }
const [base, storePath] = process.argv.slice(2), engine = process.argv[4] ?? 'chromium'
const store = () => JSON.parse(execSync(`sqlite3 ${storePath} "select data from workspace"`, { maxBuffer: 1 << 26 }).toString())
const wait = ms => new Promise(r => setTimeout(r, ms))
const browser = await pw[engine].launch({ headless: true })
const dbBlocks = ws => JSON.parse(ws.pages.find(p => p.id === 'books').document).filter(n => n.type === 'database')
const list = ws => ws.pages.find(p => p.id === 'list')
const notices = page => page.locator('[role=alert], [role=status]').allInnerTexts().then(t => t.join(' | ').replace(/\s+/g, ' '))
let failed = 0
const scenario = async (name, act, options = { viewport: { width: 1280, height: 1000 } }) => {
  execSync(`rm -f ${storePath} && node tests/evidence/databases/seed-table.ts ${storePath}`, { stdio: 'ignore' })
  const context = await browser.newContext(options)
  const page = await context.newPage(), errors = []
  page.on('pageerror', e => errors.push(e.message))
  await page.goto(`${base}/pages?page=books`); await wait(2500)
  let r
  try { r = await act(page) } catch (e) { r = { ok: false, threw: e.message.split('\n').slice(0, 3).join(' ') } }
  const ok = r.ok && !errors.length
  if (!ok) failed++
  console.log(ok ? 'PASS' : 'FAIL', name, JSON.stringify({ ...r, errors }))
  await context.close()
}
// Copy the home block and paste it after the last line: a linked view.
const makeLinked = async page => {
  await page.getByText('Before the table').click(); await page.keyboard.press('Meta+ArrowRight'); await page.keyboard.press('ArrowDown'); await wait(200)
  await page.keyboard.press('Meta+c'); await wait(200)
  await page.getByText('After the table').click(); await page.keyboard.press('Meta+ArrowRight'); await page.keyboard.press('Enter')
  await page.keyboard.press('Meta+v'); await wait(2000)
}
const second = page => page.locator('.database-block').nth(1)
const menu = page => page.locator('.database-menu')

await scenario('copy and paste makes a linked view, not a second database', async page => {
  const before = store().pages.filter(p => p.database).length
  await makeLinked(page)
  const ws = store(), blocks = dbBlocks(ws)
  const r = { databases: ws.pages.filter(p => p.database).length - before, blocks: blocks.length, tables: await page.locator('.database-table').count(), source: await second(page).locator('.database-source').innerText(), home: list(ws).database.homeBlockId, view: Boolean(blocks[1]?.props.view) }
  return { ...r, ok: r.databases === 0 && r.blocks === 2 && r.tables === 2 && /from Reading list · in Books/.test(r.source) && r.home === 'home' && r.view }
})
await scenario('rows and values are shared, both ways, without a reload', async page => {
  await makeLinked(page)
  const cell = page.locator('.database-block').nth(1).locator('.database-row[data-row=dune] .database-td.is-text .database-cell')
  await cell.click(); await wait(300); await page.keyboard.press('Meta+a'); await page.keyboard.type('Shared'); await page.keyboard.press('Enter'); await wait(1200)
  const home = await page.locator('.database-block').first().locator('.database-row[data-row=dune] .database-td.is-text').innerText()
  await second(page).locator('.database-new').click(); await wait(600); await page.keyboard.type('Added there'); await page.keyboard.press('Enter'); await wait(1200)
  const rowsHome = await page.locator('.database-block').first().locator('.database-row').count()
  const r = { home, rowsHome, stored: store().pages.find(p => p.id === 'dune').values.notes }
  return { ...r, ok: r.home.includes('Shared') && r.stored === 'Shared' && r.rowsHome === 4 }
})
await scenario('its filter, columns and title stay its own', async page => {
  await makeLinked(page)
  const homeView = JSON.stringify(list(store()).database.views)
  await second(page).locator('.database-more-button').click()
  await menu(page).getByRole('button', { name: 'Filter' }).click(); await menu(page).getByText('+ Add filter').click(); await wait(400)
  await page.locator('.database-rule input').first().fill('Dune'); await page.keyboard.press('Enter'); await wait(400)
  await menu(page).getByRole('button', { name: 'Back' }).click(); await wait(100)
  await menu(page).getByRole('menuitem', { name: 'Properties' }).click(); await page.getByRole('checkbox', { name: 'Show Genre' }).click(); await wait(300)
  await page.keyboard.press('Escape'); await wait(200)
  const title = second(page).locator('.database-title'); await title.click(); await title.fill('Reading this week'); await page.getByText('Before the table').click(); await wait(1800)
  const ws = store(), linked = JSON.parse(dbBlocks(ws)[1].props.view)
  const r = { rowsLinked: await second(page).locator('.database-row').count(), rowsHome: await page.locator('.database-block').first().locator('.database-row').count(), sourceSame: JSON.stringify(list(ws).database.views) === homeView, sourceTitle: list(ws).title, linkedTitle: linked.title, filter: linked.filter.length, genreHidden: !linked.columns.some(c => c.id === 'genre') }
  await page.reload(); await wait(2500)
  r.afterReload = await second(page).locator('.database-row').count(); r.titleAfter = await second(page).locator('.database-title').inputValue()
  return { ...r, ok: r.rowsLinked === 1 && r.rowsHome === 3 && r.sourceSame && r.sourceTitle === 'Reading list' && r.linkedTitle === 'Reading this week' && r.filter === 1 && r.genreHidden && r.afterReload === 1 && r.titleAfter === 'Reading this week' }
})
await scenario('Remove this view takes only the view, with Undo', async page => {
  await makeLinked(page)
  await second(page).locator('.database-more-button').click()
  await menu(page).getByRole('menuitem', { name: 'Remove this view' }).click(); await wait(1800)
  const ws = store(), notice = await notices(page)
  const r = { blocks: dbBlocks(ws).length, trashed: Boolean(list(ws).trashedAt), rows: ws.pages.filter(p => p.parentId === 'list' && !p.trashedAt).length, notice }
  await page.getByRole('button', { name: 'Undo' }).first().click(); await wait(1800)
  r.afterUndo = dbBlocks(store()).length; r.tables = await page.locator('.database-table').count()
  return { ...r, ok: r.blocks === 1 && !r.trashed && r.rows === 3 && /View removed · Reading list is still in Books/.test(r.notice) && r.afterUndo === 2 && r.tables === 2 }
})
await scenario('Backspace, and Cmd-Z after making one, take only the view', async page => {
  await makeLinked(page)
  await page.keyboard.press('Meta+z'); await wait(1800)
  const undone = store(), first = { blocks: dbBlocks(undone).length, trashed: Boolean(list(undone).trashedAt), rows: undone.pages.filter(p => p.parentId === 'list' && !p.trashedAt).length }
  await page.keyboard.press('Meta+Shift+z'); await wait(1500)
  const again = dbBlocks(store()).length
  return { first, again, ok: first.blocks === 1 && !first.trashed && first.rows === 3 && again === 2 }
})
await scenario('the source in Trash: one line, nothing to edit, and Restore', async page => {
  await makeLinked(page)
  await page.getByText('Before the table').click(); await page.keyboard.press('Meta+ArrowRight'); await page.keyboard.press('ArrowDown'); await wait(200)
  await page.keyboard.press('Backspace'); await wait(1800)
  const ws = store(), r = { trashed: Boolean(list(ws).trashedAt), line: await page.locator('.database-block .database-empty').first().innerText().catch(() => ''), tables: await page.locator('.database-table').count() }
  await page.locator('.database-block .database-empty').getByRole('button', { name: 'Restore' }).click(); await wait(1800)
  const after = store()
  r.restored = !list(after).trashedAt; r.rows = after.pages.filter(p => p.parentId === 'list' && !p.trashedAt).length; r.tablesAfter = await page.locator('.database-table').count()
  return { ...r, ok: r.trashed && /Reading list is in Trash · Restore/.test(r.line) && r.tables === 0 && r.restored && r.rows === 3 && r.tablesAfter >= 1 }
})
await scenario('`/` Database: Enter is New database, typing filters, picking makes a linked view', async page => {
  const line = async () => { await page.getByText('After the table').click(); await page.keyboard.press('Meta+ArrowRight'); await page.keyboard.press('Enter'); await page.keyboard.type('/database'); await wait(400); await page.keyboard.press('Enter'); await wait(400) }
  await line()
  const shown = await page.locator('.database-picker [role=menuitem]').allInnerTexts()
  await page.keyboard.type('read'); await wait(200)
  const filtered = await page.locator('.database-picker [role=menuitem]').allInnerTexts()
  await page.keyboard.press('Enter'); await wait(1800)
  const ws = store()
  const r = { shown: shown.length, filtered: filtered.map(t => t.replace(/\s+/g, ' ')), blocks: dbBlocks(ws).length, databases: ws.pages.filter(p => p.database).length, picked: dbBlocks(ws)[1]?.props.pageId }
  return { ...r, ok: r.shown >= 3 && r.filtered.length === 1 && /Reading list/.test(r.filtered[0]) && r.blocks === 2 && r.databases === 2 && r.picked === 'list' }
})
await scenario('its layout and grouping are its own too (R2-16: they survive its edits)', async page => {
  await makeLinked(page)
  const homeView = JSON.stringify(list(store()).database.views)
  await second(page).locator('.database-more-button').click()
  await menu(page).getByRole('menuitem', { name: 'Layout' }).click(); await wait(200)
  await menu(page).getByText('Board', { exact: true }).click(); await wait(300)
  // More than one property can make the columns: it asks which.
  await menu(page).getByRole('menuitem', { name: /^Status/ }).first().click(); await wait(1800)
  await page.keyboard.press('Escape'); await wait(200)
  const ws = store(), linked = JSON.parse(dbBlocks(ws)[1].props.view)
  const r = { layout: linked.layout, sourceSame: JSON.stringify(list(ws).database.views) === homeView, boards: await page.locator('.database-board').count(), tables: await page.locator('.database-table').count(), source: await second(page).locator('.database-source').count() }
  return { ...r, ok: r.layout === 'board' && r.sourceSame && r.boards === 1 && r.tables === 1 && r.source === 1 }
})
await scenario('"this page\'s day" off a day page hides nothing, writes nothing (R2-4)', async page => {
  await makeLinked(page)
  const view = JSON.parse(dbBlocks(store())[1].props.view)
  await second(page).locator('.database-more-button').click()
  await menu(page).getByRole('button', { name: 'Filter' }).click(); await menu(page).getByText('+ Add filter').click(); await wait(400)
  await page.locator('.database-rule select[aria-label=Property]').first().selectOption({ label: 'Due' }); await wait(300)
  await page.locator('.database-rule select[aria-label=Condition]').first().selectOption('is'); await wait(300)
  await page.locator('.database-rule select[aria-label=Day]').first().selectOption('pageDate'); await wait(800)
  await page.keyboard.press('Escape'); await wait(1500)
  const stored = JSON.parse(dbBlocks(store())[1].props.view).filter
  const r = { view: view.filter.length, stored, rows: await second(page).locator('.database-row').count(), chip: await second(page).locator('.database-filter-chip').count() }
  return { ...r, ok: r.stored.length === 1 && r.stored[0].value?.relative === 'pageDate' && r.rows === 3 && r.chip === 1 }
})
await scenario('a new row its filter hides says so, and stays in the source (R2-14)', async page => {
  await makeLinked(page)
  await second(page).locator('.database-more-button').click()
  await menu(page).getByRole('button', { name: 'Filter' }).click(); await menu(page).getByText('+ Add filter').click(); await wait(400)
  await page.locator('.database-rule input').first().fill('Dune'); await page.keyboard.press('Enter'); await wait(400)
  await page.keyboard.press('Escape'); await wait(1500)
  await second(page).locator('.database-new').click(); await wait(1500)
  const r = { notice: await notices(page), linked: await second(page).locator('.database-row').count(), home: await page.locator('.database-block').first().locator('.database-row').count(), show: await page.getByRole('button', { name: 'Show' }).count(), rows: store().pages.filter(p => p.parentId === 'list' && !p.trashedAt).length }
  return { ...r, ok: /Added · hidden by this view's filter/.test(r.notice) && r.linked === 1 && r.home === 4 && r.show >= 1 && r.rows === 4 }
})
await scenario('Duplicate makes a linked view', async page => {
  await page.locator('.database-more-button').first().click()
  await menu(page).getByRole('menuitem', { name: 'Duplicate' }).click(); await wait(1800)
  const ws = store(), r = { blocks: dbBlocks(ws).length, databases: ws.pages.filter(p => p.database).length, tables: await page.locator('.database-table').count() }
  return { ...r, ok: r.blocks === 2 && r.databases === 2 && r.tables === 2 }
})
const phone = { viewport: { width: 390, height: 844 }, hasTouch: true, isMobile: true }
await scenario('at 390: it draws, its source line opens the source, and its menu removes only the view', async page => {
  await makeLinked(page)
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth)
  const r = { overflow, rows: await second(page).locator('.database-row').count(), source: await second(page).locator('.database-source').innerText() }
  await second(page).locator('.database-more-button').click(); await wait(300)
  r.menu = await menu(page).getByRole('menuitem', { name: 'Remove this view' }).isVisible()
  await menu(page).getByRole('menuitem', { name: 'Remove this view' }).click(); await wait(1800)
  const ws = store()
  r.blocks = dbBlocks(ws).length; r.trashed = Boolean(list(ws).trashedAt); r.notice = await notices(page)
  await page.getByRole('button', { name: 'Undo' }).first().click(); await wait(1800)
  r.afterUndo = dbBlocks(store()).length
  await second(page).locator('.database-source').click(); await wait(1500)
  r.url = page.url()
  return { ...r, ok: r.overflow <= 0 && r.rows === 3 && /from Reading list/.test(r.source) && r.menu && r.blocks === 1 && !r.trashed && /View removed/.test(r.notice) && r.afterUndo === 2 && /page=list/.test(r.url) }
}, phone)
await scenario('at 390: `/` Database lists what exists on screen, and picking one makes a linked view', async page => {
  await page.getByText('After the table').click(); await page.keyboard.press('Meta+ArrowRight'); await page.keyboard.press('Enter'); await page.keyboard.type('/database'); await wait(400); await page.keyboard.press('Enter'); await wait(500)
  const box = await page.locator('.database-picker').boundingBox(), width = page.viewportSize().width
  const r = { box, shown: await page.locator('.database-picker [role=menuitem]').count() }
  await page.locator('.database-picker [role=menuitem]', { hasText: 'Reading list' }).click(); await wait(1800)
  r.blocks = dbBlocks(store()).length
  return { ...r, ok: box.x >= 0 && box.x + box.width <= width && r.shown >= 3 && r.blocks === 2 }
}, phone)
await browser.close()
console.log(failed ? `FAIL ${failed}` : 'PASS')
if (failed) process.exit(1)
