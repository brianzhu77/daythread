// R2-1, R2-2, R2-3: a linked view shows the source's rows through its own settings, and removing it takes only itself.
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
const scenario = async (name, act) => {
  execSync(`rm -f ${storePath} && node tests/evidence/databases/seed-table.ts ${storePath}`, { stdio: 'ignore' })
  const context = await browser.newContext({ viewport: { width: 1280, height: 1000 } })
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
await scenario('Duplicate makes a linked view', async page => {
  await page.locator('.database-more-button').first().click()
  await menu(page).getByRole('menuitem', { name: 'Duplicate' }).click(); await wait(1800)
  const ws = store(), r = { blocks: dbBlocks(ws).length, databases: ws.pages.filter(p => p.database).length, tables: await page.locator('.database-table').count() }
  return { ...r, ok: r.blocks === 2 && r.databases === 2 && r.tables === 2 }
})
await browser.close()
console.log(failed ? `FAIL ${failed}` : 'PASS')
if (failed) process.exit(1)
