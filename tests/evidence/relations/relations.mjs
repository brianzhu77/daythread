// R3-5, R3-6, R3-7: a relation's picker, both sides, a rollup that keeps up, in the built app.
// Usage: node tests/evidence/relations/relations.mjs <base-url> <store-path> [chromium|webkit]  (a throwaway store the server at <base-url> uses)
import * as pw from '@playwright/test'
import { execSync } from 'node:child_process'
const [base, storePath, engine = 'chromium'] = process.argv.slice(2)
if (!base || !storePath) { console.error('Usage: node tests/evidence/relations/relations.mjs <base-url> <store-path> [chromium|webkit]'); process.exit(2) }
const store = () => JSON.parse(execSync(`sqlite3 ${storePath} "select data from workspace"`, { maxBuffer: 1 << 26 }).toString())
const pageOf = id => store().pages.find(p => p.id === id)
const wait = ms => new Promise(r => setTimeout(r, ms))
const browser = await pw[engine].launch({ headless: true })
const notices = page => page.locator('[role=alert], [role=status]').allInnerTexts().then(t => t.join(' | ').replace(/\s+/g, ' '))
let failed = 0
const scenario = async (name, seed, act, options = { viewport: { width: 1280, height: 1000 } }) => {
  if (process.env.ONLY && !new RegExp(process.env.ONLY).test(name)) return
  execSync(`rm -f ${storePath} ${storePath}-wal ${storePath}-shm && node --no-warnings tests/evidence/relations/seed.ts ${storePath} ${seed}`, { stdio: 'ignore' })
  const context = await browser.newContext(options)
  const page = await context.newPage(), errors = []
  page.on('pageerror', e => errors.push(e.message))
  let r
  try { await page.goto(`${base}/pages?page=books`); await wait(2200); r = await act(page) } catch (e) { r = { ok: false, threw: e.message.split('\n').slice(0, 3).join(' '), url: page.url(), body: (await page.locator('body').innerText().catch(() => '')).replace(/\s+/g, ' ').slice(0, 300) } }
  const ok = r.ok && !errors.length
  if (!ok) failed++
  console.log(ok ? 'PASS' : 'FAIL', name, JSON.stringify({ ...r, errors }))
  await context.close()
}
const menu = page => page.locator('.database-menu')
const cell = (page, row, index = 0) => page.locator(`.database-row[data-row="${row}"] .database-td:not(.is-title)`).nth(index)

