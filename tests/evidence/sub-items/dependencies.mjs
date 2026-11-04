// R4-5, without arrows: turned on in the menu, a date moved in a cell, the chain following, the notice, one Undo.
// Usage: node tests/evidence/sub-items/dependencies.mjs <base-url> <store-path> [chromium|webkit]  (a throwaway store the server at <base-url> uses)
import * as pw from '@playwright/test'
import { execSync } from 'node:child_process'
const [base, storePath, engine = 'chromium'] = process.argv.slice(2)
if (!base || !storePath) { console.error('Usage: node tests/evidence/sub-items/dependencies.mjs <base-url> <store-path> [chromium|webkit]'); process.exit(2) }
const store = () => JSON.parse(execSync(`sqlite3 ${storePath} "select data from workspace"`, { maxBuffer: 1 << 26 }).toString())
const when = id => { const v = store().pages.find(p => p.id === id).values.when; return typeof v === 'string' ? v : v?.start }
const wait = ms => new Promise(r => setTimeout(r, ms))
const browser = await pw[engine].launch({ headless: true })
let failed = 0
const scenario = async (name, seed, act) => {
  execSync(`rm -f ${storePath} ${storePath}-wal ${storePath}-shm && node --no-warnings tests/evidence/sub-items/dep-seed.ts ${storePath} ${seed}`, { stdio: 'ignore' })
  const context = await browser.newContext({ viewport: { width: 1280, height: 900 } })
  const page = await context.newPage(), errors = []
  page.on('pageerror', e => { if (!/ResizeObserver loop/.test(e.message)) errors.push(e.message) })
  let r
  try { await page.goto(`${base}/pages?page=plan`); await wait(2200); r = await act(page) } catch (e) { r = { ok: false, threw: e.message.split('\n').slice(0, 3).join(' ') } }
  const ok = r.ok && !errors.length
  if (!ok) failed++
  console.log(ok ? 'PASS' : 'FAIL', name, JSON.stringify({ ...r, errors }))
  await context.close()
}
const menu = page => page.locator('.database-menu')
const more = async page => { await page.locator('.database-more-button').first().click(); await wait(250); await menu(page).getByRole('menuitem', { name: 'More settings' }).click(); await wait(250) }
const notices = page => page.locator('[role=alert], [role=status]').allInnerTexts().then(t => t.join(' | ').replace(/\s+/g, ' '))
const pasteDate = async (page, row, date) => {
  await page.locator(`.database-row[data-row="${row}"] [data-nav$=":1"]`).first().focus(); await wait(100)
  await page.evaluate(words => { const data = new DataTransfer(); data.setData('text/plain', words); document.activeElement.dispatchEvent(new ClipboardEvent('paste', { clipboardData: data, bubbles: true, cancelable: true })) }, date)
  await wait(1500)
}
await scenario('Turned on in the menu, with its mode and Avoid weekends; off leaves the rows', '', async page => {
  await more(page)
  await menu(page).getByRole('checkbox', { name: 'Dependencies' }).click(); await wait(1200)
  const db = () => store().pages.find(p => p.id === 'plan').database
  const r = { on: db().dependencies?.mode, relations: db().properties.filter(p => p.type === 'relation').map(p => p.name) }
  await menu(page).getByLabel('When a blocker moves').selectOption('keep'); await wait(1000)
  r.mode = db().dependencies.mode
  await menu(page).getByRole('checkbox', { name: 'Avoid weekends' }).click(); await wait(1000)
  r.weekends = db().dependencies.avoidWeekends
  await menu(page).getByRole('checkbox', { name: 'Dependencies' }).click(); await wait(1000)
  r.off = db().dependencies ?? null; r.kept = db().properties.filter(p => p.type === 'relation').length
  await menu(page).getByRole('checkbox', { name: 'Dependencies' }).click(); await wait(1000)
  r.sameLinks = db().properties.filter(p => p.type === 'relation').length === 2 && Boolean(db().dependencies)
  r.ok = r.on === 'overlap' && r.relations.join() === 'Blocked by,Blocking' && r.mode === 'keep' && r.weekends === true && r.off === null && r.kept === 2 && r.sameLinks
  return r
})
await scenario('A date moved in a cell takes the chain with it, says how many, and one Undo returns them all', 'on', async page => {
  await pasteDate(page, 'a', '2026-03-10')
  const r = { a: when('a'), b: when('b'), c: when('c'), d: when('d'), notice: await notices(page) }
  await page.getByRole('button', { name: 'Undo' }).first().click(); await wait(1500)
  r.back = [when('a'), when('b'), when('c'), when('d')]
  r.ok = r.a === '2026-03-10' && r.b === '2026-03-11' && r.c === '2026-03-12' && r.d === '2026-03-13' && /3 rows moved/.test(r.notice) && !/hidden/.test(r.notice) && r.back.join() === '2026-03-02,2026-03-03,2026-03-04,2026-03-05'
  return r
})
await scenario('A filtered-out row in a chain moves too, and the notice says so', 'on', async page => {
  await page.goto(`${base}/pages?page=plan`); await wait(1800)
  const view = store().pages.find(p => p.id === 'plan').database.views[0].id
  execSync(`node --no-warnings --input-type=module -e "
    import { SqliteWorkspaceRepository } from '${process.cwd()}/src/server/sqlite-repository.ts'
    const repo = new SqliteWorkspaceRepository('${storePath}', undefined, { allowMissingLegacy: true }); const ws = await repo.load()
    await repo.execute({ operationId: crypto.randomUUID(), expectedRevision: ws.revision, action: { type: 'change-database', pageId: 'plan', change: { kind: 'updateView', viewId: '${view}', filter: [{ by: 'title', op: 'doesNotContain', value: 'c' }] } } })"`, { stdio: 'ignore' })
  await page.goto(`${base}/pages?page=plan`); await wait(1800)
  const shown = await page.locator('.database-row').count()
  await pasteDate(page, 'a', '2026-03-10')
  const r = { shown, c: when('c'), notice: await notices(page) }
  r.ok = shown === 3 && r.c === '2026-03-12' && /3 rows moved · 1 is hidden/.test(r.notice)
  return r
})
await browser.close()
console.log(failed ? `${failed} FAILED` : 'ALL PASS')
process.exit(failed ? 1 : 0)
