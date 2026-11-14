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
  {
    reseed(); const { context, page } = await fresh()
    await page.goto(`${base}/pages?page=runs`); await page.locator('[data-cell*="|r1|st"]').first().waitFor({ timeout: 20000 }); await settle(page)
    await elsewhere({ type: 'rename-page', pageId: 'r1', title: 'Alpha two' })
    await stage(page); await wait(2500); await settle(page)
    const row = stored().pages.find(p => p.id === 'r1'), banner = await page.locator('.banner.save-failed').count(), left = await outboxCount(page)
    ok(`${tag} 19 a cell edited from behind a rename of its row is built again on the latest row: both land, nothing held or left`, row?.values?.st === 'b' && row?.title === 'Alpha two' && banner === 0 && left === 0, `stage ${row?.values?.st}, title ${row?.title}, banner ${banner}, left ${left}`)
    await context.close()
  }
  // 19b. The same, but the tab closes after the edit is given back and before it's built again: it isn't lost; the next
  //      open shows it held, for him to keep or discard (Lead bd4cc39e).
  {
    reseed(); const { context, page } = await fresh()
    await page.goto(`${base}/pages?page=runs`); await page.locator('[data-cell*="|r1|st"]').first().waitFor({ timeout: 20000 }); await settle(page)
    await elsewhere({ type: 'rename-page', pageId: 'r1', title: 'Alpha two' })
    // Once the edit has been answered, every load hangs: the refresh before the rebuild never comes back.
    let answered = false
    page.on('response', r => { if (r.url().includes('/_serverFn/cedd5fc6')) answered = true })
    await page.route('**/_serverFn/**', async route => { if (answered && !route.request().url().includes('cedd5fc6')) await new Promise(() => {}); else await route.continue().catch(() => {}) })
    await stage(page)
    for (let i = 0; i < 40 && !answered; i++) await wait(100)
    await wait(400)
    await page.close({ runBeforeUnload: false })
    const again = await context.newPage(); await again.goto(`${base}/pages?page=runs`); await again.locator('.banner.save-failed').waitFor({ timeout: 10000 }).catch(() => {}); await settle(again)
    const text = (await again.locator('.banner.save-failed').innerText().catch(() => '')).replace(/\s+/g, ' ').trim()
    ok(`${tag} 19b closed between being given back and built again: the edit is kept and shown held ("${text}")`, stored().pages.find(p => p.id === 'r1')?.values?.st === 'a' && /changed elsewhere/.test(text) && /Keep mine/.test(text), `answered ${answered}`)
    await context.close()
  }
  /** After the first outbox answer, holds what `which` picks until `release()`; the page sees nothing back meanwhile. */
  const holdAfterAnswer = async (page, which) => {
    let answered = false, release; const gate = new Promise(r => { release = r })
    page.on('response', r => { if (r.url().includes('/_serverFn/cedd5fc6')) answered = true })
    await page.route('**/_serverFn/**', async route => { if (answered && which(route.request())) { await gate; await route.continue().catch(() => {}) } else await route.continue().catch(() => {}) })
    return { answered: () => answered, release }
  }
  const entriesIn = p => p.evaluate(() => new Promise(resolve => { const r = indexedDB.open('daythread-outbox', 1); r.onsuccess = () => { const q = r.result.transaction('entries').objectStore('entries').getAll(); q.onsuccess = () => resolve(q.result.map(e => ({ label: e.label, state: e.state }))) }; r.onerror = () => resolve([]) }))
  // 19c. The rebuild can't be stored (the device's storage fails) and can't be sent either: the original stays, and the
  //      next open shows it held (Ratchet 6804fae5).
  {
    reseed(); const { context, page } = await fresh()
    await page.goto(`${base}/pages?page=runs`); await page.locator('[data-cell*="|r1|st"]').first().waitFor({ timeout: 20000 }); await settle(page)
    await elsewhere({ type: 'rename-page', pageId: 'r1', title: 'Alpha two' })
    // Every send after the answer hangs: the rebuild, unstored, would go through the old path too.
    const held = await holdAfterAnswer(page, req => req.method() === 'POST')
    // Every store write after the first one fails.
    await page.evaluate(() => { const add = IDBObjectStore.prototype.add; let n = 0; IDBObjectStore.prototype.add = function (...a) { if (++n > 1) throw new DOMException('Quota', 'QuotaExceededError'); return add.apply(this, a) } })
    await stage(page)
    for (let i = 0; i < 40 && !held.answered(); i++) await wait(100)
    await wait(1500)
    await page.close({ runBeforeUnload: false })
    const again = await context.newPage(); await again.goto(`${base}/pages?page=runs`); await again.locator('.banner.save-failed').waitFor({ timeout: 10000 }).catch(() => {}); await settle(again)
    const text = (await again.locator('.banner.save-failed').innerText().catch(() => '')).replace(/\s+/g, ' ').trim()
    ok(`${tag} 19c its rebuild couldn't be stored or sent: the original is kept and shown held ("${text}")`, stored().pages.find(p => p.id === 'r1')?.values?.st === 'a' && /set Stage on "Alpha" was changed elsewhere/.test(text) && /Keep mine/.test(text), `r1 ${stored().pages.find(p => p.id === 'r1')?.values?.st}, stored ${JSON.stringify(await entriesIn(again))}`)
    await context.close()
  }
  // 19d. While the edit waits to be built again, an unrelated change is made: it doesn't take the original's place. The
  //      tab closes; the next open shows the original held and sends the unrelated change (Ratchet 6804fae5).
  {
    reseed(); const { context, page } = await fresh()
    await page.goto(`${base}/pages?page=runs`); await page.locator('[data-cell*="|r1|st"]').first().waitFor({ timeout: 20000 }); await settle(page)
    await elsewhere({ type: 'rename-page', pageId: 'r1', title: 'Alpha two' })
    const held = await holdAfterAnswer(page, req => !req.url().includes('cedd5fc6'))
    await stage(page)
    for (let i = 0; i < 40 && !held.answered(); i++) await wait(100)
    await wait(400)
    await page.locator('[data-cell*="|r2|st"]').first().click(); await page.getByRole('option', { name: 'Done' }).click().catch(() => page.getByText('Done', { exact: true }).last().click()); await page.keyboard.press('Escape'); await wait(800)
    const during = await entriesIn(page)
    await page.close({ runBeforeUnload: false })
    const again = await context.newPage(); await again.goto(`${base}/pages?page=runs`); await again.locator('.banner.save-failed').waitFor({ timeout: 10000 }).catch(() => {}); await settle(again); await wait(1000)
    const text = (await again.locator('.banner.save-failed').innerText().catch(() => '')).replace(/\s+/g, ' ').trim()
    const [r1, r2] = ['r1', 'r2'].map(id => stored().pages.find(p => p.id === id)?.values?.st)
    ok(`${tag} 19d an unrelated change made meanwhile doesn't replace it: the original is held, the other change sent ("${text}")`, r1 === 'a' && r2 === 'b' && /set Stage on "Alpha" was changed elsewhere/.test(text), `r1 ${r1}, r2 ${r2}, stored then ${JSON.stringify(during)}`)
    await context.close()
  }
  // 19e. While tab A's edit waits to be built again, tab B makes a change on the same row: once A's rebuild takes the
  //      original's place, B's change, made on top of it, is held for him to decide, and A's rebuild, later than B's
  //      change, waits behind it: nothing is sent on top of anything (Ratchet 13832939, Lead bd4cc39e).
  {
    reseed()
    const context = await browser.newContext({ viewport: { width: 1280, height: 900 }, serviceWorkers: 'block' }), a = await context.newPage(), b = await context.newPage()
    await a.goto(`${base}/pages?page=runs`); await a.locator('[data-cell*="|r1|st"]').first().waitFor({ timeout: 20000 }); await settle(a)
    await elsewhere({ type: 'rename-page', pageId: 'r1', title: 'Alpha two' })
    const held = await holdAfterAnswer(a, req => !req.url().includes('cedd5fc6'))
    await stage(a)
    for (let i = 0; i < 40 && !held.answered(); i++) await wait(100)
    await wait(400)
    await b.goto(`${base}/pages?page=runs`); await b.locator('[data-cell*="|r1|st"]').first().waitFor({ timeout: 20000 }); await settle(b)
    const r1Before = stored().pages.find(p => p.id === 'r1')
    await b.locator('[data-cell*="|r1|st"]').first().click(); await b.getByRole('option', { name: 'Done' }).click().catch(() => b.getByText('Done', { exact: true }).last().click()); await b.keyboard.press('Escape'); await wait(1200)
    held.release(); await wait(2500); await settle(a)
    const states = await entriesIn(a), r1 = stored().pages.find(p => p.id === 'r1')
    const text = (await a.locator('.banner.save-failed').innerText().catch(() => '')).replace(/\s+/g, ' ').trim()
    ok(`${tag} 19e tab B's change on the row, made while A's waited, is held once A's rebuild replaces it; the rebuild waits behind it ("${text}")`, r1?.values?.st === r1Before?.values?.st && states.filter(e => e.state === 'held').length === 1 && states.filter(e => e.state === 'pending').length === 1 && /changed since · 1 later change waiting/.test(text), `r1 ${r1Before?.values?.st} → ${r1?.values?.st}, stored ${JSON.stringify(states)}`)
    await context.close()
  }
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
    const r1 = stored().pages.find(p => p.id === 'r1'), left = await outboxCount(a), banners = await a.locator('.banner.save-failed').count() + await b.locator('.banner.save-failed').count()
    ok(`${tag} 19f Keep mine in another tab while it waited to be built again: sent once, the rebuild not stored or sent too`, r1?.values?.st === 'b' && stored().revision === r0 + 1 && left === 0 && banners === 0, `stage ${r1?.values?.st}, revision ${r0} → ${stored().revision}, left ${left}, banners ${banners}`)
    await context.close()
  }
  // 20. A typed cell whose answer is lost: its retry lands it once, by its own operation id; its draft (kept for a closed
  //     tab) is never sent again as a second change; nothing is held or left, and the next edit goes (gate 4d6fbafe).
  {
    reseed(); await elsewhere({ type: 'change-database', pageId: 'runs', change: { kind: 'addProperty', property: { id: 'note', name: 'Note', type: 'text' } } })
    const { context, page } = await fresh()
    const typeIn = async (row, words) => { await page.locator(`[data-cell*="|${row}|note"]`).first().click(); await wait(200); await page.keyboard.type(words, { delay: 10 }); await page.keyboard.press('Enter') }
    await page.goto(`${base}/pages?page=runs`); await page.locator('[data-cell*="|r1|note"]').first().waitFor({ timeout: 20000 }); await settle(page)
    await typeIn('r1', 'hello'); await wait(1600); await settle(page)
    const ops = new Set(), r0 = stored().revision
    page.on('request', r => { if (r.url().includes('/_serverFn/cedd5fc6')) ops.add(/"s":"([0-9a-f-]{36})"/.exec(decodeURIComponent(r.postData() ?? ''))?.[1]) })
    await page.route(OUTBOX, async r => { await r.fetch().catch(() => null); await r.abort().catch(() => {}) })
    await typeIn('r1', ' lost'); await wait(2200); await page.unroute(OUTBOX); await wait(9000); await settle(page)
    const note = stored().pages.find(p => p.id === 'r1')?.values?.note, banner = await page.locator('.banner.save-failed').count(), unsaved = await page.locator('.database-unsaved').count()
    ok(`${tag} 20 a typed cell whose answer was lost lands once, by its own id; nothing held, nothing left`, note === 'hello lost' && stored().revision === r0 + 1 && ops.size === 1 && banner === 0 && unsaved === 0 && await outboxCount(page) === 0, `note ${note}, revision ${r0} → ${stored().revision}, ops ${ops.size}, banner ${banner}, unsaved ${unsaved}`)
    await typeIn('r2', 'next'); await wait(1600); await settle(page)
    ok(`${tag} 20b the next edit goes`, stored().pages.find(p => p.id === 'r2')?.values?.note === 'next', `r2 ${stored().pages.find(p => p.id === 'r2')?.values?.note}`)
    await context.close()
  }
  await browser.close()
}
const failed = results.filter(r => !r).length
console.log(`${results.length-failed}/${results.length} passed`)
process.exit(failed?1:0)
