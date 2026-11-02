// Lead's review of #61 (R1-19 to R1-25), as checks: each scenario prints what happened and PASS or FAIL.
// Usage: node tests/evidence/databases/review-fixes.mjs <base-url> <store-path> <chromium|webkit> [scenario...]  (a throwaway store, reseeded for each scenario)
import * as pw from '@playwright/test'
import { execSync } from 'node:child_process'
if (!process.argv[2] || !process.argv[3] || !process.argv[4]) { console.error('Usage: node tests/evidence/databases/review-fixes.mjs <base-url> <store-path> <chromium|webkit> [scenario...]'); process.exit(2) }
const [base, storePath, engine, ...names] = process.argv.slice(2)
const reseed = () => execSync(`rm -f ${storePath} && node tests/evidence/databases/seed-table.ts ${storePath}`, { stdio: 'ignore' })
const store = () => JSON.parse(execSync(`sqlite3 ${storePath} "select data from workspace"`, { maxBuffer: 1 << 26 }).toString())
const browser = await pw[engine].launch({ headless: true })
const seededNotes = (() => { reseed(); return store().pages.find(p => p.id === 'dune').values?.notes ?? null })()
const wait = ms => new Promise(r => setTimeout(r, ms))
const state = () => { const ws = store(); const list = ws.pages.find(p => p.id === 'list'); const doc = JSON.parse(ws.pages.find(p => p.id === list.parentId)?.document ?? '[]'); return { home: list.database.homeBlockId, trashed: Boolean(list.trashedAt), parent: list.parentId, rowsLive: ws.pages.filter(p => p.parentId === 'list' && !p.trashedAt).length, types: doc.map(n => n.type).join(',') } }
async function open(opts = {}) {
  const context = await browser.newContext({ viewport: { width: 1280, height: 900 } })
  if (engine === 'chromium') await context.grantPermissions(['clipboard-read', 'clipboard-write'])
  const page = await context.newPage()
  page.on('dialog', d => d.accept().catch(() => {}))
  const errors = []; page.on('pageerror', e => errors.push(e.message))
  if (opts.delay) await page.route('**/_serverFn/**', async r => { if (r.request().method() === 'POST') await wait(opts.delay); await r.continue().catch(() => {}) })
  await page.goto(`${base}/pages?page=books`); await page.waitForTimeout(2500)
  return { context, page, errors }
}
const toasts = page => page.locator('[role=alert], [role=status]').allInnerTexts().then(t => [...new Set(t.map(x => x.trim().replace(/\s+/g, ' ')).filter(Boolean))].join(' | ').slice(0, 300))
const turnIntoPage = async page => { await page.locator('.database-more-button').first().click(); await page.locator('.database-menu').getByRole('menuitem', { name: 'Turn into page' }).click() }
const selectBlock = async page => { await page.getByText('Before the table').click(); await page.keyboard.press('Meta+ArrowRight'); await page.keyboard.press('ArrowDown'); await page.waitForTimeout(200) }
const offline = page => page.route('**/_serverFn/**', r => r.request().method() === 'POST' ? r.abort() : r.continue())
const scenarios = {
  // Turn into inline, then ⌘Z in the page: expected back to a card, database not trashed.
  async inlineUndo() {
    const { page, context, errors } = await open()
    await turnIntoPage(page); await wait(2500)
    await page.locator('.editor-page-card-row').first().hover(); await wait(300)
    await page.locator('.editor-card-menu .editor-row-more').first().click()
    await page.getByRole('menuitem', { name: 'Turn into inline' }).click(); await wait(2500)
    const inline = state()
    await page.getByText('After the table').click(); await page.keyboard.press('Meta+z'); await wait(2500)
    const r = { inline, afterUndo: state(), toast: await toasts(page), errors }
    await context.close(); return r
  },
  // Cut, paste in the same page, ⌘Z: expected not trashed.
  async cutPasteUndo() {
    const { page, context, errors } = await open()
    await selectBlock(page); await page.keyboard.press('Meta+x'); await wait(1500)
    const cut = state()
    await page.getByText('After the table').click(); await page.keyboard.press('Meta+ArrowRight'); await page.keyboard.press('Enter')
    await page.keyboard.press('Meta+v'); await wait(2500)
    const pasted = state()
    await page.keyboard.press('Meta+z'); await wait(2500)
    const undone = state(); const toast = await toasts(page)
    const undo = page.getByRole('button', { name: 'Undo' }).first()
    let afterToastUndo = null
    if (await undo.count()) { await undo.click(); await wait(2500); afterToastUndo = state() }
    const r = { cut, pasted, undone, toast, afterToastUndo, errors }
    await context.close(); return r
  },
  // Turn into page while offline, app closed, reopened online: expected a full page, nothing trashed.
  async offlineTurnReload() {
    const { page, context, errors } = await open()
    await offline(page)
    await turnIntoPage(page); await wait(2500)
    const offlineStatus = await page.locator('.editor-save-line').innerText()
    await page.unroute('**/_serverFn/**')
    await page.reload(); await wait(5000)
    const r = { offlineStatus, after: state(), toast: await toasts(page), errors }
    await context.close(); return r
  },
  // Cut while offline, app closed, reopened online: expected a full page, nothing trashed.
  async offlineCutReload() {
    const { page, context, errors } = await open()
    await offline(page)
    await selectBlock(page); await page.keyboard.press('Meta+x'); await wait(2500)
    await page.unroute('**/_serverFn/**')
    await page.reload(); await wait(5000)
    const r = { after: state(), toast: await toasts(page), errors }
    await context.close(); return r
  },
  // Checkbox ticked then unticked within a round trip: expected unticked, no notice.
  async doubleTick() {
    const { page, context, errors } = await open({ delay: 400 })
    const box = page.locator('.database-row[data-row=ubik] .property-checkbox')
    await box.click(); await wait(100); await box.click(); await wait(3000)
    const r = { owned: store().pages.find(p => p.id === 'ubik').values?.owned ?? null, shown: await box.getAttribute('aria-checked'), toast: await toasts(page), errors }
    await context.close(); return r
  },
  // One text cell changed twice within a round trip: expected the second value, no notice.
  async doubleEdit() {
    const { page, context, errors } = await open({ delay: 400 })
    const cell = page.locator('.database-row[data-row=dune] .database-td.is-text .database-cell')
    await cell.click(); await wait(150); await page.keyboard.type(' one'); await page.keyboard.press('Enter'); await wait(100)
    await cell.click(); await wait(150); await page.keyboard.type(' two'); await page.keyboard.press('Enter'); await wait(3000)
    const r = { notes: store().pages.find(p => p.id === 'dune').values?.notes, toast: await toasts(page), errors }
    await context.close(); return r
  },
  // Two columns hidden within a round trip: expected both hidden.
  async twoToggles() {
    const { page, context, errors } = await open({ delay: 400 })
    await page.locator('.database-more-button').first().click()
    await page.locator('.database-menu').getByRole('menuitem', { name: 'Properties' }).click(); await wait(200)
    await page.getByRole('checkbox', { name: 'Show Genre' }).click(); await wait(150)
    await page.getByRole('checkbox', { name: 'Show Tags' }).click(); await wait(3000)
    const ws = store(), list = ws.pages.find(p => p.id === 'list')
    const names = list.database.views[0].columns.map(c => list.database.properties.find(p => p.id === c.id)?.name)
    const r = { columns: names, errors }
    await context.close(); return r
  },
  // Two new options made in one Multi-select editor within a round trip: expected both kept, both on the row.
  async twoOptions() {
    const { page, context, errors } = await open({ delay: 400 })
    await page.locator('.database-row[data-row=emma] .database-td.is-multiSelect .database-cell').click(); await wait(300)
    await page.keyboard.type('aa'); await page.keyboard.press('Enter'); await wait(120)
    await page.keyboard.type('bb'); await page.keyboard.press('Enter'); await wait(120)
    await page.keyboard.press('Escape'); await wait(3500)
    const ws = store(), list = ws.pages.find(p => p.id === 'list'), tags = list.database.properties.find(p => p.name === 'Tags')
    const emma = ws.pages.find(p => p.id === 'emma')
    const r = { options: tags.options.map(o => o.name), emma: (emma.values?.tags ?? []).map(id => tags.options.find(o => o.id === id)?.name ?? `?${id}`), toast: await toasts(page), errors }
    await context.close(); return r
  },
  // + New when the table already shows its cap: expected the new row in view with its name open.
  async newPastCap() {
    execSync(`node tests/evidence/databases/seed-30-rows.ts ${storePath}`, { stdio: 'ignore' })
    const { page, context, errors } = await open()
    const before = await page.locator('.database-row').count()
    await page.locator('.database-new').first().click(); await wait(1500)
    const ws = store()
    const inView = await page.locator('.database-row').last().evaluate(e => { const r = e.getBoundingClientRect(); return r.top >= 0 && r.bottom <= innerHeight })
    const r = { inView, rowsBefore: before, rowsDrawn: await page.locator('.database-row').count(), rowsStored: ws.pages.filter(p => p.parentId === 'list' && !p.trashedAt).length, editorOpen: await page.locator('.property-popover').count(), toast: await toasts(page), errors }
    await context.close(); return r
  },
  // Space on a Text cell, then a click away: expected the value unchanged.
  async spaceOnCell() {
    const { page, context, errors } = await open()
    await page.locator('.database-row[data-row=dune] .database-td.is-text .database-cell').focus()
    await page.keyboard.press('Space'); await wait(400)
    const field = await page.locator('.property-popover textarea').inputValue().catch(() => null)
    await page.getByText('After the table').click(); await wait(1500)
    const r = { field, notes: store().pages.find(p => p.id === 'dune').values?.notes ?? null, was: seededNotes, errors }
    await context.close(); return r
  },
  // Home block deleted, toast Undo pressed after going to another page: expected back.
  async toastUndoAfterLeaving() {
    const { page, context, errors } = await open()
    await selectBlock(page); await page.keyboard.press('Backspace'); await wait(1500)
    const deleted = state(); const toast = await toasts(page)
    await page.getByRole('link', { name: 'Films' }).first().click(); await wait(500)
    const undo = page.getByRole('button', { name: 'Undo' }).first()
    const hasUndo = await undo.count()
    if (hasUndo) { await undo.click(); await wait(2500) }
    const r = { deleted, toast, hasUndo, after: state(), errors }
    await context.close(); return r
  },
  // Home block deleted, a word typed, toast Undo: expected the database back.
  async toastUndoAfterTyping() {
    const { page, context, errors } = await open()
    await selectBlock(page); await page.keyboard.press('Backspace'); await wait(1500)
    await page.getByText('After the table').click(); await page.keyboard.press('Meta+ArrowRight'); await page.keyboard.type(' more words'); await wait(900)
    const undo = page.getByRole('button', { name: 'Undo' }).first()
    const hasUndo = await undo.count()
    if (hasUndo) { await undo.click(); await wait(2500) }
    const r = { hasUndo, after: state(), kept: store().pages.find(p => p.id === 'books').document.includes('more words'), errors }
    await context.close(); return r
  },
  // The truer offline: the app closes while still offline (no save can leave), reopens, then the network is back.
  async offlineTurnStillOffline() {
    const { page, context, errors } = await open()
    await offline(page)
    await turnIntoPage(page); await wait(2500)
    await page.reload(); await wait(1500)
    const whileOffline = state()
    await page.unroute('**/_serverFn/**'); await wait(9000)
    const r = { whileOffline, after: state(), toast: await toasts(page), errors }
    await context.close(); return r
  },
  // Text typed in a new database's inline title, then leave with a link click: expected kept.
  async titleThenLeave() {
    const { page, context, errors } = await open()
    const t = page.locator('.database-title').first()
    await t.click(); await page.keyboard.press('Meta+A'); await page.keyboard.type('Renamed list')
    await page.getByRole('link', { name: 'Films' }).first().click(); await wait(1500)
    const r = { title: store().pages.find(p => p.id === 'list').title, errors }
    await context.close(); return r
  },
  // `/` Database, then ⌘Z while it's empty: gone quietly, nothing left behind; ⌘⇧Z brings it back.
  async slashThenUndo() {
    const { page, context, errors } = await open()
    await page.getByText('After the table').click(); await page.keyboard.press('Meta+ArrowRight'); await page.keyboard.press('Enter')
    await page.keyboard.type('/database'); await wait(400); await page.keyboard.press('Enter'); await wait(1500)
    const made = store().pages.find(p => p.database && p.id !== 'list' && p.id !== 'films')
    await page.getByText('After the table').click(); await page.keyboard.press('Meta+z'); await wait(2000)
    const toast = await toasts(page), undone = store().pages.find(p => p.id === made?.id)
    const r = { made: Boolean(made), trashed: Boolean(undone?.trashedAt), toast, errors }
    await context.close(); return r
  },
  // Cut, then ⌘Z with no paste: the table is back where it was, at home.
  async cutThenUndo() {
    const { page, context, errors } = await open()
    await selectBlock(page); await page.keyboard.press('Meta+x'); await wait(1500)
    const cut = state()
    await page.getByText('After the table').click(); await page.keyboard.press('Meta+z'); await wait(2500)
    const r = { cut, after: state(), tables: await page.locator('.database-table').count(), errors }
    await context.close(); return r
  },
  // A cell opened far down the page: the page stays where it is (its field took the focus before it was placed).
  async cellOnScrolledPage() {
    execSync(`node tests/evidence/databases/seed-30-rows.ts ${storePath}`, { stdio: 'ignore' })
    const { page, context, errors } = await open()
    const cell = page.locator('.database-row').nth(20).locator('.database-td.is-number .database-cell')
    await cell.scrollIntoViewIfNeeded(); await wait(200)
    const before = await page.evaluate(() => [scrollY, document.querySelector('.database-scroll').scrollLeft])
    await cell.click(); await wait(500)
    const after = await page.evaluate(() => [scrollY, document.querySelector('.database-scroll').scrollLeft])
    const r = { before, after, moved: after[0] - before[0], sideways: after[1] - before[1], editorOpen: await page.locator('.property-popover').count(), errors }
    await context.close(); return r
  },
  // A filter's value typed, then + Add filter at once (Jazz, native): the value stays and the second rule is added.
  async filterValueThenAdd() {
    const { page, context, errors } = await open({ delay: 400 })
    await page.locator('.database-more-button').first().click()
    await page.locator('.database-menu').getByRole('button', { name: 'Filter' }).click(); await wait(200)
    await page.locator('.database-menu').getByText('+ Add filter').click(); await wait(800)
    await page.locator('.database-rule input').first().fill('Dune'); await wait(100)
    await page.locator('.database-menu').getByText('+ Add filter').click(); await wait(3000)
    const r = { filter: store().pages.find(p => p.id === 'list').database.views[0].filter, errors }
    await context.close(); return r
  },
  // Two filters added within a round trip: both kept.
  async twoFilters() {
    const { page, context, errors } = await open({ delay: 400 })
    await page.locator('.database-more-button').first().click()
    await page.locator('.database-menu').getByRole('button', { name: 'Filter' }).click(); await wait(200)
    const add = page.getByRole('menuitem', { name: '+ Add filter' })
    await add.click(); await wait(100); await add.click(); await wait(3000)
    const r = { filters: store().pages.find(p => p.id === 'list').database.views[0].filter.length, errors }
    await context.close(); return r
  },
}
const noTrash = s => !s.trashed && s.rowsLive === 3
const clean = r => !r.errors.length
const checks = {
  inlineUndo: r => noTrash(r.afterUndo) && r.afterUndo.home === null && !/moved to Trash/.test(r.toast),
  cutPasteUndo: r => noTrash(r.cut) && noTrash(r.pasted) && r.pasted.home !== null && noTrash(r.undone) && r.undone.home === null && !/moved to Trash/.test(r.toast),
  offlineTurnReload: r => noTrash(r.after) && r.after.home === null,
  offlineCutReload: r => noTrash(r.after) && r.after.home === null,
  offlineTurnStillOffline: r => noTrash(r.after) && r.after.home === null,
  doubleTick: r => !r.owned && r.shown === 'false' && !/changed elsewhere/.test(r.toast),
  doubleEdit: r => /one two$/.test(r.notes ?? '') && !/changed elsewhere/.test(r.toast),
  twoToggles: r => !r.columns.includes('Genre') && !r.columns.includes('Tags'),
  twoOptions: r => ['aa', 'bb'].every(x => r.options.includes(x) && r.emma.includes(x)) && !/not saved/.test(r.toast),
  newPastCap: r => r.rowsDrawn === r.rowsStored && r.rowsDrawn > r.rowsBefore && r.editorOpen === 1 && r.inView,
  cellOnScrolledPage: r => r.moved === 0 && r.sideways === 0 && r.editorOpen === 1,
  spaceOnCell: r => r.field === (r.was ?? '') && (r.notes ?? null) === (r.was ?? null),
  toastUndoAfterLeaving: r => r.deleted.trashed && r.hasUndo && noTrash(r.after) && r.after.types.includes('database'),
  toastUndoAfterTyping: r => r.hasUndo && noTrash(r.after) && r.after.types.includes('database') && r.kept,
  titleThenLeave: r => r.title === 'Renamed list',
  slashThenUndo: r => r.made && r.trashed && !/moved to Trash/.test(r.toast),
  cutThenUndo: r => r.cut.home === null && noTrash(r.after) && r.after.home !== null && r.tables === 1,
  twoFilters: r => r.filters === 2,
  filterValueThenAdd: r => r.filter.length === 2 && r.filter[0].value === 'Dune',
}
let failed = 0
for (const name of names.length ? names : Object.keys(scenarios)) {
  reseed()
  let r
  try { r = await scenarios[name]() } catch (e) { r = { threw: e.message.split('\n')[0], errors: ['threw'] } }
  const ok = !r.threw && clean(r) && checks[name](r)
  if (!ok) failed++
  console.log(ok ? 'PASS' : 'FAIL', name, JSON.stringify(r))
}
await browser.close()
console.log(failed ? `FAIL ${failed}` : 'PASS')
if (failed) process.exit(1)
