// Tap feedback release 2 (#374, docs/design/tap-feedback.md §4): a change drawn before the server answers, taken back
// with its word when the server holds it, and the working mark on a change that waits. Reseeds a throwaway store per
// case; never his data.
// Usage: node tests/evidence/draw-ahead/r2-probe.mjs <base-url> <store-path> [chromium|webkit]
//   The server at <base-url> serves <store-path> (a build: `vite preview`, so the outbox route below matches).
import * as pw from '@playwright/test'
import { execSync } from 'node:child_process'
import { SqliteWorkspaceRepository } from '../../../src/server/sqlite-repository.ts'

const [base, storePath, only] = process.argv.slice(2), results = []
if (!base || !storePath) { console.error('Usage: node tests/evidence/draw-ahead/r2-probe.mjs <base-url> <store-path> [chromium|webkit]'); process.exit(2) }
const ok = (name, pass, detail = '') => { results.push(pass); console.log(`${pass ? 'PASS' : 'FAIL'} ${name}${detail ? ` · ${detail}` : ''}`) }
const wait = ms => new Promise(r => setTimeout(r, ms))
const OUTBOX = '**/_serverFn/cedd5fc6*'
const PAGE = 'probe-page', OTHER = 'probe-other'
const repo = () => new SqliteWorkspaceRepository(storePath, undefined, { allowMissingLegacy: true })
const elsewhere = async action => { const r = repo(), w = await r.load(); await r.execute({ operationId: crypto.randomUUID(), expectedRevision: w.revision, action }) }
const reseed = async () => {
  execSync(`node --no-warnings tests/evidence/tap-feedback/seed.ts ${storePath}`, { stdio: 'ignore' })
  await elsewhere({ type: 'create-document', title: 'Trip notes', body: 'Packing list', pageId: PAGE })
  await elsewhere({ type: 'create-document', title: 'Other page', body: '', pageId: OTHER })
}
const titleOf = async () => (await repo().load()).pages.find(p => p.id === PAGE)?.title

