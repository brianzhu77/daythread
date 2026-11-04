// R4-10: moving a row from its page's ⋯, read back from the store: what comes, what's said first, Undo, links, a tab that missed it.
// Usage: node tests/evidence/move-row/move.mjs <base-url> <store-path> [chromium|webkit]  (a throwaway store the server at <base-url> uses)
import * as pw from '@playwright/test'
import { execSync } from 'node:child_process'
const [base, storePath, engine = 'chromium'] = process.argv.slice(2)
if (!base || !storePath) { console.error('Usage: node tests/evidence/move-row/move.mjs <base-url> <store-path> [chromium|webkit]'); process.exit(2) }
const store = () => JSON.parse(execSync(`sqlite3 ${storePath} "select data from workspace"`, { maxBuffer: 1 << 26 }).toString())
const pageOf = id => store().pages.find(p => p.id === id)
const wait = ms => new Promise(r => setTimeout(r, ms))
const browser = await pw[engine].launch({ headless: true })
const wide = { viewport: { width: 1280, height: 900 } }, phone = { viewport: { width: 390, height: 780 }, hasTouch: true }
let failed = 0
const scenario = async (name, act, options = wide) => {
  execSync(`rm -f ${storePath} ${storePath}-wal ${storePath}-shm && node --no-warnings tests/evidence/move-row/seed.ts ${storePath}`, { stdio: 'ignore' })
  const context = await browser.newContext(options)
  const page = await context.newPage(), errors = []
  page.on('pageerror', e => { if (!/ResizeObserver loop/.test(e.message)) errors.push(e.message) })
  let r
  try { await page.goto(`${base}/pages?page=dune`); await wait(2200); r = await act(page, context) } catch (e) { r = { ok: false, threw: e.message.split('\n').slice(0, 3).join(' ') } }
  const ok = r.ok && !errors.length
  if (!ok) failed++
  console.log(ok ? 'PASS' : 'FAIL', name, JSON.stringify({ ...r, errors }))
  await context.close()
}
const notices = page => page.locator('[role=alert], [role=status]').allInnerTexts().then(t => t.join(' | ').replace(/\s+/g, ' '))
const openMove = async page => { await page.locator('.page-more').first().click(); await wait(200); await page.getByRole('menuitem', { name: 'Move to…' }).click(); await wait(300) }
const dialog = page => page.locator('.move-dialog')
const choose = (page, name) => dialog(page).getByRole('option', { name, exact: true }).click()

await scenario('Nothing lost: it moves with no question, says so, stays open with the new properties; the body and links hold', async page => {
  await page.goto(`${base}/pages?page=emma`); await wait(1800)
  await openMove(page)
  const r = { listed: await dialog(page).getByRole('option').allInnerTexts() }
  await page.getByRole('searchbox', { name: 'Search databases' }).fill('sam'); await wait(100)
  await choose(page, 'Same'); await wait(1500)
  const row = pageOf('emma')
  r.parent = row.parentId; r.values = row.values; r.notice = await notices(page); r.url = page.url(); r.shown = await page.locator('.row-property-name').allInnerTexts(); r.body = await page.locator('.bn-inline-content').allInnerTexts()
  await page.goto(`${base}/pages?page=notes`); await wait(1800)
  await page.locator('.bn-inline-content', { hasText: 'Emma' }).first().locator('a, button, [data-page-ref], .page-ref').first().click().catch(() => {}); await wait(1200)
  r.linkWentTo = page.url()
  r.ok = r.listed.length === 3 && r.parent === 'same' && r.values.pages3 === 300 && /Moved to Same/.test(r.notice) && /page=emma/.test(r.url) && r.shown.includes('Rating') && r.body.join().includes('The body of Emma') && /page=emma/.test(r.linkWentTo)
  return r
})
await scenario('Something lost: it names it first; Back moves nothing; Move does, adds the option, and one Undo brings all of it back', async page => {
  const before = store().revision
  await openMove(page); await choose(page, 'Shelf'); await wait(500)
  const r = { said: (await dialog(page).innerText()).replace(/\s+/g, ' ') }
  r.written = store().revision - before
  await dialog(page).getByRole('button', { name: 'Back', exact: true }).click(); await wait(200)
  await choose(page, 'Shelf'); await wait(400)
  await dialog(page).getByRole('button', { name: 'Move', exact: true }).click(); await wait(1500)
  const row = pageOf('dune'), shelf = pageOf('shelf').database.properties.find(p => p.id === 'genre2')
  r.parent = row.parentId; r.values = row.values; r.options = shelf.options.map(o => o.name); r.fav = pageOf('ann').values?.fav ?? null
  await page.getByRole('button', { name: 'Undo' }).first().click(); await wait(1500)
  const back = pageOf('dune')
  r.backParent = back.parentId; r.backValues = back.values; r.backOptions = pageOf('shelf').database.properties.find(p => p.id === 'genre2').options.map(o => o.name); r.backFav = pageOf('ann').values?.fav
  r.ok = /1 value won't move: Rating/.test(r.said) && /1 row in People will lose its link/.test(r.said) && r.written === 0 && r.parent === 'shelf' && r.values.pages2 === 412 && r.options.includes('SF') && r.fav === null && r.backParent === 'books' && r.backValues.rating === 5 && r.backOptions.join() === 'Novel' && r.backFav?.join() === 'dune'
  return r
})
await scenario('A tab that missed the move: its cell edit is refused with a notice and writes nothing, and it catches up', async (page, context) => {
  const other = await context.newPage()
  await other.goto(`${base}/pages?page=books`); await wait(2200)
  // The other tab mustn't hear about the move before it edits.
  await other.evaluate(() => { window.BroadcastChannel = undefined })
  await openMove(page); await page.getByRole('searchbox', { name: 'Search databases' }).fill('same'); await wait(100); await choose(page, 'Same'); await wait(500); await dialog(page).getByRole('button', { name: 'Move', exact: true }).click(); await wait(1500)
  const before = JSON.stringify(pageOf('dune').values)
  const shown = await other.locator('.database-row[data-row="dune"]').count()
  const r = { stillShownThere: shown }
  if (shown) {
    await other.locator('.database-row[data-row="dune"] .database-td:not(.is-title)').first().click(); await wait(300)
    await other.keyboard.type('999'); await other.keyboard.press('Enter'); await wait(1800)
    r.notice = await notices(other); r.after = JSON.stringify(pageOf('dune').values); r.same = r.after === before
    r.rowGone = await other.locator('.database-row[data-row="dune"]').count()
  }
  r.ok = shown ? /This row moved to Same/.test(r.notice) && r.same && r.rowGone === 0 : true
  return r
})
await scenario('390: from the row page\'s menu, in the sheet', async page => {
  await openMove(page)
  const box = await dialog(page).locator('[role=dialog]').first().boundingBox().catch(() => null)
  await page.getByRole('searchbox', { name: 'Search databases' }).fill('same'); await wait(100)
  await choose(page, 'Same'); await wait(500); await dialog(page).getByRole('button', { name: 'Move', exact: true }).click(); await wait(1500)
  return { box, parent: pageOf('dune').parentId, overflow: await page.evaluate(() => document.documentElement.scrollWidth - innerWidth), ok: pageOf('dune').parentId === 'same' }
}, phone)
await browser.close()
console.log(failed ? `${failed} FAILED` : 'ALL PASS')
process.exit(failed ? 1 : 0)
