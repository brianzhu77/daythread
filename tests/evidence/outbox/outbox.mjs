// B98, the outbox in the built app (docs/design/outbox.md §10). Each case reseeds the store, makes a change while its
// request is held in the browser (as on a slow network or a busy queue), reloads or closes the page, and reads the
// server's store directly to see what stuck.
// Usage: node tests/evidence/outbox/outbox.mjs <base-url> <store-path> [chromium|webkit]
//   The server at <base-url> serves <store-path> (seeded by tests/evidence/outbox/seed.ts; this script reseeds it).
import * as pw from '@playwright/test'
import { execSync } from 'node:child_process'
import { DatabaseSync } from 'node:sqlite'
import { SqliteWorkspaceRepository } from '../../../src/server/sqlite-repository.ts'
const [base, storePath, only] = process.argv.slice(2), results = []
if (!base || !storePath) { console.error('Usage: node tests/evidence/outbox/outbox.mjs <base-url> <store-path> [chromium|webkit]'); process.exit(2) }
const ok = (name, pass, detail = '') => { results.push(pass); console.log(`${pass ? 'PASS' : 'FAIL'} ${name}${detail ? ` · ${detail}` : ''}`) }
const wait = ms => new Promise(r => setTimeout(r, ms))
const reseed = () => execSync(`node --no-warnings tests/evidence/outbox/seed.ts ${storePath}`, { stdio: 'ignore' })
const stored = () => { const db = new DatabaseSync(storePath, { readOnly: true }); try { return JSON.parse(db.prepare('SELECT data FROM workspace WHERE id = 1').get().data) } finally { db.close() } }
const statusOf = title => stored().tasks.find(t => t.title === title)?.status
/** Another device: a command straight on the store, as the server would apply it from another tab. */
const elsewhere = async action => {
  for (let i = 0; ; i++) {
    const r = new SqliteWorkspaceRepository(storePath), w = await r.load()
    try { return await r.execute({ operationId: crypto.randomUUID(), expectedRevision: w.revision, action: typeof action === 'function' ? action(w) : action }) }
    catch (e) { if (i > 3 || !/Saved elsewhere/.test(String(e))) throw e; await wait(300) }
  }
}
const today = () => new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Vancouver' }).format(new Date())
const OUTBOX = '**/_serverFn/cedd5fc6*'