for (const engine of only ? [only] : ['chromium', 'webkit']) {
  const browser = await pw[engine].launch()
  for (const width of [390, 1280]) {
    const tag = `${engine} ${width}`
    const fresh = async () => {
      await reseed()
      const context = await browser.newContext({ viewport: { width, height: width < 600 ? 844 : 900 }, ...(width < 600 && engine === 'chromium' ? { hasTouch: true } : {}), timezoneId: 'America/Vancouver', serviceWorkers: 'block' })
      const page = await context.newPage()
      await page.goto(`${base}/pages?page=${PAGE}`); await page.locator('[aria-label="Page title"]').waitFor({ timeout: 30000 })
      await page.waitForLoadState('networkidle').catch(() => {}); await wait(600)
      return { context, page }
    }
    const toasts = page => page.evaluate(() => [...document.querySelectorAll('[data-slot="toast"]:not([data-exiting="true"])')].map(e => e.textContent.replace(/\s+/g, ' ').trim()))
    const rename = async (page, words) => { const t = page.locator('[aria-label="Page title"]'); await t.click(); await page.keyboard.press(process.platform === 'darwin' ? 'Meta+A' : 'Control+A'); await page.keyboard.type(words); await t.evaluate(e => e.blur()) }

    // 1. Drawn ahead: a rename shows everywhere before the answer (held 3 s). At 1280 the sidebar names it; at 390 the
    //    browser tab's title does.
    {
      const { context, page } = await fresh()
      let answered = 0
      await page.route(OUTBOX, async r => { await wait(3000); answered = Date.now(); await r.continue().catch(() => {}) })
      const t0 = Date.now()
      await rename(page, 'Trip to Lisbon')
      let seenAt = null
      for (let i = 0; i < 40 && seenAt === null; i++) {
        const shown = await page.evaluate(() => [...document.querySelectorAll('nav a, aside a, [role=treeitem]')].some(e => /Trip to Lisbon/.test(e.textContent)) || /Trip to Lisbon/.test(document.title))
        if (shown) seenAt = Date.now() - t0; else await wait(50)
      }
      ok(`${tag} 1 rename drawn before the answer`, seenAt !== null && seenAt < 1000 && answered === 0, `shown at ${seenAt} ms, answer ${answered ? 'came' : 'still held'}`)
      await wait(3500)
      ok(`${tag} 1 and saved once answered`, (await titleOf()) === 'Trip to Lisbon', await titleOf())
      await context.close()
    }

    // 2. Held: renamed elsewhere after this tab loaded, then renamed here. His typed name stays in the field with the line
    //    under it, no generic notice, the banner keeps its way back; Esc gives up and shows the saved name.
    {
      const { context, page } = await fresh()
      await elsewhere({ type: 'rename-page', pageId: PAGE, title: 'Trip (phone)' })
      await rename(page, 'Trip to Porto')
      let line = ''
      for (let i = 0; i < 60 && !(line = await page.locator('.title-not-saved').textContent().catch(() => '') ?? ''); i++) await wait(100)
      const field = await page.locator('[aria-label="Page title"]').textContent()
      const ts = await toasts(page), body = await page.locator('body').textContent()
      ok(`${tag} 2 held rename: his name stays in the field`, field === 'Trip to Porto', field)
      ok(`${tag} 2 held rename: said under it`, line === 'Name not saved · changed elsewhere', line)
      ok(`${tag} 2 held rename: no generic notice on top`, !ts.some(t => /not saved/.test(t)), ts.join(' / '))
      ok(`${tag} 2 held rename: the banner keeps its way back`, /Keep mine/.test(body) && /Discard/.test(body))
      ok(`${tag} 2 held rename: nothing saved over the other device`, (await titleOf()) === 'Trip (phone)', await titleOf())
      await page.locator('[aria-label="Page title"]').click(); await page.keyboard.press('Escape'); await wait(400)
      ok(`${tag} 2 Esc gives up: the saved name, no line`, (await page.locator('[aria-label="Page title"]').textContent()) === 'Trip (phone)' && !(await page.locator('.title-not-saved').count()))
      await context.close()
    }

    // 3. Held, generic word: Delete from Page actions while the page was renamed elsewhere. The page goes at once, then
    //    comes back with `Delete not saved · changed elsewhere` in the same visible change.
    {
      const { context, page } = await fresh()
      await elsewhere({ type: 'rename-page', pageId: PAGE, title: 'Trip (phone)' })
      const menu = page.getByRole('button', { name: 'Page actions' }).first()
      if (await menu.count()) {
        await menu.click(); await wait(150)
        await page.getByRole('menuitem', { name: 'Delete' }).click()
        let ts = []
        for (let i = 0; i < 60 && !(ts = await toasts(page)).some(t => /not (saved|deleted|moved)/i.test(t)); i++) await wait(100)
        ok(`${tag} 3 held delete: named notice`, ts.some(t => t.startsWith('Page not deleted · changed elsewhere')), ts.join(' / '))
        ok(`${tag} 3 held delete: the page is still there`, Boolean((await repo().load()).pages.find(p => p.id === PAGE && !p.trashedAt)))
        // Jazz ea7e3ef4: on the phone the notice sits under the banner, never over its Keep mine / Discard (measured once
        // its entry animation is over).
        await wait(600)
        const over = await page.evaluate(() => { const t = document.querySelector('[data-slot="toast"]')?.getBoundingClientRect(), bs = [...document.querySelectorAll('.banner')].map(b => b.getBoundingClientRect()).filter(r => r.height && r.bottom > 0); return t && bs.length ? bs.some(b => t.top < b.bottom - 0.5 && t.bottom > b.top + 0.5) : null })
        ok(`${tag} 3 held delete: the notice doesn't cover the banner`, over === false, `overlap ${over}`)
      } else ok(`${tag} 3 held delete: Page actions found`, false, 'no Page actions button at this width')
      await context.close()
    }

    // 4. Waits: New page shows the working mark on the button and takes no second press while the answer is held 2 s.
    {
      const { context, page } = await fresh()
      await page.route(OUTBOX, async r => { await wait(2000); await r.continue().catch(() => {}) })
      await page.route('**/_serverFn/**', async r => { await wait(2000); await r.continue().catch(() => {}) })
      if (width < 600) { await page.goto(`${base}/pages`); await page.getByRole('button', { name: 'New page' }).first().waitFor({ timeout: 30000 }); await wait(600) }
      const before = (await repo().load()).pages.filter(p => p.type !== 'daily').length
      const add = page.getByRole('button', { name: 'New page' }).first()
      if (await add.count()) {
        await add.click(); await wait(150)
        const item = page.getByRole('menuitem').first()
        if (await item.count()) {
          await item.click()
          const marked = await add.evaluate(e => e.getAttribute('data-working')).catch(() => null)
          await wait(400)
          const slow = await page.evaluate(() => document.querySelector('[data-working]')?.getAttribute('data-working') ?? null)
          await page.locator('[data-working]').first().click({ force: true, timeout: 500 }).catch(() => {})
          // Ratchet dc250ee5: only a second press is stopped; Tab still moves on from the working control.
          await page.locator('[data-working]').first().focus().catch(() => {})
          const focusedBefore = await page.evaluate(() => document.activeElement?.getAttribute('aria-label'))
          await page.keyboard.press('Enter'); await page.keyboard.press('Tab')
          const focusedAfter = await page.evaluate(() => document.activeElement?.getAttribute('aria-label') ?? document.activeElement?.tagName)
          ok(`${tag} 4 waits: Tab moves on from the working control, Enter doesn't press it again`, focusedBefore === 'New page' && focusedAfter !== 'New page', `${focusedBefore} → ${focusedAfter}`)
          ok(`${tag} 4 waits: working mark, then the spinner after 300 ms`, (marked !== null || slow !== null) && slow === 'slow', `at once ${marked}, at 400 ms ${slow}`)
          await wait(3500)
          const after = (await repo().load()).pages.filter(p => p.type !== 'daily').length
          ok(`${tag} 4 waits: one page made, not two`, after === before + 1, `${before} → ${after}`)
          ok(`${tag} 4 waits: the mark is gone after the answer`, !(await page.locator('[data-working]').count()))
        } else ok(`${tag} 4 waits: New page menu`, false, 'no menu item')
      } else ok(`${tag} 4 waits: New page button`, false, 'not on this screen')
      await context.close()
    }

    // 5. Ratchet b527e8d8: a held change and an unrelated slow one after it in the same drain (another page renamed from
    //    the sidebar at 1280). The held one is said (by the notice: its title field has gone) before the slow one is
    //    answered, and the slow one still lands.
    if (width >= 1280) {
      const { context, page } = await fresh()
      await elsewhere({ type: 'rename-page', pageId: PAGE, title: 'Trip (phone)' })
      let n = 0, slowAnswered = 0
      await page.route(OUTBOX, async r => { const i = ++n; if (i === 1) await wait(3000); else { await wait(5000); slowAnswered = Date.now() } await r.continue().catch(() => {}) })
      const seen = []
      await page.exposeFunction('__toastSeen', t => seen.push({ t, at: Date.now(), sent: n, slow: slowAnswered }))
      await page.evaluate(() => new MutationObserver(() => { for (const e of document.querySelectorAll('[data-slot="toast"]')) if (!e.dataset.seen) { e.dataset.seen = '1'; window.__toastSeen(e.textContent.replace(/\s+/g, ' ').trim()) } }).observe(document.body, { childList: true, subtree: true }))
      const t0 = Date.now()
      await rename(page, 'Trip to Porto')
      await page.locator('a', { hasText: 'Other page' }).first().click()
      await page.waitForFunction(() => document.querySelector('[aria-label="Page title"]')?.textContent === 'Other page', null, { timeout: 5000 })
      await rename(page, 'Other renamed')
      const secondStoredBy = Date.now() - t0
      for (let i = 0; i < 80 && !seen.some(x => /not saved/.test(x.t)); i++) await wait(100)
      const said = seen.find(x => /not saved/.test(x.t))
      // The second was stored while the first was out (3 s), so it's in the same drain; the word comes with the first's
      // answer, not after the second's 5 s.
      ok(`${tag} 5 held then slow: said with the held answer, before the slow one's`, Boolean(said) && /^Name not saved · changed elsewhere/.test(said.t) && secondStoredBy < 3000 && said.at - t0 < 4500 && said.slow === 0, said ? `${said.t} at ${said.at - t0} ms · second stored by ${secondStoredBy} ms · slow ${said.slow ? 'answered' : 'still out'}` : 'nothing said')
      await wait(6000)
      ok(`${tag} 5 and the slow one landed after`, slowAnswered > 0 && (await repo().load()).pages.find(p => p.id === OTHER)?.title === 'Other renamed', (await repo().load()).pages.find(p => p.id === OTHER)?.title)
      await context.close()
    }

    // 6. Stored while the send fails, held on a later send: the run has returned, and the field still keeps his name
    //    with its line, no generic notice (his words are never replaced without his say).
    {
      const { context, page } = await fresh()
      await page.route(OUTBOX, r => r.abort())
      await rename(page, 'Trip to Porto'); await wait(1500)
      await elsewhere({ type: 'rename-page', pageId: PAGE, title: 'Trip (phone)' })
      await page.unroute(OUTBOX)
      let line = ''
      for (let i = 0; i < 200 && !(line = await page.locator('.title-not-saved').textContent().catch(() => '') ?? ''); i++) await wait(100)
      const field = await page.locator('[aria-label="Page title"]').textContent(), ts = await toasts(page)
      ok(`${tag} 6 held on a later send: his name kept, said under it`, field === 'Trip to Porto' && line === 'Name not saved · changed elsewhere', `${field} · ${JSON.stringify(line)}`)
      ok(`${tag} 6 held on a later send: no generic notice on top`, !ts.some(t => /not saved/.test(t)), ts.join(' / '))
      await context.close()
    }

    // 7. The same after a reload: no caller is left, so the generic notice says it, once; the banner keeps his name.
    {
      const { context, page } = await fresh()
      await page.route(OUTBOX, r => r.abort())
      await rename(page, 'Trip to Porto'); await wait(1500)
      await elsewhere({ type: 'rename-page', pageId: PAGE, title: 'Trip (phone)' })
      const seen = []
      await page.exposeFunction('__toastSeen', t => seen.push(t)).catch(() => {})
      await page.unroute(OUTBOX)
      await page.route(OUTBOX, r => r.abort())
      await page.reload(); await page.locator('[aria-label="Page title"]').waitFor({ timeout: 30000 }); await wait(800)
      await page.evaluate(() => new MutationObserver(() => { for (const e of document.querySelectorAll('[data-slot="toast"]')) if (!e.dataset.seen) { e.dataset.seen = '1'; window.__toastSeen(e.textContent.replace(/\s+/g, ' ').trim()) } }).observe(document.body, { childList: true, subtree: true }))
      await page.unroute(OUTBOX)
      for (let i = 0; i < 200 && !seen.some(t => /not saved/.test(t)); i++) await wait(100)
      await wait(2500)
      const named = seen.filter(t => /^Name not saved · changed elsewhere/.test(t)), body = await page.locator('body').textContent()
      ok(`${tag} 7 after a reload: the named notice, once`, named.length === 1, seen.join(' / '))
      ok(`${tag} 7 after a reload: the banner keeps his change`, /Keep mine/.test(body) && /Discard/.test(body))
      await context.close()
    }

    // 9. Lead 88aeff42: a change that waits and then is held is named too. A subpage made under a page deleted elsewhere
    //    (at 1280, from the sidebar's +): no page, the working mark gone, `Page not created · changed elsewhere` once.
    if (width >= 1280) {
      const { context, page } = await fresh()
      await elsewhere({ type: 'rename-page', pageId: PAGE, title: 'Trip (phone)' })
      await elsewhere({ type: 'delete-page', pageId: PAGE, at: new Date().toISOString() })
      const seen = []
      await page.exposeFunction('__toastSeen', t => seen.push(t))
      await page.evaluate(() => new MutationObserver(() => { for (const e of document.querySelectorAll('[data-slot="toast"]')) if (!e.dataset.seen) { e.dataset.seen = '1'; window.__toastSeen(e.textContent.replace(/\s+/g, ' ').trim()) } }).observe(document.body, { childList: true, subtree: true }))
      // Ratchet a07a377f: what follows the held answer is slow (the reload after it, held 4 s here); the button's working
      // mark still ends with the notice, not after.
      await page.route('**/_serverFn/**', async r => { if (!r.request().url().includes('/_serverFn/cedd5fc6')) await wait(4000); await r.continue().catch(() => {}) })
      await page.locator('a', { hasText: 'Trip notes' }).first().hover().catch(() => {})
      await page.getByRole('button', { name: /New subpage in Trip notes/ }).first().click({ force: true })
      let workingAtNotice = null
      for (let i = 0; i < 60 && !seen.some(t => /not created/.test(t)); i++) await wait(50)
      workingAtNotice = await page.locator('[data-working]').count()
      ok(`${tag} 9 a waiting create held: its working mark ends with the notice`, workingAtNotice === 0, `working controls at the notice: ${workingAtNotice}`)
      await wait(1500)
      const named = seen.filter(t => /not (saved|created)/.test(t)), body = await page.locator('body').textContent()
      ok(`${tag} 9 a waiting create held: named once, with the banner's reason`, named.length === 1 && /^Page not created · (can\u2019t do this now|page was deleted elsewhere)/.test(named[0]), named.join(' / ') || 'none')
      ok(`${tag} 9 a waiting create held: no page made, the working mark gone`, (await repo().load()).pages.filter(p => p.parentId === PAGE).length === 0 && !(await page.locator('[data-working]').count()))
      ok(`${tag} 9 a waiting create held: the banner keeps its way back`, /Discard/.test(body), body.match(/Not saved[^·]{0,80}/)?.[0] ?? 'no banner text')
      await context.close()
    }

    // 10. Ratchet 5444a11c: a type with its own mark (the draft's ✕), stored while sends fail and held later, is said
    //     only by its own line, never by the notice too.
    {
      const { context, page } = await fresh()
      await page.goto(`${base}/`); await page.locator('.draft-band, [data-draft-item]').first().waitFor({ timeout: 30000 }); await wait(800)
      await page.route(OUTBOX, r => r.abort())
      const seen = []
      await page.exposeFunction('__toastSeen', t => seen.push(t))
      await page.evaluate(() => new MutationObserver(() => { for (const e of document.querySelectorAll('[data-slot="toast"]')) if (!e.dataset.seen) { e.dataset.seen = '1'; window.__toastSeen(e.textContent.replace(/\s+/g, ' ').trim()) } }).observe(document.body, { childList: true, subtree: true }))
      await page.locator('button[aria-label="Skip Renew the passport"]').click(); await wait(500)
      const r = repo(), w = await r.load(), day = w.pages.find(p => p.type === 'daily' && p.date === new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Vancouver' }).format(new Date()))
      const { draftOf } = await import('../../../src/domain/day-draft.ts')
      const other = draftOf(w, day.id).items.at(-1)
      await r.execute({ operationId: crypto.randomUUID(), expectedRevision: w.revision, action: { type: 'skip-draft', pageId: day.id, itemIds: [other.id] } })
      await page.unroute(OUTBOX)
      let note = []
      for (let i = 0; i < 200 && !(note = await page.evaluate(() => [...document.querySelectorAll('.draft-note')].map(e => e.textContent.trim()))).length; i++) await wait(100)
      await wait(1500)
      ok(`${tag} 10 own mark kept then held: its line, no notice on top`, note.includes('Not skipped · changed elsewhere') && !seen.some(t => /not (saved|skipped)/i.test(t)), `${note.join(' / ')} · notices ${seen.join(' / ') || 'none'}`)
      await context.close()
    }

    // 8. Two tabs (one device, one stored queue). Tab A renames while sends fail; tab B opens and has it too. Renamed
    //    elsewhere, then the network is back: each tab that drew it says it once (A in its field, B by the notice), and
    //    no tab says it twice.
    {
      const { context, page: a } = await fresh()
      await context.route(OUTBOX, r => r.abort())
      await rename(a, 'Trip to Porto'); await wait(1500)
      const b = await context.newPage()
      await b.goto(`${base}/pages?page=${PAGE}`); await b.locator('[aria-label="Page title"]').waitFor({ timeout: 30000 }); await wait(800)
      await elsewhere({ type: 'rename-page', pageId: PAGE, title: 'Trip (phone)' })
      const seen = { a: [], b: [] }
      for (const [k, p] of [['a', a], ['b', b]]) {
        await p.exposeFunction('__toastSeen', t => seen[k].push(t))
        await p.evaluate(() => new MutationObserver(() => { for (const e of document.querySelectorAll('[data-slot="toast"]')) if (!e.dataset.seen) { e.dataset.seen = '1'; window.__toastSeen(e.textContent.replace(/\s+/g, ' ').trim()) } }).observe(document.body, { childList: true, subtree: true }))
      }
      await context.unroute(OUTBOX)
      // Each tab sends on a return to it; bring both back once.
      for (const p of [b, a]) { await p.bringToFront(); await p.evaluate(() => document.dispatchEvent(new Event('visibilitychange'))) }
      let line = ''
      for (let i = 0; i < 200 && !((line = await a.locator('.title-not-saved').textContent().catch(() => '') ?? '') && seen.b.some(t => /not saved/.test(t))); i++) await wait(100)
      await wait(2000)
      const aNotices = seen.a.filter(t => /not saved/.test(t)), bNotices = seen.b.filter(t => /not saved/.test(t))
      ok(`${tag} 8 two tabs: A keeps his name with its line, no notice on top`, line === 'Name not saved · changed elsewhere' && aNotices.length === 0, `${JSON.stringify(line)} · A notices ${aNotices.join(' / ')}`)
      ok(`${tag} 8 two tabs: B says it once`, bNotices.length === 1 && /^Name not saved · changed elsewhere/.test(bNotices[0]), bNotices.join(' / ') || 'none')
      await context.close()
    }
  }
  await browser.close()
}
const failed = results.filter(r => !r).length
console.log(failed ? `${failed} FAILED of ${results.length}` : `all ${results.length} passed`)
process.exit(failed ? 1 : 0)
