// R2-1, R2-8 to R2-11: To-dos as a source, on a copy of his data. A view of it in a page; his real tasks as rows; an edit is
// the task's own; opening goes to the line; + New asks for words and lands on the day's page.
// Usage: node tests/evidence/databases/todos-source.mjs <base-url> <store-path> <his-copy-path> [chromium|webkit]  (the store is overwritten for each scenario)
import * as pw from '@playwright/test'
import { execSync } from 'node:child_process'
if (!process.argv[4]) { console.error('Usage: node tests/evidence/databases/todos-source.mjs <base-url> <store-path> <his-copy-path> [chromium|webkit]'); process.exit(2) }
const [base, storePath, copy] = process.argv.slice(2), engine = process.argv[5] ?? 'chromium'
const store = () => JSON.parse(execSync(`sqlite3 ${storePath} "select data from workspace"`, { maxBuffer: 1 << 26 }).toString())
const wait = ms => new Promise(r => setTimeout(r, ms))
const browser = await pw[engine].launch({ headless: true })
const today = new Date().toLocaleDateString('en-CA')
const notices = page => page.locator('[role=alert], [role=status]').allInnerTexts().then(t => t.join(' | ').replace(/\s+/g, ' '))
const view = page => page.locator('.database-block').filter({ hasText: 'from To-dos' }).first()
let failed = 0
const scenario = async (name, act, options = { viewport: { width: 1280, height: 1000 } }) => {
  if (process.env.ONLY && !new RegExp(process.env.ONLY).test(name)) return
  execSync(`rm -f ${storePath} ${storePath}-wal ${storePath}-shm && cp ${copy} ${storePath} && node --no-warnings tests/evidence/databases/seed-table.ts ${storePath}`, { stdio: 'ignore' })
  const context = await browser.newContext(options)
  const page = await context.newPage(), errors = []
  page.on('pageerror', e => errors.push(e.message))
  await page.goto(`${base}/pages?page=books`); await wait(2500)
  let r
  try { r = await act(page, context) } catch (e) { r = { ok: false, threw: e.message.split('\n').slice(0, 3).join(' '), url: page.url(), body: (await page.locator('body').innerText().catch(() => '')).replace(/\s+/g, ' ').slice(0, 400) } }
  const ok = r.ok && !errors.length
  if (!ok) failed++
  console.log(ok ? 'PASS' : 'FAIL', name, JSON.stringify({ ...r, errors }))
  await context.close()
}
const makeView = async page => {
  await page.getByText('After the table').click(); await page.keyboard.press('Meta+ArrowRight'); await wait(150); await page.keyboard.press('Enter'); await page.keyboard.type('/database'); await wait(400); await page.keyboard.press('Enter'); await wait(500)
  await page.locator('.database-picker [role=menuitem]', { hasText: 'To-dos' }).click(); await wait(1800)
}
const openTasks = ws => ws.tasks.filter(t => t.status === 'open' && !t.paused && t.title.trim())
const rowOf = (page, taskId) => view(page).locator(`.database-row[data-row="todo:${taskId}"]`)

