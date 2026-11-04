// R4-4 and R4-10 together: moving a parent from its page's ⋯ takes its tree, and the toggle in the target shows it. Read back from the store.
// Usage: node tests/evidence/sub-items/move-tree.mjs <base-url> <store-path> [chromium|webkit]  (a throwaway store the server at <base-url> uses)
import * as pw from '@playwright/test'
import { execSync } from 'node:child_process'
const [base, storePath, engine = 'chromium'] = process.argv.slice(2)
if (!base || !storePath) { console.error('Usage: node tests/evidence/sub-items/move-tree.mjs <base-url> <store-path> [chromium|webkit]'); process.exit(2) }
const store = () => JSON.parse(execSync(`sqlite3 ${storePath} "select data from workspace"`, { maxBuffer: 1 << 26 }).toString())
const pageOf = id => store().pages.find(p => p.id === id)
const wait = ms => new Promise(r => setTimeout(r, ms))
const browser = await pw[engine].launch({ headless: true })
const wide = { viewport: { width: 1280, height: 900 } }, phone = { viewport: { width: 390, height: 780 }, hasTouch: true }
const tree = ['top', 'kid', 'grand', 'great', 'deep', 'deeper', 'kid2']
let failed = 0
const scenario = async (name, act, options = wide) => {
  execSync(`rm -f ${storePath} ${storePath}-wal ${storePath}-shm && node --no-warnings tests/evidence/sub-items/seed.ts ${storePath} move`, { stdio: 'ignore' })
  const context = await browser.newContext(options), page = await context.newPage(), errors = []
  page.on('pageerror', e => { if (!/ResizeObserver loop/.test(e.message)) errors.push(e.message) })
  let r
  try { r = await act(page, context) } catch (e) { r = { ok: false, threw: e.message.split('\n').slice(0, 3).join(' ') } }
  const ok = r.ok && !errors.length
  if (!ok) failed++
  console.log(ok ? 'PASS' : 'FAIL', name, JSON.stringify({ ...r, errors }))
  await context.close()
}
const notices = page => page.locator('[role=alert], [role=status]').allInnerTexts().then(t => t.join(' | ').replace(/\s+/g, ' '))
const dialog = page => page.locator('.move-dialog')
const openMove = async (page, id) => {
  await page.goto(`${base}/pages?page=${id}`); await wait(2200)
  await page.locator('.page-more').first().click(); await wait(250)
  await page.getByRole('menuitem', { name: 'Move to…' }).click(); await wait(400)
}
const openSub = async (page, row) => { await page.locator(`.database-row[data-row="${row}"] .database-sub-toggle`).click(); await wait(200) }
const moveToArchive = async page => { await dialog(page).getByRole('option', { name: 'Archive' }).click(); await wait(1500) }