await scenario('R3-5: make a relation in the menu, pick with the list, titles open the row', '', async page => {
  await page.locator('.database-more-button').first().click(); await wait(200)
  await menu(page).getByRole('menuitem', { name: 'Properties' }).click(); await wait(200)
  await menu(page).getByRole('menuitem', { name: '+ Add property' }).click(); await wait(200)
  await menu(page).getByRole('menuitem', { name: 'Relation', exact: true }).click(); await wait(1200)
  const selected = await menu(page).locator('select').nth(1).inputValue().catch(() => '')
  await page.keyboard.press('Escape'); await wait(300)
  const books = pageOf('books').database.properties.find(p => p.type === 'relation')
  const r = { target: books?.target, selected }
  await cell(page, 'dune').click(); await wait(400)
  r.top = (await page.locator('.property-create').first().innerText()).replace(/\s+/g, ' ')
  await page.locator('.property-search input').fill('Herb'); await wait(150); await page.keyboard.press('Enter'); await wait(200)
  await page.locator('.property-search input').fill('New one'); await wait(150); await page.keyboard.press('Enter'); await wait(400)
  await page.keyboard.press('Escape'); await wait(1800)
  const ws = store(), dune = ws.pages.find(p => p.id === 'dune'), made = ws.pages.find(p => p.title === 'New one')
  r.links = dune.values?.[books.id]; r.made = made?.parentId; r.herbert = r.links?.includes('herbert'); r.hasNew = r.links?.includes(made?.id)
  r.shown = (await cell(page, 'dune').innerText()).replace(/\s+/g, ' ')
  await cell(page, 'dune').locator('a', { hasText: 'Herbert' }).click(); await wait(1500)
  r.url = page.url()
  return { ...r, ok: r.target === 'authors' && /New row in Authors/.test(r.top) && r.herbert && r.hasNew && r.made === 'authors' && /Herbert/.test(r.shown) && /New one/.test(r.shown) && /page=herbert/.test(r.url) }
})
await scenario('R3-6: Show on makes the other side; an edit there shows here without a reload, with Undo; deleting says so', '', async page => {
  await page.locator('.database-more-button').first().click(); await wait(200)
  await menu(page).getByRole('menuitem', { name: 'Properties' }).click(); await wait(200)
  await menu(page).getByRole('menuitem', { name: '+ Add property' }).click(); await wait(200)
  await menu(page).getByRole('menuitem', { name: 'Relation', exact: true }).click(); await wait(1200)
  await menu(page).getByRole('checkbox').first().waitFor({ timeout: 3000 }).catch(() => {})
  await menu(page).locator('label', { hasText: 'Show on Authors' }).locator('input').click(); await wait(1500)
  const books = pageOf('books').database.properties.find(p => p.type === 'relation'), authors = pageOf('authors').database.properties.find(p => p.type === 'relation')
  const r = { mirror: books.mirror === authors?.id, back: authors?.mirror === books.id, name: authors?.name }
  await menu(page).locator('label', { hasText: 'Limit' }).waitFor(); r.note = await menu(page).getByText('Deleting it also deletes its other side.').count()
  await menu(page).getByRole('menuitem', { name: 'Delete property' }).click(); await wait(1500)
  r.notice = await notices(page); r.gone = !pageOf('authors').database.properties.some(p => p.id === authors.id)
  await page.getByRole('button', { name: 'Undo' }).first().click(); await wait(1500)
  r.back2 = pageOf('authors').database.properties.some(p => p.id === authors.id) && pageOf('books').database.properties.some(p => p.id === books.id)
  return { ...r, ok: r.mirror && r.back && r.note === 1 && /and .* on Authors deleted/.test(r.notice) && r.gone && r.back2 }
})
await scenario('R3-7: a rollup shows the sum, is read-only, keeps up when a linked row changes, and drops to — with no links', 'linked', async page => {
  const shown = async (row, i) => (await cell(page, row, i).innerText()).replace(/\s+/g, ' ').trim()
  const r = { dune: await shown('dune', 1), emma: await shown('emma', 1), links: await shown('dune', 0) }
  await cell(page, 'dune', 1).click(); await wait(300)
  r.editor = await page.locator('.property-search input, .property-field').count()
  await page.keyboard.press('Escape'); await wait(200)
  // Change a linked row in another view of the same data: its page.
  await page.goto(`${base}/pages?page=austen`); await wait(2000)
  await page.locator('.row-property-value', { hasText: '41' }).click(); await wait(300)
  await page.locator('.property-field').first().fill('50'); await page.keyboard.press('Enter'); await wait(1500)
  await page.goto(`${base}/pages?page=books`); await wait(2200)
  r.after = await shown('dune', 1)
  return { ...r, ok: r.dune.includes('106') && r.emma === '—' && /Herbert/.test(r.links) && /Austen/.test(r.links) && r.editor === 0 && r.after.includes('115') }
})
await scenario('R3-5, R3-6: a row in Trash reads without it, Restore brings it back on both sides', 'linked', async page => {
  await page.goto(`${base}/pages?page=dune`); await wait(1800)
  await page.getByRole('button', { name: 'Row actions' }).first().click(); await wait(300)
  await page.getByRole('menuitem', { name: 'Delete row' }).click(); await wait(1500)
  const stored = pageOf('herbert').values?.wrote
  await page.goto(`${base}/pages?page=authors`); await wait(2000)
  const row = () => page.locator('.database-row[data-row="herbert"]').innerText().then(t => t.replace(/\s+/g, ' '))
  const gone = await row()
  await page.goto(`${base}/pages?page=dune`); await wait(1800)
  await page.getByRole('button', { name: 'Restore' }).first().click(); await wait(1500)
  await page.goto(`${base}/pages?page=authors`); await wait(2000)
  const back = await row(), dune = pageOf('dune').values?.by
  return { stored, gone, back, dune, ok: stored?.includes('dune') && !/Dune/.test(gone) && /Dune/.test(back) && dune?.includes('herbert') }
})
await scenario('R3-5: Cmd-Z after a pick takes the link off both sides', 'linked', async page => {
  await cell(page, 'emma', 0).click(); await wait(400)
  await page.locator('.property-search input').fill('Herb'); await wait(150); await page.keyboard.press('Enter'); await wait(200); await page.keyboard.press('Escape'); await wait(1600)
  const linked = { emma: pageOf('emma').values?.by, herbert: pageOf('herbert').values?.wrote }
  await cell(page, 'emma', 0).focus().catch(() => {}); await page.locator('.database-row[data-row="emma"] .database-title-cell').focus(); await page.keyboard.press('Meta+z'); await wait(1600)
  const undone = { emma: pageOf('emma').values?.by ?? null, herbert: pageOf('herbert').values?.wrote }
  return { linked, undone, ok: linked.emma?.includes('herbert') && linked.herbert?.includes('emma') && undone.emma === null && !undone.herbert?.includes('emma') }
})
await scenario('R3-16: a filter on a relation from the menu; a rollup offers conditions; neither is offered for a Board', 'linked', async page => {
  await page.locator('.database-more-button').first().click(); await wait(200)
  await menu(page).getByRole('button', { name: 'Filter' }).click(); await menu(page).getByText('+ Add filter').click(); await wait(300)
  await page.locator('.database-rule select[aria-label=Property]').last().selectOption({ label: 'By' }); await wait(300)
  await page.locator('.database-rule-options label', { hasText: 'Herbert' }).locator('input').click(); await wait(1200)
  const byFilter = await page.locator('.database-row').evaluateAll(e => e.map(x => x.getAttribute('data-row')))
  await page.locator('.database-rule select[aria-label=Property]').last().selectOption({ label: 'Ages' }); await wait(300)
  const ops = await page.locator('.database-rule select[aria-label=Condition]').last().locator('option').allInnerTexts()
  await page.keyboard.press('Escape'); await wait(300)
  await page.locator('.database-more-button').first().click(); await wait(200)
  await menu(page).getByRole('menuitem', { name: 'Layout' }).click(); await wait(200)
  await menu(page).getByText('Board', { exact: true }).click(); await wait(600)
  const askBoard = await menu(page).getByRole('menuitem', { name: /^(By|Ages)/ }).count()
  return { byFilter, ops: ops.length, askBoard, ok: byFilter.length === 1 && byFilter[0] === 'dune' && ops.length > 0 && askBoard === 0 }
})
await scenario('A linked view of a database with a relation reads it the same', 'linked', async page => {
  await page.goto(`${base}/pages?page=herbert`); await wait(2000)
  const r = { shows: (await page.locator('.row-property-value, .row-properties').first().innerText()).replace(/\s+/g, ' ') }
  await page.locator('.bn-inline-content').first().click(); await page.keyboard.type('/database'); await wait(400); await page.keyboard.press('Enter'); await wait(500)
  await page.locator('.database-picker [role=menuitem]', { hasText: 'Books' }).click(); await wait(2000)
  r.row = (await page.locator('.database-block .database-row[data-row="dune"]').innerText()).replace(/\s+/g, ' ')
  return { ...r, ok: /Herbert/.test(r.row) && /Austen/.test(r.row) && /106/.test(r.row) }
})
await scenario('at 390: a relation cell opens its sheet and a pick links it', 'linked', async page => {
  const r = { overflow: await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth) }
  await page.locator('.database-row[data-row="emma"] .database-td.is-relation').click(); await wait(600)
  r.sheet = await page.locator('.property-create').count()
  await page.locator('[role=option], .property-option', { hasText: 'Herbert' }).first().click(); await wait(400)
  await page.keyboard.press('Escape').catch(() => {}); await wait(300)
  await page.locator('.database-menu-scrim, .property-scrim').first().click({ timeout: 1500 }).catch(() => {})
  await wait(1800)
  r.links = pageOf('emma').values?.by
  return { ...r, ok: r.overflow <= 0 && r.sheet >= 1 && r.links?.includes('herbert') }
}, { viewport: { width: 390, height: 844 }, hasTouch: true, isMobile: true })
await browser.close()
console.log(failed ? `FAIL ${failed}` : 'PASS')
if (failed) process.exit(1)
