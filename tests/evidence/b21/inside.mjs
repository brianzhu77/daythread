// B21-11 in the built app: a database inside a synced block, and a page or database made inside a copy.
// Usage: node tests/evidence/b21/inside.mjs <base-url> <store-path> [chromium|webkit]  (a throwaway store the server at <base-url> uses)
import * as pw from '@playwright/test'
import { execSync } from 'node:child_process'
const [base, storePath, engine = 'chromium'] = process.argv.slice(2)
if (!base || !storePath) { console.error('Usage: node tests/evidence/b21/inside.mjs <base-url> <store-path> [chromium|webkit]'); process.exit(2) }
const store = () => JSON.parse(execSync(`sqlite3 ${storePath} "select data from workspace"`, { maxBuffer: 1 << 26 }).toString())
const pageOf = id => store().pages.find(p => p.id === id)
const nodesOf = id => { const out = []; const walk = l => l.forEach(n => { out.push(n); walk(n.children ?? []) }); walk(JSON.parse(pageOf(id).document)); return out }
// A page's stored document holds only its block: the lines live once, in the record, under the original's ids.
const recordLines = () => { const out = []; const walk = l => l.forEach(n => { out.push(n); walk(n.children ?? []) }); walk(JSON.parse(store().synced?.[0]?.lines ?? '[]')); return out }
const homeOn = page => page.locator('.database-block .database-title').count()
const viewOn = page => page.locator('.database-block .database-view-name.is-static').count()
const wait = ms => new Promise(r => setTimeout(r, ms))
const browser = await pw[engine].launch({ headless: true })
const notices = page => page.locator('[role=alert], [role=status]').allInnerTexts().then(t => t.join(' | ').replace(/\s+/g, ' '))
let failed = 0
const scenario = async (name, seed, act) => {
  if (process.env.ONLY && !new RegExp(process.env.ONLY).test(name)) return
  execSync(`rm -f ${storePath} ${storePath}-wal ${storePath}-shm && node --no-warnings tests/evidence/b21/inside-seed.ts ${storePath} ${seed}`, { stdio: 'ignore' })
  const context = await browser.newContext({ viewport: { width: 1280, height: 900 }, serviceWorkers: 'block' }), page = await context.newPage(), errors = []
  page.on('pageerror', e => { if (!/ResizeObserver loop/.test(e.message)) errors.push(e.message) })
  let r
  try { r = await act(page) } catch (e) { r = { ok: false, threw: e.message.split('\n').slice(0, 3).join(' ') } }
  const ok = r.ok && !errors.length
  if (!ok) failed++
  console.log(ok ? 'PASS' : 'FAIL', name, JSON.stringify({ ...r, errors }).slice(0, 700))
  await context.close()
}
const open = async (page, id) => { await page.goto(`${base}/pages?page=${id}`); await wait(2200) }
const line = (page, words) => page.locator('.bn-inline-content', { hasText: words }).first()
const handleOn = async (page, target) => { await page.mouse.move(1, 1); await target.hover(); await wait(300); await page.locator('.bn-side-menu [aria-label^="Select or drag"]').first().click(); await wait(300) }