await scenario('R2-1, R2-8: the picker lists it; the first view is his open to-dos, each once, with no + or Add property', async page => {
  await makeView(page)
  const ws = store(), open = openTasks(ws)
  const rows = await view(page).locator('.database-row').evaluateAll(e => e.map(x => x.getAttribute('data-row')))
  const r = { rows: rows.length, expected: open.length, once: new Set(rows).size === rows.length, same: open.every(t => rows.includes(`todo:${t.id}`)), add: await view(page).locator('.database-th.is-add').count(), chip: await view(page).locator('.database-filter-chip').count(), databases: ws.pages.filter(p => p.database).length, source: await view(page).locator('.database-source').innerText() }
  await view(page).locator('.database-more-button').click(); await wait(200)
  await page.locator('.database-menu').getByRole('menuitem', { name: 'Properties' }).click(); await wait(200)
  r.addInMenu = await page.locator('.database-menu').getByText('+ Add property').count()
  await page.keyboard.press('Escape')
  return { ...r, ok: r.rows === r.expected && r.expected > 0 && r.once && r.same && r.add === 0 && r.chip === 1 && r.addInMenu === 0 && r.databases === 2 && /from To-dos/.test(r.source) }
})
await scenario('R2-8: clearing the chip shows every task with words; his blank line is not a row', async page => {
  await makeView(page)
  await view(page).locator('.database-filter-chip').first().click(); await wait(300)
  const clear = page.locator('.database-menu').getByRole('button', { name: /Remove|Delete|Clear/ }).first()
  await clear.click(); await wait(600); await page.keyboard.press('Escape'); await wait(1500)
  const more = view(page).locator('.database-more')
  while (await more.count()) { await more.first().click(); await wait(200) }
  const ws = store(), words = ws.tasks.filter(t => t.title.trim())
  const r = { rows: await view(page).locator('.database-row').count(), withWords: words.length, blank: ws.tasks.length - words.length }
  return { ...r, ok: r.rows === r.withWords && r.blank >= 1 }
})
await scenario('R2-9: a tick is the same tick: ticked on its task, Undo puts it back', async page => {
  await makeView(page)
  const task = openTasks(store())[0]
  await rowOf(page, task.id).locator('.property-checkbox').click(); await wait(1500)
  const r = { status: store().tasks.find(t => t.id === task.id).status, notice: await notices(page) }
  await page.getByRole('button', { name: 'Undo' }).first().click(); await wait(1500)
  r.afterUndo = store().tasks.find(t => t.id === task.id).status
  return { ...r, ok: r.status === 'done' && /Done/.test(r.notice) && r.afterUndo === 'open' }
})
await scenario('R2-9: Cancelled and Paused through the status cell are the same commands', async page => {
  await makeView(page)
  const task = openTasks(store())[0]
  const pick = async name => { await rowOf(page, task.id).locator('.database-td.is-status').click(); await wait(300); await page.getByRole('option', { name }).or(page.getByRole('menuitem', { name })).or(page.getByRole('menuitemradio', { name })).first().click(); await wait(1500) }
  await pick('Paused')
  const paused = store().tasks.find(t => t.id === task.id).paused, n1 = await notices(page)
  await view(page).locator('.database-filter-chip').first().click(); await wait(300)
  await page.locator('.database-menu').getByRole('button', { name: /Remove|Delete|Clear/ }).first().click(); await wait(600); await page.keyboard.press('Escape'); await wait(1200)
  await pick('Cancelled')
  const cancelled = store().tasks.find(t => t.id === task.id).status, n2 = await notices(page)
  const box = await rowOf(page, task.id).locator('.property-checkbox').isDisabled()
  return { paused, cancelled, box, n1, n2, ok: paused === true && /Not today/.test(n1) && cancelled === 'cancelled' && /Cancelled/.test(n2) && box }
})
await scenario('R2-9: a rename changes the line on its page, with that page open in another tab, and no false notice', async (page, context) => {
  await makeView(page)
  const ws = store(), task = openTasks(ws)[0]
  const line = ws.pages.find(p => p.type === 'daily' && p.document.includes(task.id))
  const other = await context.newPage()
  await other.goto(`${base}/day/${line.date}`); await wait(2500)
  await page.bringToFront()
  await rowOf(page, task.id).locator('.database-title-cell').focus(); await page.keyboard.type('Renamed here'); await wait(200); await page.keyboard.press('Enter'); await wait(2000)
  const after = store(), r = { title: after.tasks.find(t => t.id === task.id).title, inDoc: after.pages.find(p => p.id === line.id).document.includes('Renamed here'), notice: await notices(page) }
  // Coming back to a tab is how it learns of edits made elsewhere; a headless browser doesn't fire this by itself.
  await other.bringToFront(); await other.evaluate(() => { window.dispatchEvent(new Event('focus')) }); await wait(3500)
  r.otherShows = await other.getByText('Renamed here').count(); r.otherNotice = await notices(other)
  await other.locator('.bn-inline-content').first().click(); await other.keyboard.type('x'); await wait(2500)
  r.typedKept = store().pages.find(p => p.id === line.id).document !== after.pages.find(p => p.id === line.id).document
  r.afterType = store().tasks.find(t => t.id === task.id).title; r.otherNotice2 = await notices(other)
  return { ...r, ok: r.title === 'Renamed here' && r.inDoc && /Renamed/.test(r.notice) && r.otherShows >= 1 && !/another tab|another device/i.test(r.otherNotice + r.otherNotice2) && r.afterType === 'Renamed here' && r.typedKept }
})
await scenario('R2-10: opening goes to its line, highlighted', async page => {
  await makeView(page)
  const task = openTasks(store())[0]
  await rowOf(page, task.id).locator('.database-title-cell').click(); await wait(2500)
  return { url: page.url(), shown: await page.getByText(task.title).first().isVisible(), ok: !/page=books/.test(page.url()) && await page.getByText(task.title).first().isVisible() }
})
await scenario('R2-11: + New asks for words, lands on today, planned, with Added · Open; no words makes nothing', async page => {
  await makeView(page)
  const before = store().tasks.length
  await view(page).locator('.database-new').click(); await wait(400); await page.keyboard.press('Escape'); await wait(600)
  const none = store().tasks.length - before
  await view(page).locator('.database-new').click(); await wait(400); await page.keyboard.type('A new to-do'); await page.keyboard.press('Enter'); await wait(2500)
  const ws = store(), task = ws.tasks.find(t => t.title === 'A new to-do')
  const day = ws.pages.find(p => p.date === today)
  const r = { none, made: Boolean(task), onToday: Boolean(day?.document.includes(task?.id)), notice: await notices(page), shown: task ? await rowOf(page, task.id).count() : 0, open: await page.getByRole('button', { name: 'Open' }).count() }
  return { ...r, ok: none === 0 && r.made && r.onToday && /Added/.test(r.notice) && r.shown === 1 && r.open >= 1 }
})
await scenario('R2-9: Deadline and Planned through their cells are the task; Undo puts them back', async page => {
  await makeView(page)
  const task = openTasks(store())[0]
  const set = async column => { await rowOf(page, task.id).locator('.database-td.is-date').nth(column).click(); await wait(300); const field = page.locator('.property-editor input, .database-date-input, [role=dialog] input').first(); await field.fill('2026-12-15'); await page.keyboard.press('Enter'); await wait(1500) }
  // A task's date is one day: no End date or Include time to offer (R2-9).
  await rowOf(page, task.id).locator('.database-td.is-date').nth(2).click(); await wait(300)
  const toggles = await page.getByText('End date').count() + await page.getByText('Include time').count()
  await page.keyboard.press('Escape'); await wait(300)
  await set(2)
  const r = { toggles, deadline: store().tasks.find(t => t.id === task.id).deadlineOn, notice: await notices(page) }
  await page.getByRole('button', { name: 'Undo' }).first().click(); await wait(1500)
  r.afterUndo = store().tasks.find(t => t.id === task.id).deadlineOn
  await set(0)
  const ws = store()
  r.onDay = ws.pages.find(p => p.date === '2026-12-15')?.document.includes(task.id) ?? false
  return { ...r, ok: r.toggles === 0 && r.deadline === '2026-12-15' && /Deadline set/.test(r.notice) && r.afterUndo === null && r.onDay }
})
await scenario('R2-9: a Board by Status: a card moved to Paused is Not today; no way to add a column', async page => {
  await makeView(page)
  const task = openTasks(store())[0]
  await view(page).locator('.database-more-button').click(); await wait(200)
  await page.locator('.database-menu').getByRole('menuitem', { name: 'Layout' }).click(); await wait(200)
  await page.locator('.database-menu').getByText('Board', { exact: true }).click(); await wait(400)
  const ask = page.locator('.database-menu').getByRole('menuitem', { name: /^Status/ }); if (await ask.count()) await ask.first().click()
  await wait(1500); await page.keyboard.press('Escape'); await wait(400)
  const r = { columns: await view(page).locator('[data-column]').evaluateAll(e => e.map(x => x.getAttribute('data-column'))), addColumn: await view(page).locator('.database-column.is-add').count() }
  const a = await view(page).locator(`[data-card="todo:${task.id}"]`).boundingBox(), b = await view(page).locator('[data-column="paused"]').boundingBox()
  await page.mouse.move(a.x + a.width / 2, a.y + a.height / 2); await page.mouse.down(); await page.mouse.move(a.x + a.width / 2 + 8, a.y + a.height / 2 + 8, { steps: 3 }); await wait(80)
  await page.mouse.move(b.x + b.width / 2, b.y + b.height * 0.5, { steps: 8 }); await wait(150); await page.mouse.up(); await wait(1800)
  r.paused = store().tasks.find(t => t.id === task.id).paused; r.notice = await notices(page)
  return { ...r, ok: r.addColumn === 0 && r.paused === true && /Paused|Not today/.test(r.notice) }
})
await scenario('R2-3: Remove this view and Duplicate touch no task', async page => {
  await makeView(page)
  const tasks = JSON.stringify(store().tasks)
  await view(page).locator('.database-more-button').click(); await wait(200)
  const items = await page.locator('.database-menu [role=menuitem]').allInnerTexts()
  await page.locator('.database-menu').getByRole('menuitem', { name: 'Duplicate' }).click(); await wait(1800)
  const views = await page.locator('.database-block').filter({ hasText: 'from To-dos' }).count()
  await view(page).locator('.database-more-button').click(); await wait(200)
  await page.locator('.database-menu').getByRole('menuitem', { name: 'Remove this view' }).click(); await wait(1800)
  const r = { items: items.map(t => t.replace(/\s+/g, ' ')), views, after: await page.locator('.database-block').filter({ hasText: 'from To-dos' }).count(), notice: await notices(page), same: JSON.stringify(store().tasks) === tasks }
  return { ...r, ok: r.views === 2 && r.after === 1 && /View removed · To-dos is still in Tasks/.test(r.notice) && r.same && !items.some(t => /Open as page|Copy link|Turn into|Delete database/.test(t)) }
})
await scenario('R2-11: in a view pinned to this page\'s day, + New lands on that day, not today', async page => {
  const date = '2026-12-20'
  await page.goto(`${base}/day/${date}`); await wait(2000)
  await page.getByRole('button', { name: 'Create page' }).click(); await wait(2500)
  await page.locator('.bn-inline-content').last().click(); await page.keyboard.press('Meta+ArrowRight'); await wait(150); await page.keyboard.press('Enter'); await page.keyboard.type('/database'); await wait(400); await page.keyboard.press('Enter'); await wait(500)
  await page.locator('.database-picker [role=menuitem]', { hasText: 'To-dos' }).click(); await wait(1800)
  await view(page).locator('.database-more-button').click(); await wait(200)
  await page.locator('.database-menu').getByRole('button', { name: 'Filter' }).click(); await page.locator('.database-menu').getByText('+ Add filter').click(); await wait(400)
  await page.locator('.database-rule select[aria-label=Property]').last().selectOption({ label: 'Planned' }); await wait(300)
  await page.locator('.database-rule select[aria-label=Condition]').last().selectOption('is'); await wait(300)
  await page.locator('.database-rule select[aria-label=Day]').last().selectOption('pageDate'); await wait(800)
  await page.keyboard.press('Escape'); await wait(1500)
  await view(page).locator('.database-new').click(); await wait(400); await page.keyboard.type('On that day'); await page.keyboard.press('Enter'); await wait(2500)
  const ws = store(), task = ws.tasks.find(t => t.title === 'On that day'), day = ws.pages.find(p => p.date === date), now = ws.pages.find(p => p.date === today)
  const r = { made: Boolean(task), onThatDay: Boolean(day?.document.includes(task?.id)), onToday: Boolean(now?.document.includes(task?.id)), shown: task ? await rowOf(page, task.id).count() : 0 }
  return { ...r, ok: r.made && r.onThatDay && !r.onToday && r.shown === 1 }
})
await scenario('R2-11: + New on a day with no page yet makes it from his template, never blank', async (page, context) => {
  await makeView(page)
  // A later today, with no page for it on this copy.
  const later = '2026-12-28'
  await context.clock.setFixedTime(new Date(`${later}T12:00:00`))
  await page.reload(); await wait(3000)
  const before = store()
  await view(page).locator('.database-new').click(); await wait(400); await page.keyboard.type('On a new day'); await page.keyboard.press('Enter'); await wait(2500)
  const ws = store(), task = ws.tasks.find(t => t.title === 'On a new day'), day = ws.pages.find(p => p.date === later)
  const kinds = doc => JSON.parse(doc).filter(n => n.type === 'heading').map(n => n.content?.[0]?.text)
  const r = { hadDay: before.pages.some(p => p.date === later), made: Boolean(task), onDay: Boolean(day?.document.includes(task?.id)), headings: day ? kinds(day.document) : [] }
  return { ...r, ok: !r.hadDay && r.made && r.onDay && r.headings.includes('Morning Planning') }
})
await scenario('at 390: it draws, + New takes words, nothing overflows', async page => {
  await makeView(page)
  const r = { overflow: await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth), rows: await view(page).locator('.database-row').count() }
  await view(page).locator('.database-new').click(); await wait(500); await page.keyboard.type('From the phone'); await page.keyboard.press('Enter'); await wait(2500)
  r.made = store().tasks.some(t => t.title === 'From the phone')
  return { ...r, ok: r.overflow <= 0 && r.rows > 0 && r.made }
}, { viewport: { width: 390, height: 844 }, hasTouch: true, isMobile: true })
await browser.close()
console.log(failed ? `FAIL ${failed}` : 'PASS')
if (failed) process.exit(1)
