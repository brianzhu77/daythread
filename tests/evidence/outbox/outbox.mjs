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

  // 1. A tick that hadn't left when the page reloaded is applied on the next open, with nothing said.
  {
    reseed(); const { context, page, errors } = await fresh()
    await openTasks(page); await hold(page); await tick(page, 'Water the plants'); await wait(400)
    await page.unrouteAll({ behavior: 'ignoreErrors' }); await page.reload(); await settle(page); await wait(800)
    const banner = await page.locator('.banner.save-failed').count()
    ok(`${tag} 1 a tick not yet sent survives a reload, applied on the next open, nothing said`, statusOf('Water the plants') === 'done' && banner === 0, `status ${statusOf('Water the plants')}, banner ${banner}, errors ${errors.length}`)
    await context.close()
  }
  // 1d. No flicker (Jazz §8.1): after the reload, the first frame that shows the to-do already shows it ticked.
  {
    reseed(); const { context, page } = await fresh()
    await page.goto(`${base}/`); await page.getByRole('checkbox', { name: 'Complete Water the plants' }).waitFor({ timeout: 20000 }); await settle(page)
    await hold(page); await page.getByRole('checkbox', { name: 'Complete Water the plants' }).click(); await wait(400)
    await page.unrouteAll({ behavior: 'ignoreErrors' })
    await page.addInitScript(() => {
      const seen = []
      const look = () => { const box = document.querySelector('input[aria-label="Complete Water the plants"], [aria-label="Complete Water the plants"]'); if (box) seen.push(box.checked ?? box.getAttribute('aria-checked') === 'true') }
      new MutationObserver(look).observe(document, { subtree: true, childList: true, attributes: true, attributeFilter: ['checked', 'aria-checked', 'class'] })
      const frame = () => { look(); if (seen.length < 400) requestAnimationFrame(frame) }
      requestAnimationFrame(frame)
      window.__seen = seen
    })
    await page.reload(); await page.getByRole('checkbox', { name: 'Complete Water the plants' }).waitFor({ timeout: 20000 }); await settle(page); await wait(800)
    const seen = await page.evaluate(() => window.__seen)
    ok(`${tag} 1d after the reload the to-do is ticked from the first frame it shows (no unticked frame)`, seen.length > 0 && seen.every(Boolean) && statusOf('Water the plants') === 'done', `${seen.length} samples, first ${seen[0]}, any unticked ${seen.some(v => !v)}`)
    await context.close()
  }
  // 1e. A delete (a row deleted from its own page) not yet sent survives a reload: it doesn't come back.
  {
    reseed(); const { context, page } = await fresh()
    await page.goto(`${base}/pages?page=r2`); await page.getByRole('button', { name: 'Row actions' }).first().waitFor({ timeout: 20000 }); await settle(page)
    await hold(page)
    await page.getByRole('button', { name: 'Row actions' }).first().click(); await page.getByRole('menuitem', { name: 'Delete row' }).click(); await wait(500)
    await page.unrouteAll({ behavior: 'ignoreErrors' }); await page.goto(`${base}/pages?page=runs`); await settle(page); await wait(1200)
    const r2 = stored().pages.find(p => p.id === 'r2')
    ok(`${tag} 1e a row deleted, not yet sent, stays deleted after a reload`, !r2 || Boolean(r2.trashedAt), r2 ? `trashedAt ${r2.trashedAt}` : 'gone')
    await context.close()
  }
  // 1f. A move (a to-do moved off today with Not today) not yet sent survives a reload.
  {
    reseed(); const { context, page } = await fresh()
    await page.goto(`${base}/`); await page.getByRole('button', { name: 'Actions for Pay rent' }).waitFor({ timeout: 20000 }); await settle(page)
    const base0 = stored().revision
    await hold(page)
    await page.getByRole('button', { name: 'Actions for Pay rent' }).click(); await page.getByRole('menuitem', { name: /^Not today/ }).first().click(); await wait(500)
    await page.unrouteAll({ behavior: 'ignoreErrors' }); await page.reload(); await settle(page); await wait(1200)
    const receipt = Object.values(stored().receipts).find(r => r.revision === base0 + 1)
    ok(`${tag} 1f a to-do moved off today, not yet sent, is moved after a reload`, stored().revision === base0 + 1 && Boolean(receipt) && await page.locator('.banner.save-failed').count() === 0, `revision ${base0} → ${stored().revision}, "${receipt?.message ?? ''}"`)
    await context.close()
  }
  // 1b. The same with the tab closed and opened again.
  {
    reseed(); const { context, page } = await fresh()
    await openTasks(page); await cut(page); await tick(page, 'Call the bank'); await wait(400)
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
  // 12. On today's page: a to-do ticked and a line typed, then the page reloads at once. Both kept, with no notice (Jazz ef6b418a).
  {
    reseed(); const { context, page } = await fresh()
    await page.goto(`${base}/`); await page.getByRole('checkbox', { name: 'Complete Water the plants' }).waitFor({ timeout: 20000 }); await settle(page)
    await hold(page)
    await page.getByRole('checkbox', { name: 'Complete Water the plants' }).click(); await wait(200)
    await page.getByText('Pay rent', { exact: true }).click(); await page.keyboard.press('End'); await page.keyboard.press('Enter'); await page.keyboard.type('a line typed before the reload')
    await page.unrouteAll({ behavior: 'ignoreErrors' }); await page.reload(); await settle(page); await wait(2000)
    const day = stored().pages.find(p => p.date === today())
    const line = (day?.document ?? '').includes('a line typed before the reload'), banner = await page.locator('.banner.save-failed').count()
    ok(`${tag} 12 a tick and a line on the same page, reloaded at once: both kept, no notice`, statusOf('Water the plants') === 'done' && line && banner === 0, `status ${statusOf('Water the plants')}, line ${line}, banner ${banner}`)
    await context.close()
  }
  // 2b. A second tap while the tick is still on its way unticks it: shown open at once, stored as its own change, replayed
  //     after the tick (B98 item 2, Bumblebee 476900b9).
  {
    reseed(); const { context, page } = await fresh()
    await page.goto(`${base}/`); await page.getByRole('checkbox', { name: 'Complete Water the plants' }).waitFor({ timeout: 20000 }); await settle(page)
    const base0 = stored().revision
    await hold(page)
    const box = page.getByRole('checkbox', { name: 'Complete Water the plants' })
    await box.click(); await wait(700); await box.click(); await wait(400)
    const shownOpen = await box.isChecked().catch(() => null)
    await page.unrouteAll({ behavior: 'ignoreErrors' }); await page.reload(); await settle(page); await wait(1500)
    ok(`${tag} 2b a second tap during the tick's send unticks it, shown at once, replayed after the tick`, shownOpen === false && statusOf('Water the plants') === 'open' && stored().revision === base0 + 2 && await page.getByRole('checkbox', { name: 'Complete Water the plants' }).isChecked() === false, `shown open ${shownOpen === false}, status ${statusOf('Water the plants')}, revision ${base0} → ${stored().revision}`)
    await context.close()
  }
  // 2c. A double tap 150 ms apart is one tap (B72), with the outbox too: one Done write, the box ticked.
  {
    reseed(); const { context, page } = await fresh()
    await page.goto(`${base}/`); await page.getByRole('checkbox', { name: 'Complete Water the plants' }).waitFor({ timeout: 20000 }); await settle(page)
    const base0 = stored().revision, box = page.getByRole('checkbox', { name: 'Complete Water the plants' })
    await box.click(); await wait(150); await box.click(); await settle(page); await wait(800)
    ok(`${tag} 2c a double tap 150 ms apart is one tick: one write, the box ticked`, statusOf('Water the plants') === 'done' && stored().revision === base0 + 1 && await box.isChecked(), `status ${statusOf('Water the plants')}, revision ${base0} → ${stored().revision}`)
    await context.close()
  }
  // 2d. Offline, a second tap inside the 500 ms window is still the same tap: the box stays ticked, one change kept.
  {
    reseed(); const { context, page } = await fresh()
    await page.goto(`${base}/`); await page.getByRole('checkbox', { name: 'Complete Water the plants' }).waitFor({ timeout: 20000 }); await settle(page)
    const base0 = stored().revision
    await page.route(OUTBOX, route => route.abort('internetdisconnected'))
    const box = page.getByRole('checkbox', { name: 'Complete Water the plants' })
    await box.click(); await wait(300); await box.click(); await wait(600)
    const ticked = await box.isChecked().catch(() => null)
    await page.unrouteAll({ behavior: 'ignoreErrors' }); await page.reload(); await settle(page); await wait(1500)
    ok(`${tag} 2d offline, a second tap 300 ms later is the same tap: ticked, one change sent`, ticked === true && statusOf('Water the plants') === 'done' && stored().revision === base0 + 1, `ticked ${ticked}, status ${statusOf('Water the plants')}, revision ${base0} → ${stored().revision}`)
    await context.close()
  }
  // 6. Offline: a tick and a second tap to undo it are both kept, said in the offline line, and sent in order once the
  //    network is back (Bumblebee ec4ab466, Jazz 3c65a099).
  {
    reseed(); const { context, page } = await fresh()
    await page.goto(`${base}/`); await page.getByRole('checkbox', { name: 'Complete Water the plants' }).waitFor({ timeout: 20000 }); await settle(page)
    const base0 = stored().revision
    await page.route(OUTBOX, route => route.abort('internetdisconnected'))
    const box = page.getByRole('checkbox', { name: 'Complete Water the plants' })
    await box.click(); await wait(700)
    const line = await page.locator('.banner.offline').innerText().catch(() => '')
    const shownDone = await box.isChecked().catch(() => null)
    await box.click(); await wait(600)
    const shownOpen = await box.isChecked().catch(() => null)
    await page.unrouteAll({ behavior: 'ignoreErrors' }); await page.reload(); await settle(page); await wait(1500)
    ok(`${tag} 6 offline: a tick and its undo are kept and said ("${line.trim()}"), then sent in order, the box open`, /Offline · 1 change will be sent/.test(line) && shownDone === true && shownOpen === false && statusOf('Water the plants') === 'open' && stored().revision === base0 + 2 && await page.getByRole('checkbox', { name: 'Complete Water the plants' }).isChecked() === false, `shown ${shownDone}→${shownOpen}, status ${statusOf('Water the plants')}, revision ${base0} → ${stored().revision}`)
    await context.close()
  }
  // 6b. Offline, a tick, then a reload while still offline (the service worker serves the app): the tick shows from the
  //     first frame with the offline line, and is sent once when the network is back (B98 item 6). Chromium only:
  //     Playwright's WebKit doesn't reload a page from the service worker while offline.
  if (engine === 'chromium') {
    reseed()
    const context = await browser.newContext({ viewport: { width: 1280, height: 900 } }), page = await context.newPage()
    await page.goto(`${base}/`); await page.getByRole('checkbox', { name: 'Complete Water the plants' }).waitFor({ timeout: 20000 })
    await page.evaluate(async () => { await navigator.serviceWorker.ready; for (let i = 0; i < 40 && !navigator.serviceWorker.controller; i++) await new Promise(r => setTimeout(r, 100)) })
    await page.reload(); await page.getByRole('checkbox', { name: 'Complete Water the plants' }).waitFor({ timeout: 20000 }); await settle(page); await wait(1500)
    const base0 = stored().revision
    await context.setOffline(true)
    await page.getByRole('checkbox', { name: 'Complete Water the plants' }).click(); await wait(800)
    await page.addInitScript(() => {
      const seen = []; window.__seen = seen
      const look = () => { const box = document.querySelector('[aria-label="Complete Water the plants"]'); if (box) seen.push(box.checked ?? box.getAttribute('aria-checked') === 'true') }
      new MutationObserver(look).observe(document, { subtree: true, childList: true, attributes: true })
    })
    await page.reload().catch(() => {}); await page.getByRole('checkbox', { name: 'Complete Water the plants' }).waitFor({ timeout: 20000 }).catch(() => {}); await wait(1500)
    const line = (await page.locator('.banner.offline').innerText().catch(() => '')).trim()
    const seen = await page.evaluate(() => window.__seen ?? []).catch(() => [])
    const whileOffline = statusOf('Water the plants')
    await context.setOffline(false); await wait(2500); await settle(page)
    ok(`${tag} 6b offline, reloaded offline: shown ticked from the first frame ("${line}"), sent once back online`, whileOffline === 'open' && /1 change will be sent/.test(line) && seen.length > 0 && seen.every(Boolean) && statusOf('Water the plants') === 'done' && stored().revision === base0 + 1, `offline ${whileOffline}, ${seen.length} samples, all ticked ${seen.every(Boolean)}, revision ${base0} → ${stored().revision}`)
    await context.close()
  }
  // 6c. The network comes back with no event (a dead connection, or he returns to the app): the kept tick is sent within
  //     a few seconds by the retry alone, and at once on a return to the tab (Jazz 8887e299, Lead b19f29b0).
  {
    reseed(); const { context, page } = await fresh()
    await page.goto(`${base}/`); await page.getByRole('checkbox', { name: 'Complete Water the plants' }).waitFor({ timeout: 20000 }); await settle(page)
    await cut(page); await page.getByRole('checkbox', { name: 'Complete Water the plants' }).click(); await wait(800)
    await page.unrouteAll({ behavior: 'ignoreErrors' })
    const sentAt = Date.now(); while (statusOf('Water the plants') !== 'done' && Date.now() - sentAt < 8000) await wait(250)
    const byRetry = statusOf('Water the plants') === 'done' ? Date.now() - sentAt : null
    await cut(page); await page.getByRole('checkbox', { name: 'Complete Call the bank' }).click(); await wait(800)
    await page.unrouteAll({ behavior: 'ignoreErrors' })
    await wait(5200) // past the visibility check's 5 s guard
    await page.evaluate(() => { window.dispatchEvent(new Event('focus')) })
    const back = Date.now(); while (statusOf('Call the bank') !== 'done' && Date.now() - back < 3000) await wait(100)
    const onReturn = statusOf('Call the bank') === 'done' ? Date.now() - back : null
    ok(`${tag} 6c no network event: sent by the retry in ${byRetry} ms; on a return to the tab in ${onReturn} ms; no reload`, byRetry !== null && byRetry < 8000 && onReturn !== null && onReturn < 3000)
    await context.close()
  }
  // 6e. Hours later, as it were: the retry has backed off to its 30 s step; the network comes back just after a retry
  //     failed; a return to the tab sends it within about 2 s, long before the next retry (Lead 067eb554).
  {
    reseed(); const { context, page } = await fresh()
    await page.goto(`${base}/`); await page.getByRole('checkbox', { name: 'Complete Water the plants' }).waitFor({ timeout: 20000 }); await settle(page)
    let attempts = 0
    await page.route(OUTBOX, route => { attempts++; return route.abort('internetdisconnected') })
    await page.getByRole('checkbox', { name: 'Complete Water the plants' }).click()
    // The send, then retries after 2 s, 5 s and 15 s: the fourth attempt leaves the next one 30 s away.
    const started = Date.now(); while (attempts < 4 && Date.now() - started < 40000) await wait(200)
    await wait(300); await page.unrouteAll({ behavior: 'ignoreErrors' })
    const before = statusOf('Water the plants')
    const back = Date.now(); await page.evaluate(() => { window.dispatchEvent(new Event('focus')) })
    while (statusOf('Water the plants') !== 'done' && Date.now() - back < 5000) await wait(100)
    const took = statusOf('Water the plants') === 'done' ? Date.now() - back : null
    ok(`${tag} 6e back after the retry reached 30 s: a return to the tab sends it in ${took} ms (${attempts} failed attempts first)`, attempts === 4 && before === 'open' && took !== null && took < 2000)
    await context.close()
  }
  // 6d. An offline open on a new day: the app's own "make today" is kept but never counted or shown; the day made
  //     elsewhere meanwhile, it's dropped unsaid (Jazz 8887e299, Lead b19f29b0).
  {
    reseed('no-today'); const { context, page } = await fresh()
    await cut(page)
    await page.goto(`${base}/`); await wait(2500)
    const line = (await page.locator('.banner.offline').innerText().catch(() => '')).trim()
    await elsewhere({ type: 'ensure-day', date: today() })
    await page.unrouteAll({ behavior: 'ignoreErrors' })
    await wait(5200); await page.evaluate(() => { window.dispatchEvent(new Event('focus')) }); await wait(2500)
    const banner = (await page.locator('.banner.save-failed').innerText().catch(() => '')).trim()
    const left = await page.evaluate(() => new Promise(res => { const r = indexedDB.open('daythread-outbox'); r.onsuccess = () => { const g = r.result.transaction('entries').objectStore('entries').getAll(); g.onsuccess = () => res(g.result.length) } }))
    ok(`${tag} 6d an offline open on a new day: no count ("${line}"), no banner ("${banner}"), the app's own write gone once the day exists`, !/change/.test(line) && banner === '' && left === 0, `stored entries left ${left}`)
    await context.close()
  }
  // 13. Another device edits something else meanwhile: the tick is kept, with no notice.
  {
    reseed(); const { context, page } = await fresh()
    await openTasks(page); await cut(page); await tick(page, 'Water the plants'); await wait(400)
    await page.close({ runBeforeUnload: false })
    await elsewhere(w => ({ type: 'rename-task', taskId: w.tasks.find(t => t.title === 'Call the bank').id, title: 'Call the bank today' }))
    await elsewhere({ type: 'set-values', pageId: 'r2', values: { st: 'b' }, expected: { st: 'a' }, at: new Date().toISOString() })
    const again = await context.newPage(); await openTasks(again); await wait(1200)
    const banner = await again.locator('.banner.save-failed').count()
    ok(`${tag} 13 a tick made before another device edited other things is kept, with no notice`, statusOf('Water the plants') === 'done' && banner === 0, `status ${statusOf('Water the plants')}, banner ${banner}`)
    await context.close()
  }
  // 14. open → done → open elsewhere: an old queued "done" is held, not applied, and he's told.
  {
    reseed(); const { context, page } = await fresh()
    await openTasks(page); await cut(page); await tick(page, 'Water the plants'); await wait(400)
    await page.close({ runBeforeUnload: false })
    // Elsewhere: done, then open again.
    await elsewhere(w => ({ type: 'task-status', taskId: w.tasks.find(t => t.title === 'Water the plants').id, status: 'done', today: today() }))
    await elsewhere(w => ({ type: 'task-status', taskId: w.tasks.find(t => t.title === 'Water the plants').id, status: 'open', today: today() }))
    const reopened = statusOf('Water the plants')
    const again = await context.newPage(); await openTasks(again); await wait(1200)
    const text = await again.locator('.banner.save-failed').innerText().catch(() => '')
    const link = await again.locator('.banner.save-failed a', { hasText: '"Water the plants"' }).getAttribute('href').catch(() => null)
    ok(`${tag} 14 an old "done" for a to-do reopened elsewhere is held and named (linked to ${link}), not applied`, Boolean(link) && reopened === 'open' && statusOf('Water the plants') === 'open' && /Not saved — ticked "Water the plants" was changed elsewhere/.test(text) && /Keep mine/.test(text) && /Discard/.test(text), `${reopened} → ${statusOf('Water the plants')} · "${text.replace(/\s+/g, ' ')}"`)
    await again.getByRole('button', { name: 'Discard' }).click(); await settle(again)
    ok(`${tag} 14b Discard drops it; the banner goes; the latest is shown`, await again.locator('.banner.save-failed').count() === 0 && statusOf('Water the plants') === 'open')
    await context.close()
  }
  // 4. A refusal (the to-do deleted elsewhere) goes to the held banner with Discard only; a passing failure (a 5xx) to the
  //    usual Retry, the change kept (Bumblebee 6233888d: the two take different paths).
  {
    reseed(); const { context, page } = await fresh()
    await openTasks(page); await cut(page); await tick(page, 'Pay rent'); await wait(400)
    await page.close({ runBeforeUnload: false })
    await elsewhere(w => { const t = w.tasks.find(x => x.title === 'Pay rent'); return { type: 'remove-task-row', pageId: t.sourcePageId, taskId: t.id, today: today() } })
    const again = await context.newPage(); await openTasks(again)
    await again.locator('.banner.save-failed').waitFor({ timeout: 8000 }).catch(() => {})
    const text = (await again.locator('.banner.save-failed').innerText().catch(() => '')).replace(/\s+/g, ' ')
    const keep = await again.locator('.banner.save-failed').getByRole('button', { name: 'Keep mine' }).count()
    ok(`${tag} 4 a refusal is held with Discard only ("${text}")`, /deleted elsewhere/.test(text) && /Discard/.test(text) && keep === 0 && !/Retry/.test(text), `Pay rent ${statusOf('Pay rent') ?? 'gone'}, deleted ${stored().deletedTasks.some(t => t.title === 'Pay rent')}, revision ${stored().revision}`)
    await context.close()
  }
  {
    reseed(); const { context, page } = await fresh()
    await openTasks(page)
    await page.route(OUTBOX, route => route.fulfill({ status: 503, body: 'down' }))
    await tick(page, 'Call the bank'); await wait(1500)
    const text = (await page.locator('.banner.save-failed').innerText().catch(() => '')).replace(/\s+/g, ' ')
    await page.unrouteAll({ behavior: 'ignoreErrors' })
    await page.locator('.banner.save-failed').getByRole('button', { name: 'Retry' }).click(); await settle(page); await wait(800)
    ok(`${tag} 4b a 5xx keeps the change under the usual Retry ("${text}"), and Retry sends it`, /Retry/.test(text) && !/Discard/.test(text) && statusOf('Call the bank') === 'done' && await page.locator('.banner.save-failed').count() === 0, `status ${statusOf('Call the bank')}`)
    await context.close()
  }
  // 15. While one change is held, an unrelated tick still saves, and a change to the held row waits, counted (B98 item 2).
  {
    reseed(); const { context, page } = await fresh()
    await page.goto(`${base}/`); await page.getByRole('checkbox', { name: 'Complete Water the plants' }).waitFor({ timeout: 20000 }); await settle(page)
    await cut(page); await page.getByRole('checkbox', { name: 'Complete Water the plants' }).click(); await wait(400)
    await page.close({ runBeforeUnload: false })
    await elsewhere(w => ({ type: 'task-status', taskId: w.tasks.find(t => t.title === 'Water the plants').id, status: 'done', today: today() }))
    await elsewhere(w => ({ type: 'task-status', taskId: w.tasks.find(t => t.title === 'Water the plants').id, status: 'open', today: today() }))
    const again = await context.newPage(); await again.goto(`${base}/`); await again.locator('.banner.save-failed').waitFor({ timeout: 10000 }).catch(() => {}); await settle(again)
    await again.getByRole('checkbox', { name: 'Complete Call the bank' }).click(); await wait(1200)
    await again.getByRole('checkbox', { name: 'Complete Water the plants' }).click(); await wait(1200)
    const text = (await again.locator('.banner.save-failed').innerText().catch(() => '')).replace(/\s+/g, ' ')
    ok(`${tag} 15 with a change held, an unrelated tick saves and one on the held row waits, counted ("${text.trim()}")`, statusOf('Call the bank') === 'done' && statusOf('Water the plants') === 'open' && /1 later change waiting/.test(text))
    await context.close()
  }
  // 16. Two tabs on one device, one to-do: tab A's tick is held on its way; tab B ticks then unticks it; A's lands. B's
  //     changes follow A's in order (their bases read fresh under the lock), nothing held (Ratchet 5e6bd5ac).
  {
    reseed()
    const context = await browser.newContext({ viewport: { width: 1280, height: 900 }, serviceWorkers: 'block' }), a = await context.newPage(), b = await context.newPage()
    for (const p of [a, b]) { await p.goto(`${base}/`); await p.getByRole('checkbox', { name: 'Complete Water the plants' }).waitFor({ timeout: 20000 }); await settle(p) }
    let release; const gate = new Promise(r => { release = r })
    await a.route(OUTBOX, async route => { await gate; await route.continue().catch(() => {}) })
    await a.getByRole('checkbox', { name: 'Complete Water the plants' }).click(); await wait(400)
    await b.getByRole('checkbox', { name: 'Complete Water the plants' }).click(); await wait(800)
    await b.getByRole('checkbox', { name: 'Complete Water the plants' }).click(); await wait(600)
    release(); await wait(3000)
    await b.evaluate(() => window.dispatchEvent(new Event('focus'))); await wait(1500)
    const heldB = await b.locator('.banner.save-failed').count(), heldA = await a.locator('.banner.save-failed').count()
    ok(`${tag} 16 two tabs, one to-do: A's tick then B's tick and untick apply in order, nothing held`, heldA === 0 && heldB === 0 && statusOf('Water the plants') === 'open', `status ${statusOf('Water the plants')}, held A ${heldA} B ${heldB}, revision ${stored().revision}`)
    await context.close()
  }
  // 17. A change held in one tab blocks a dependent change made in another tab of the same device (Ratchet 226e41dc).
  {
    reseed()
    const context = await browser.newContext({ viewport: { width: 1280, height: 900 }, serviceWorkers: 'block' }), a = await context.newPage(), b = await context.newPage()
    for (const p of [a, b]) { await p.goto(`${base}/`); await p.getByRole('checkbox', { name: 'Complete Water the plants' }).waitFor({ timeout: 20000 }); await settle(p) }
    await cut(a); await a.getByRole('checkbox', { name: 'Complete Water the plants' }).click(); await wait(600)
    await elsewhere(w => ({ type: 'task-status', taskId: w.tasks.find(t => t.title === 'Water the plants').id, status: 'done', today: today() }))
    await elsewhere(w => ({ type: 'task-status', taskId: w.tasks.find(t => t.title === 'Water the plants').id, status: 'open', today: today() }))
    await a.unrouteAll({ behavior: 'ignoreErrors' }); await wait(5200); await a.evaluate(() => window.dispatchEvent(new Event('focus')))
    await a.locator('.banner.save-failed').waitFor({ timeout: 8000 }).catch(() => {})
    const before = stored().revision
    await b.reload(); await b.getByRole('checkbox', { name: 'Complete Water the plants' }).waitFor({ timeout: 20000 }); await settle(b)
    await b.getByRole('checkbox', { name: 'Complete Water the plants' }).click(); await wait(2000)
    const text = (await b.locator('.banner.save-failed').innerText().catch(() => '')).replace(/\s+/g, ' ')
    ok(`${tag} 17 a change held in tab A blocks tab B's tick on the same to-do ("${text.trim()}")`, stored().revision === before && statusOf('Water the plants') === 'open' && /later change waiting/.test(text), `revision ${before} → ${stored().revision}`)
    // A discards its held change; B, back in its tab, drops it too and sends its waiting tick (Ratchet 7bb6a8af).
    await a.locator('.banner.save-failed').getByRole('button', { name: 'Discard' }).click(); await wait(800)
    await wait(5200); await b.evaluate(() => window.dispatchEvent(new Event('focus'))); await wait(2000)
    ok(`${tag} 17b the held change discarded in tab A: tab B lets go of it and sends its waiting tick`, statusOf('Water the plants') === 'done' && await b.locator('.banner.save-failed').count() === 0, `status ${statusOf('Water the plants')}`)
    await context.close()
  }
  // 18. Tab A is closed with a change still pending (offline when made); tab B's next change sends A's first, then its
  //     own: order by seq across tabs, and nothing stranded by a closed tab (Ratchet 2d32d59f, Lead 543a65f9).
  {
    reseed()
    const ids = Object.fromEntries(stored().tasks.map(t => [t.title, t.id]))
    const context = await browser.newContext({ viewport: { width: 1280, height: 900 }, serviceWorkers: 'block' }), a = await context.newPage(), b = await context.newPage()
    for (const p of [a, b]) { await p.goto(`${base}/`); await p.getByRole('checkbox', { name: 'Complete Water the plants' }).waitFor({ timeout: 20000 }); await settle(p) }
    await cut(a); await a.getByRole('checkbox', { name: 'Complete Water the plants' }).click(); await wait(800)
    await a.close({ runBeforeUnload: false })
    const before = stored().revision, wire = []
    b.on('request', r => { if (r.url().includes('/_serverFn/cedd5fc6')) { const body = r.postData() ?? ''; wire.push(body.includes(ids['Water the plants']) ? 'A' : body.includes(ids['Call the bank']) ? 'B' : '?') } })
    await b.getByRole('checkbox', { name: 'Complete Call the bank' }).click(); await wait(2000); await settle(b)
    const banner = await b.locator('.banner.save-failed').count()
    ok(`${tag} 18 a change left by a closed tab goes first, then the open tab's own`, wire.join(',') === 'A,B' && statusOf('Water the plants') === 'done' && statusOf('Call the bank') === 'done' && stored().revision === before + 2 && banner === 0, `wire ${wire.join(',')}, revision ${before} → ${stored().revision}, banner ${banner}`)
    await context.close()
  }
  // 18b. The same, but tab B makes no change: coming back to B sends A's tick on its own (B98 item 11, Bumblebee 2e1e02bf).
  {
    reseed()
    const context = await browser.newContext({ viewport: { width: 1280, height: 900 }, serviceWorkers: 'block' }), a = await context.newPage(), b = await context.newPage()
    for (const p of [a, b]) { await p.goto(`${base}/`); await p.getByRole('checkbox', { name: 'Complete Water the plants' }).waitFor({ timeout: 20000 }); await settle(p) }
    await cut(a); await a.getByRole('checkbox', { name: 'Complete Water the plants' }).click(); await wait(800)
    await a.close({ runBeforeUnload: false })
    const before = stored().revision
    await wait(5200); const back = Date.now(); await b.evaluate(() => window.dispatchEvent(new Event('focus')))
    for (let i = 0; i < 30 && statusOf('Water the plants') !== 'done'; i++) await wait(100)
    const took = Date.now() - back
    await settle(b)
    const ticked = await b.getByRole('checkbox', { name: 'Complete Water the plants' }).isChecked().catch(() => false)
    ok(`${tag} 18b a change left by a closed tab is sent when he comes back to an open tab that made none (${took} ms)`, statusOf('Water the plants') === 'done' && stored().revision === before + 1 && took < 3000 && ticked && await b.locator('.banner.save-failed').count() === 0, `revision ${before} → ${stored().revision}, B shows ticked ${ticked}`)
    await context.close()
  }
  // 18c. A closed tab left two changes: a tick on a to-do edited elsewhere since, and an unrelated one. Tab B's tick on the
  //      first: A's first is held, A's unrelated one still goes, B's waits on the hold (Ratchet a7f864c4).
  {
    reseed()
    const context = await browser.newContext({ viewport: { width: 1280, height: 900 }, serviceWorkers: 'block' }), a = await context.newPage(), b = await context.newPage()
    for (const p of [a, b]) { await p.goto(`${base}/`); await p.getByRole('checkbox', { name: 'Complete Water the plants' }).waitFor({ timeout: 20000 }); await settle(p) }
    await cut(a); await a.getByRole('checkbox', { name: 'Complete Water the plants' }).click(); await wait(800)
    await a.getByRole('checkbox', { name: 'Complete Call the bank' }).click(); await wait(800)
    await a.close({ runBeforeUnload: false })
    await elsewhere(w => ({ type: 'task-status', taskId: w.tasks.find(t => t.title === 'Water the plants').id, status: 'done', today: today() }))
    await elsewhere(w => ({ type: 'task-status', taskId: w.tasks.find(t => t.title === 'Water the plants').id, status: 'open', today: today() }))
    await b.getByRole('checkbox', { name: 'Complete Water the plants' }).click(); await wait(2000); await settle(b)
    const text = (await b.locator('.banner.save-failed').innerText().catch(() => '')).replace(/\s+/g, ' ').trim()
    ok(`${tag} 18c behind another tab's held change, its unrelated change still goes and B's waits ("${text}")`, statusOf('Call the bank') === 'done' && statusOf('Water the plants') === 'open' && /ticked "Water the plants" · changed since|was changed elsewhere/.test(text) && /1 later change waiting/.test(text), `bank ${statusOf('Call the bank')}, water ${statusOf('Water the plants')}`)
    await context.close()
  }
  // 10c. No IndexedDB at all (not just failing): a change on its way still warns after a second and guards the leave.
  {
    reseed(); const { context, page } = await fresh()
    await page.addInitScript(() => Object.defineProperty(window, 'indexedDB', { value: undefined }))
    await page.goto(`${base}/`); await page.getByRole('checkbox', { name: 'Complete Water the plants' }).waitFor({ timeout: 20000 }); await settle(page)
    await page.route('**/_serverFn/**', async r => { if (r.request().method() === 'POST') await new Promise(() => {}); else await r.continue() })
    await page.getByRole('checkbox', { name: 'Complete Water the plants' }).click(); await wait(1800)
    const warned = await page.getByText('Not saved on this device', { exact: false }).count()
    const guarded = await page.evaluate(() => { const e = new Event('beforeunload', { cancelable: true }); window.dispatchEvent(e); return e.defaultPrevented })
    ok(`${tag} 10c with no IndexedDB, a change still on its way warns and guards the leave (Ratchet 5ca37837)`, warned > 0 && guarded)
    await context.close()
  }
  // 10d. No IndexedDB: a change that failed stays at risk until it is itself sent; an unrelated success doesn't clear the
  //     warning or the leave guard (Ratchet ff7e0d37).
  {
    reseed(); const { context, page } = await fresh()
    await page.addInitScript(() => Object.defineProperty(window, 'indexedDB', { value: undefined }))
    await page.goto(`${base}/`); await page.getByRole('checkbox', { name: 'Complete Water the plants' }).waitFor({ timeout: 20000 }); await settle(page)
    await page.route('**/_serverFn/**', r => (r.request().method() === 'POST' ? r.abort('internetdisconnected') : r.continue()))
    await page.getByRole('checkbox', { name: 'Complete Water the plants' }).click(); await wait(1200)
    await page.unrouteAll({ behavior: 'ignoreErrors' })
    await page.getByRole('checkbox', { name: 'Complete Call the bank' }).click(); await settle(page); await wait(800)
    const warned = await page.getByText('Not saved on this device', { exact: false }).count()
    const guarded = await page.evaluate(() => { const e = new Event('beforeunload', { cancelable: true }); window.dispatchEvent(e); return e.defaultPrevented })
    ok(`${tag} 10d with no IndexedDB, an unrelated success keeps the failed change's warning and leave guard`, statusOf('Call the bank') === 'done' && warned > 0 && guarded, `warned ${warned}, guarded ${guarded}`)
    await context.close()
  }
  // 10. No IndexedDB: changes go as before, nothing claims they were kept.
  {
    reseed(); const { context, page } = await fresh()
    // As in a private window or a full disk: the store is there but won't open.
    await page.addInitScript(() => { IDBFactory.prototype.open = function () { throw new DOMException('Storage unavailable', 'InvalidStateError') } })
    await openTasks(page); await tick(page, 'Call the bank'); await wait(250)
    const flash = await page.locator('.banner.save-failed').count()
    await settle(page); await wait(500)
    ok(`${tag} 10 with no IndexedDB the tick is sent as before, with no "not saved" flash`, statusOf('Call the bank') === 'done' && flash === 0, `banner during the send ${flash}`)
    await context.close()
  }
  // 11. Two tabs open on the next load: the change is applied once.
  {
    reseed(); const { context, page } = await fresh()
    await openTasks(page); await cut(page); await tick(page, 'Pay rent'); await wait(400)
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