await scenario('Sync a selection holding a database: it goes in, the home stays, and nothing about its rows changes', '', async page => {
  await open(page, 'a')
  await line(page, 'Above on A').hover(); await wait(200)
  await handleOn(page, page.locator('.database-block').first())
  await page.locator('.editor-selection-bar').getByRole('button', { name: 'Sync' }).click(); await wait(2200)
  const r = { refused: /can't be synced/.test(await notices(page)), record: JSON.parse(store().synced?.[0]?.lines ?? '[]').map(n => n.type), home: pageOf('books').database.homeBlockId, rows: store().pages.filter(p => p.parentId === 'books' && !p.trashedAt).length, rowsShown: await page.locator('.database-row').count() }
  r.ok = !r.refused && r.record.includes('database') && r.home === 'home' && r.rows === 2 && r.rowsShown === 2
  return r
})
await scenario('A copy shows a view of the same rows, the original its home; reading both changes nothing', 'synced', async page => {
  const rev = store().revision
  await open(page, 'b')
  const r = { rowsOnB: await page.locator('.database-row').count(), viewOnB: await viewOn(page) }
  await open(page, 'a')
  r.rowsOnA = await page.locator('.database-row').count(); r.viewOnA = await viewOn(page); r.wrote = store().revision - rev
  r.ok = r.rowsOnB === 2 && r.rowsOnA === 2 && r.viewOnB === 1 && r.viewOnA === 0 && pageOf('books').database.homeBlockId === 'home' && r.wrote === 0
  return r
})
await scenario('/Page inside a copy: the page lives on the original\'s page, the notice says so, and its card is on both', 'synced', async page => {
  await open(page, 'b')
  await line(page, 'Shared line').click(); await page.keyboard.press('Meta+ArrowRight'); await page.keyboard.press('Enter'); await page.keyboard.type('/Page'); await wait(500)
  await page.keyboard.press('Enter'); await wait(400)
  const r = { notice: await notices(page) }
  await wait(2500)
  const made = store().pages.filter(p => !['a', 'b', 'books', 'one', 'two'].includes(p.id) && p.type === 'document' && !p.trashedAt).at(-1)
  r.parent = made?.parentId; r.inRecord = recordLines().some(n => n.type === 'pageLink' && n.props.pageId === made?.id)
  await open(page, 'a'); r.cardOnA = await page.locator(`[data-content-type=pageLink]`).count()
  await open(page, 'b'); r.cardOnB = await page.locator(`[data-content-type=pageLink]`).count()
  r.ok = /Page made in Page A/.test(r.notice) && r.parent === 'a' && r.inRecord && r.cardOnA === 1 && r.cardOnB === 1
  return r
})
await scenario('/Page on the original: no notice, as nothing surprising happened', 'synced', async page => {
  await open(page, 'a')
  await line(page, 'Shared line').click(); await page.keyboard.press('Meta+ArrowRight'); await page.keyboard.press('Enter'); await page.keyboard.type('/Page'); await wait(500)
  await page.keyboard.press('Enter'); await wait(400)
  const r = { notice: await notices(page) }
  r.ok = !/made in/.test(r.notice)
  return r
})
await scenario('/Database inside a copy: its home is the original\'s, a view here, and saving either page leaves it alone', 'synced', async page => {
  await open(page, 'b')
  await line(page, 'Shared line').click(); await page.keyboard.press('Meta+ArrowRight'); await page.keyboard.press('Enter'); await page.keyboard.type('/Database'); await wait(500)
  await page.keyboard.press('Enter'); await wait(500)
  await page.getByRole('button', { name: /New database|New table/i }).or(page.getByRole('menuitem', { name: /New database|New table/i })).first().click().catch(() => {}); await wait(600)
  const r = { notice: await notices(page) }
  await wait(2500)
  const made = store().pages.find(p => p.database && !['books'].includes(p.id) && !p.database.fixed && !p.trashedAt)
  r.parent = made?.parentId; r.home = made?.database.homeBlockId; r.inRecord = recordLines().some(n => n.id === r.home && n.type === 'database')
  await page.reload(); await wait(2200); r.viewsOnB = await viewOn(page)
  await line(page, 'Below on B').click(); await page.keyboard.type(' typed'); await wait(1800)
  await open(page, 'a'); r.viewsOnA = await viewOn(page); await line(page, 'Below on A').click(); await page.keyboard.type(' typed'); await wait(1800)
  r.alive = !pageOf(made.id).trashedAt && pageOf(made.id).database.homeBlockId === r.home
  r.ok = /made in Page A/.test(r.notice) && r.parent === 'a' && r.inRecord && r.viewsOnB === 2 && r.viewsOnA === 0 && r.alive
  return r
})
await scenario('Deleting the database\'s line from a copy: it leaves the shared lines, and the database stays with its rows, as a full page', 'synced', async page => {
  await open(page, 'b')
  await handleOn(page, page.locator('.database-block').first())
  await page.locator('.editor-selection-bar').getByRole('button', { name: 'Delete' }).click(); await wait(2600)
  const r = { inRecord: recordLines().some(n => n.type === 'database'), trashed: Boolean(pageOf('books').trashedAt), home: pageOf('books').database.homeBlockId, rows: store().pages.filter(p => p.parentId === 'books' && !p.trashedAt).length, notice: await notices(page) }
  r.ok = !r.inRecord && !r.trashed && r.home === null && r.rows === 2 && pageOf('books').parentId === 'a'
  return r
})
await browser.close()
console.log(failed ? `${failed} FAILED` : 'ALL PASS')
process.exit(failed ? 1 : 0)
