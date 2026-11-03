// R3-22: Group and Board by a relation, read-only groups by a rollup, in the built app.
// Usage: node tests/evidence/relations/groups.mjs <base-url> <store-path> [chromium|webkit]  (a throwaway store the server at <base-url> uses)
import * as pw from '@playwright/test'
import { execSync } from 'node:child_process'
const [base, storePath, engine = 'chromium'] = process.argv.slice(2)
if (!base || !storePath) { console.error('Usage: node tests/evidence/relations/groups.mjs <base-url> <store-path> [chromium|webkit]'); process.exit(2) }
const store = () => JSON.parse(execSync(`sqlite3 ${storePath} "select data from workspace"`, { maxBuffer: 1 << 26 }).toString())
const pageOf = id => store().pages.find(p => p.id === id)
const wait = ms => new Promise(r => setTimeout(r, ms))
const browser = await pw[engine].launch({ headless: true })
const notices = page => page.locator('[role=alert], [role=status]').allInnerTexts().then(t => t.join(' | ').replace(/\s+/g, ' '))
const menu = page => page.locator('.database-menu')
let failed = 0
const scenario = async (name, act) => {
  if (process.env.ONLY && !new RegExp(process.env.ONLY).test(name)) return
  execSync(`rm -f ${storePath} ${storePath}-wal ${storePath}-shm && node --no-warnings tests/evidence/relations/seed.ts ${storePath} linked`, { stdio: 'ignore' })
  const context = await browser.newContext({ viewport: { width: 1280, height: 1000 } })
  const page = await context.newPage(), errors = []
  page.on('pageerror', e => { if (!/ResizeObserver loop/.test(e.message)) errors.push(e.message) })
  let r
  try { await page.goto(`${base}/pages?page=books`); await wait(2200); r = await act(page) } catch (e) { r = { ok: false, threw: e.message.split('\n').slice(0, 3).join(' '), body: (await page.locator('body').innerText().catch(() => '')).replace(/\s+/g, ' ').slice(0, 300) } }
  const ok = r.ok && !errors.length
  if (!ok) failed++
  console.log(ok ? 'PASS' : 'FAIL', name, JSON.stringify({ ...r, errors }))
  await context.close()
}
const board = async page => {
  await page.locator('.database-more-button').first().click(); await wait(200)
  await menu(page).getByRole('menuitem', { name: 'Layout' }).click(); await wait(200)
  // By is the only property that can make its columns, so nothing asks.
  await menu(page).getByText('Board', { exact: true }).click(); await wait(1500)
  await page.keyboard.press('Escape'); await wait(300)
}
const drag = async (page, from, to) => {
  const a = await from.boundingBox(), b = await to.boundingBox()
  await page.mouse.move(a.x + a.width / 2, a.y + a.height / 2); await page.mouse.down(); await page.mouse.move(a.x + a.width / 2 + 8, a.y + a.height / 2 + 8, { steps: 3 }); await wait(80)
  await page.mouse.move(b.x + b.width / 2, b.y + b.height * 0.5, { steps: 8 }); await wait(150); await page.mouse.up(); await wait(1800)
}
await scenario('a Board by a relation: a column per linked row; a card moved between them swaps that link, on both sides, with Undo', async page => {
  await board(page)
  const columns = await page.locator('[data-column]').evaluateAll(e => e.map(x => x.getAttribute('data-column')))
  const addColumn = await page.locator('.database-column.is-add').count()
  await drag(page, page.locator('[data-column="none"] [data-card="emma"]'), page.locator('[data-column="herbert"]'))
  const r = { columns, addColumn, emma: pageOf('emma').values?.by, wrote: pageOf('herbert').values?.wrote, notice: await notices(page) }
  await page.getByRole('button', { name: 'Undo' }).first().click(); await wait(1500)
  r.undone = pageOf('emma').values?.by ?? null; r.wroteAfter = pageOf('herbert').values?.wrote
  return { ...r, ok: columns.join() === 'herbert,austen,none' && addColumn === 0 && r.emma?.join() === 'herbert' && r.wrote?.includes('emma') && /Moved to Herbert/.test(r.notice) && r.undone === null && !r.wroteAfter?.includes('emma') }
})
await scenario('+ New at the foot of a relation column starts linked to it', async page => {
  await board(page)
  await page.locator('[data-column="austen"] .database-new').click(); await wait(800); await page.keyboard.type('New by Austen'); await page.keyboard.press('Enter'); await wait(1500)
  const ws = store(), row = ws.pages.find(p => p.title === 'New by Austen'), austen = ws.pages.find(p => p.id === 'austen')
  return { by: row?.values?.by, wrote: austen.values?.wrote, ok: row?.values?.by?.join() === 'austen' && austen.values?.wrote?.includes(row.id) }
})
await scenario('a table grouped by a rollup: its value is the group, with no way to set it', async page => {
  await page.locator('.database-more-button').first().click(); await wait(200)
  await menu(page).getByRole('button', { name: 'Group' }).click(); await wait(300)
  const choices = await menu(page).locator('[role=menuitem], [role=menuitemradio], option').allInnerTexts()
  await menu(page).locator('[role=menuitem], [role=menuitemradio]', { hasText: 'Ages' }).first().click({ timeout: 4000 }).catch(async () => { await menu(page).locator('select').first().selectOption({ label: 'Ages' }) }); await wait(1500)
  await page.keyboard.press('Escape'); await wait(300)
  const heads = (await page.locator('.database-group-inner').allInnerTexts()).map(t => t.replace(/\s+/g, ' '))
  // A drag to another group can't set what it works out to: it says so, and nothing changes.
  const before = JSON.stringify(pageOf('dune').values)
  const handle = page.locator('.database-row[data-row="dune"] .database-row-handle')
  await page.locator('.database-row[data-row="dune"]').hover(); await wait(150)
  await drag(page, handle, page.locator('.database-row[data-row="emma"]'))
  const notice = await notices(page), same = JSON.stringify(pageOf('dune').values) === before
  return { choices: choices.length, heads, notice, same, ok: heads.some(t => t.includes('106')) && heads.some(t => t.includes('No value')) && /Ages can't be changed/.test(notice) && same }
})
await browser.close()
console.log(failed ? `FAIL ${failed}` : 'PASS')
if (failed) process.exit(1)