for (const engine of only ? [only] : ['chromium', 'webkit']) {
  const browser = await pw[engine].launch()
  const tag = engine
  const fresh = async () => { const context = await browser.newContext({ viewport: { width: 1280, height: 900 }, serviceWorkers: 'block' }); const page = await context.newPage(); const errors = []; page.on('pageerror', e => errors.push(e.message)); page.on('dialog', d => d.accept().catch(() => {})); return { context, page, errors } }
  const settle = async page => { await page.waitForLoadState('networkidle').catch(() => {}); await wait(400) }
  const openTasks = async page => { await page.goto(`${base}/tasks?view=open`); await page.getByRole('checkbox', { name: /^Mark / }).first().waitFor({ timeout: 20000 }); await settle(page) }
  const tick = (page, title) => page.getByRole('checkbox', { name: `Mark ${title} done` }).click()
  /** Holds every outbox request until released; `reach`: let it reach the server, hold only the answer. */
  const hold = async (page, reach = false) => {
    const held = []
    await page.route(OUTBOX, async route => {
      if (reach) { const res = await route.fetch().catch(() => null); held.push(() => res && route.fulfill({ response: res }).catch(() => {})) }
      else held.push(() => route.continue().catch(() => {}))
      await new Promise(() => {})
    })
    return held
  }

  // 1. A tick that hadn't left when the page reloaded is applied on the next open, with nothing said.
  {
    reseed(); const { context, page, errors } = await fresh()
    await openTasks(page); await hold(page); await tick(page, 'Water the plants'); await wait(400)
    await page.unrouteAll({ behavior: 'ignoreErrors' }); await page.reload(); await settle(page); await wait(800)
    const banner = await page.locator('.banner.save-failed').count()
    ok(`${tag} 1 a tick not yet sent survives a reload, applied on the next open, nothing said`, statusOf('Water the plants') === 'done' && banner === 0, `status ${statusOf('Water the plants')}, banner ${banner}, errors ${errors.length}`)
    await context.close()
  }
  // 1b. The same with the tab closed and opened again.
  {
    reseed(); const { context, page } = await fresh()
    await openTasks(page); await hold(page); await tick(page, 'Call the bank'); await wait(400)
    await page.close({ runBeforeUnload: false })
    const again = await context.newPage(); await openTasks(again); await wait(800)
    ok(`${tag} 1b a tick not yet sent survives the tab closing, applied when it's opened again`, statusOf('Call the bank') === 'done', `status ${statusOf('Call the bank')}`)
    await context.close()
  }
  // 2. Three queued changes replay in the order he made them.
  {
    reseed(); const { context, page } = await fresh()
    await openTasks(page); await hold(page)
    for (const t of ['Water the plants', 'Call the bank', 'Pay rent']) { await tick(page, t); await wait(150) }
    await wait(300); await page.unrouteAll({ behavior: 'ignoreErrors' }); await page.reload(); await settle(page); await wait(1200)
    const ws = stored(), done = ['Water the plants', 'Call the bank', 'Pay rent'].map(t => ws.tasks.find(x => x.title === t)?.status)
    const receipts = Object.values(ws.receipts).filter(r => r.message && r.revision > 8).sort((a, b) => a.revision - b.revision)
    ok(`${tag} 2 three queued ticks replay, all applied, in order`, done.every(s => s === 'done') && ws.revision === 11, `${done.join(',')} revision ${ws.revision}`)
    void receipts
    await context.close()
  }
  // 3. A tick that reached the server but whose answer was lost is applied once.
  {
    reseed(); const { context, page } = await fresh()
    await openTasks(page); await hold(page, true); await tick(page, 'Pay rent'); await wait(800)
    const committed = stored().revision
    await page.unrouteAll({ behavior: 'ignoreErrors' }); await page.reload(); await settle(page); await wait(1000)
    ok(`${tag} 3 a reply lost after the server applied it: applied once, by its operation id`, statusOf('Pay rent') === 'done' && stored().revision === committed && committed === 9, `revision ${committed} → ${stored().revision}`)
    await context.close()
  }
  // 1c. A cell edit (a change built from the database as it is) not yet sent survives a reload.
  {
    reseed(); const { context, page } = await fresh()
    await page.goto(`${base}/pages?page=runs`); await page.locator('[data-cell*="|r1|st"]').first().waitFor({ timeout: 20000 }); await settle(page)
    await hold(page)
    await page.locator('[data-cell*="|r1|st"]').first().click(); await page.getByRole('option', { name: 'Done' }).click().catch(() => page.getByText('Done', { exact: true }).last().click()); await page.keyboard.press('Escape'); await wait(400)
    await page.unrouteAll({ behavior: 'ignoreErrors' }); await page.reload(); await settle(page); await wait(1000)
    const st = stored().pages.find(p => p.id === 'r1')?.values?.st
    ok(`${tag} 1c a cell edit not yet sent survives a reload, applied on the next open`, st === 'b', `Stage ${st}`)
    await context.close()
  }
  // 14. open → done → open elsewhere: an old queued "done" is held, not applied, and he's told.
  {
    reseed(); const { context, page } = await fresh()
    await openTasks(page); await hold(page); await tick(page, 'Water the plants'); await wait(400)
    await page.close({ runBeforeUnload: false })
    // Elsewhere: done, then open again.
    await elsewhere(w => ({ type: 'task-status', taskId: w.tasks.find(t => t.title === 'Water the plants').id, status: 'done', today: today() }))
    await elsewhere(w => ({ type: 'task-status', taskId: w.tasks.find(t => t.title === 'Water the plants').id, status: 'open', today: today() }))
    const reopened = statusOf('Water the plants')
    const again = await context.newPage(); await openTasks(again); await wait(1200)
    const text = await again.locator('.banner.save-failed').innerText().catch(() => '')
    ok(`${tag} 14 an old "done" for a to-do reopened elsewhere is held and named, not applied`, reopened === 'open' && statusOf('Water the plants') === 'open' && /Not saved — ticked "Water the plants" was changed elsewhere/.test(text) && /Keep mine/.test(text) && /Discard/.test(text), `${reopened} → ${statusOf('Water the plants')} · "${text.replace(/\s+/g, ' ')}"`)
    await again.getByRole('button', { name: 'Discard' }).click(); await settle(again)
    ok(`${tag} 14b Discard drops it; the banner goes; the latest is shown`, await again.locator('.banner.save-failed').count() === 0 && statusOf('Water the plants') === 'open')
    await context.close()
  }
  // 10. No IndexedDB: changes go as before, nothing claims they were kept.
  {
    reseed(); const { context, page } = await fresh()
    // As in a private window or a full disk: the store is there but won't open.
    await page.addInitScript(() => { IDBFactory.prototype.open = function () { throw new DOMException('Storage unavailable', 'InvalidStateError') } })
    await openTasks(page); await tick(page, 'Call the bank'); await settle(page); await wait(500)
    ok(`${tag} 10 with no IndexedDB the tick is sent as before`, statusOf('Call the bank') === 'done')
    await context.close()
  }
  // 11. Two tabs open on the next load: the change is applied once.
  {
    reseed(); const { context, page } = await fresh()
    await openTasks(page); await hold(page); await tick(page, 'Pay rent'); await wait(400)
    await page.close({ runBeforeUnload: false })
    const [a, b] = [await context.newPage(), await context.newPage()]
    await Promise.all([a.goto(`${base}/tasks?view=open`), b.goto(`${base}/tasks?view=open`)]); await settle(a); await settle(b); await wait(1200)
    ok(`${tag} 11 two tabs opening with one stored change apply it once`, statusOf('Pay rent') === 'done' && stored().revision === 9, `revision ${stored().revision}`)
    await context.close()
  }
  await browser.close()
}
const failed = results.filter(r => !r).length
console.log(`\n${results.length - failed}/${results.length} passed`)
process.exit(failed ? 1 : 0)