await scenario('A parent moves with no question, the notice counts its sub-items, and the toggle in Archive opens onto them', async page => {
  await openMove(page, 'top')
  await moveToArchive(page)
  const r = { notice: await notices(page), parents: tree.map(id => pageOf(id).parentId), other: pageOf('other').parentId }
  const here = pageOf('archive').database.subItems
  r.links = { kid: pageOf('kid').values?.[here?.parent], top: pageOf('top').values?.[here?.sub] }
  await page.goto(`${base}/pages?page=archive`); await wait(2200)
  r.shownClosed = await page.locator('.database-row[data-row]').count()
  await openSub(page, 'top')
  r.shownOpen = await page.locator('.database-row[data-row]').count()
  r.ok = /Moved to Archive with 6 sub-items/.test(r.notice) && r.parents.every(p => p === 'archive') && r.other === 'work' && r.links.kid?.[0] === 'top' && r.links.top?.join() === 'kid,kid2' && r.shownClosed === 1 && r.shownOpen === 3
  return r
})
await scenario('Undo from the notice: every row, its links and Archive\'s properties go back', async page => {
  const links = () => tree.map(id => pageOf(id).values?.par ?? null)
  const before = links()
  await openMove(page, 'top')
  await moveToArchive(page)
  const moved = pageOf('kid').parentId
  await page.getByRole('button', { name: 'Undo' }).last().click(); await wait(1500)
  const r = { moved, parents: tree.map(id => pageOf(id).parentId), same: JSON.stringify(links()) === JSON.stringify(before), archive: pageOf('archive').database.subItems ?? null, props: pageOf('archive').database.properties.map(p => p.name) }
  r.ok = moved === 'archive' && r.parents.every(p => p === 'work') && r.same && r.archive === null && !r.props.includes('Parent item')
  return r
})
await scenario('A sub-item moved alone: it says it leaves its parent and how many go with it, and the old parent keeps the rest', async page => {
  await openMove(page, 'grand')
  await moveToArchive(page)
  const r = { asked: (await dialog(page).innerText()).replace(/\s+/g, ' ') }
  await dialog(page).getByRole('button', { name: 'Move', exact: true }).click(); await wait(1500)
  const here = pageOf('archive').database.subItems
  r.notice = await notices(page); r.parents = ['grand', 'great', 'deep', 'deeper', 'kid'].map(id => pageOf(id).parentId)
  r.greatUnder = pageOf('great').values?.[here?.parent]; r.grandUp = pageOf('grand').values?.[here?.parent] ?? null; r.kidSubs = pageOf('kid').values?.sub ?? null
  r.ok = /1 value won't move: Parent item/.test(r.asked) && /3 sub-items will move with it/.test(r.asked) && /with 3 sub-items/.test(r.notice) && r.parents.join() === 'archive,archive,archive,archive,work' && r.greatUnder?.[0] === 'grand' && r.grandUp === null && r.kidSubs === null
  return r
})
await scenario('A database inside the tree isn\'t offered for its parent, and is for a row outside it', async page => {
  await openMove(page, 'top')
  const r = { top: await dialog(page).getByRole('option').allInnerTexts() }
  await openMove(page, 'other')
  r.other = await dialog(page).getByRole('option').allInnerTexts()
  const names = list => list.map(t => t.trim())
  r.ok = names(r.top).join() === 'Archive' && names(r.other).includes('Nested') && names(r.other).includes('Archive')
  return r
})
await scenario('A tab that missed the move: its edit to a sub-item is refused with a notice, and writes nothing', async (page, context) => {
  const other = await context.newPage()
  await other.goto(`${base}/pages?page=work`); await wait(2200)
  // The other tab mustn't hear about the move before it edits.
  await other.evaluate(() => { window.BroadcastChannel = undefined })
  await openSub(other, 'top')
  await openMove(page, 'top')
  await moveToArchive(page)
  const before = JSON.stringify(pageOf('kid').values)
  const r = { shown: await other.locator('.database-row[data-row="kid"]').count() }
  if (r.shown) {
    await other.locator('.database-row[data-row="kid"] .database-td:not(.is-title)').first().click(); await wait(300)
    await other.keyboard.type('999'); await other.keyboard.press('Enter'); await wait(1800)
    r.notice = await notices(other); r.same = JSON.stringify(pageOf('kid').values) === before
  }
  r.ok = r.shown === 1 && /This row moved to Archive/.test(r.notice) && r.same
  return r
})
await scenario('390: from the row page\'s menu, in the sheet', async page => {
  await openMove(page, 'top')
  await moveToArchive(page)
  const r = { notice: await notices(page), moved: tree.every(id => pageOf(id).parentId === 'archive'), overflow: await page.evaluate(() => document.documentElement.scrollWidth - innerWidth) }
  r.ok = /with 6 sub-items/.test(r.notice) && r.moved && r.overflow <= 0
  return r
}, phone)
await browser.close()
console.log(failed ? `${failed} FAILED` : 'ALL PASS')
process.exit(failed ? 1 : 0)
