// Focused extraction of author cases 19–20 for the owner-lock repair review.
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
const reseed = (variant = '') => execSync(`node --no-warnings tests/evidence/outbox/seed.ts ${storePath} ${variant}`, { stdio: 'ignore' })
const stored = () => {
  for (let i = 0; ; i++) {
    try { const db = new DatabaseSync(storePath, { readOnly: true, timeout: 2000 }); try { return JSON.parse(db.prepare('SELECT data FROM workspace WHERE id = 1').get().data) } finally { db.close() } }
    catch (e) { if (i > 5 || !/locked|busy/i.test(String(e))) throw e }
  }
}
const statusOf = title => stored().tasks.find(t => t.title === title)?.status
/** Another device: a command straight on the store, as the server would apply it from another tab. */
const elsewhere = async action => {
  for (let i = 0; ; i++) {
    const r = new SqliteWorkspaceRepository(storePath), w = await r.load()
    try { return await r.execute({ operationId: crypto.randomUUID(), expectedRevision: w.revision, action: typeof action === 'function' ? action(w) : action }) }
    catch (e) { if (i > 3 || !/Saved elsewhere|locked|busy/.test(String(e))) throw e; await wait(300) }
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
  /** Every outbox request fails as if offline: the change stays stored and never reaches the server, so closing the
   *  page can't let a held request through (Chromium may deliver one held by a route as the page closes). */
  const cut = page => page.route(OUTBOX, route => route.abort('internetdisconnected'))
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

  const outboxCount = p => p.evaluate(() => new Promise(resolve => { const r = indexedDB.open('daythread-outbox', 1); r.onsuccess = () => { const c = r.result.transaction('entries').objectStore('entries').count(); c.onsuccess = () => resolve(c.result) }; r.onerror = () => resolve(-1) }))
  const stage = async page => { await page.locator('[data-cell*="|r1|st"]').first().click(); await page.getByRole('option', { name: 'Done' }).click().catch(() => page.getByText('Done', { exact: true }).last().click()); await page.keyboard.press('Escape') }
  const holdAfterAnswer = async (page, which) => {
    let answered = false, release; const gate = new Promise(r => { release = r })
    page.on('response', r => { if (r.url().includes('/_serverFn/cedd5fc6')) answered = true })
    await page.route('**/_serverFn/**', async route => { if (answered && which(route.request())) { await gate; await route.continue().catch(() => {}) } else await route.continue().catch(() => {}) })
    return { answered: () => answered, release }
  }
  const entriesIn = p => p.evaluate(() => new Promise(resolve => { const r = indexedDB.open('daythread-outbox', 1); r.onsuccess = () => { const q = r.result.transaction('entries').objectStore('entries').getAll(); q.onsuccess = () => resolve(q.result.map(e => ({ label: e.label, state: e.state }))) }; r.onerror = () => resolve([]) }))
  // 19f. While tab A's edit waits to be built again, tab B shows it held and he chooses Keep mine there: it's sent from
  //      B, and A's rebuild, coming after, finds it no longer held and isn't stored or sent too (Ratchet 23351123).
  {
    reseed()
    const context = await browser.newContext({ viewport: { width: 1280, height: 900 }, serviceWorkers: 'block' }), a = await context.newPage()
    await a.goto(`${base}/pages?page=runs`); await a.locator('[data-cell*="|r1|st"]').first().waitFor({ timeout: 20000 }); await settle(a)
    await elsewhere({ type: 'rename-page', pageId: 'r1', title: 'Alpha two' })
    const held = await holdAfterAnswer(a, req => !req.url().includes('cedd5fc6'))
    await stage(a)
    for (let i = 0; i < 40 && !held.answered(); i++) await wait(100)
    await wait(400)
    const r0 = stored().revision
    const b = await context.newPage(); await b.goto(`${base}/pages?page=runs`); await b.locator('.banner.save-failed').waitFor({ timeout: 10000 }).catch(() => {}); await settle(b)
    await b.locator('.banner.save-failed').getByRole('button', { name: 'Keep mine' }).click(); await wait(1500); await settle(b)
    held.release(); await wait(2500); await settle(a)
    const unsaved = await a.locator('.database-unsaved').count(); console.log('UNSAVED_AFTER_SUPERSEDED', engine, unsaved);
    const r1 = stored().pages.find(p => p.id === 'r1'), left = await outboxCount(a), banners = await a.locator('.banner.save-failed').count() + await b.locator('.banner.save-failed').count()
    ok(`${tag} 19f Keep mine in another tab while it waited to be built again: sent once, the rebuild not stored or sent too`, r1?.values?.st === 'b' && stored().revision === r0 + 1 && left === 0 && banners === 0 && unsaved === 0, `stage ${r1?.values?.st}, revision ${r0} → ${stored().revision}, left ${left}, banners ${banners}`)
    await context.close()
  }
  await browser.close()
}
process.exit(results.every(Boolean)?0:1)
