// Tap feedback §2 (docs/design/tap-feedback.md): the day draft's ✓, ✕, Apply all and Dismiss show their result in the
// first frame after the change is stored on the device, with the server's answer held back, refused, lost or never sent.
// Each case reseeds the store, so it never runs on his data.
// Usage: node tests/evidence/tap-feedback/draft-check.mjs <base-url> <store-path> [chromium|webkit]
//   The server at <base-url> serves <store-path> (seeded by tests/evidence/tap-feedback/seed.ts; this script reseeds it).
import * as pw from '@playwright/test'
import { execSync } from 'node:child_process'
import { DatabaseSync } from 'node:sqlite'
import { SqliteWorkspaceRepository } from '../../../src/server/sqlite-repository.ts'
import { draftOf } from '../../../src/domain/day-draft.ts'
const [base, storePath, only] = process.argv.slice(2), results = []
if (!base || !storePath) { console.error('Usage: node tests/evidence/tap-feedback/draft-check.mjs <base-url> <store-path> [chromium|webkit]'); process.exit(2) }
const ok = (name, pass, detail = '') => { results.push(pass); console.log(`${pass ? 'PASS' : 'FAIL'} ${name}${detail ? ` · ${detail}` : ''}`) }
const wait = ms => new Promise(r => setTimeout(r, ms))
const reseed = () => execSync(`node --no-warnings tests/evidence/tap-feedback/seed.ts ${storePath}`, { stdio: 'ignore' })
const stored = () => {
  for (let i = 0; ; i++) {
    try { const db = new DatabaseSync(storePath, { readOnly: true, timeout: 2000 }); try { return JSON.parse(db.prepare('SELECT data FROM workspace WHERE id = 1').get().data) } finally { db.close() } }
    catch (e) { if (i > 5 || !/locked|busy/i.test(String(e))) throw e }
  }
}
const today = () => new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Vancouver' }).format(new Date())
const draftNow = () => { const ws = stored(), day = ws.pages.find(p => p.type === 'daily' && p.date === today()); return { ws, day, draft: draftOf(ws, day.id) } }
/** Item states in the store, in the draft's order: o(pen), a(pplied), s(kipped). */
const states = () => draftNow().draft.items.map(i => i.state[0]).join('')
const OUTBOX = '**/_serverFn/cedd5fc6*'

for (const engine of only ? [only] : ['chromium', 'webkit']) {
  const browser = await pw[engine].launch()
  // Chromium at 390 with touch (his phone's shape); WebKit at 1280 with a mouse (WebKit has no touch driver here).
  const phone = engine === 'chromium'
  const fresh = async () => {
    const context = await browser.newContext({ ...(phone ? { viewport: { width: 390, height: 844 }, hasTouch: true } : { viewport: { width: 1280, height: 900 } }), timezoneId: 'America/Vancouver', serviceWorkers: 'block' })
    const page = await context.newPage(), errors = []
    page.on('pageerror', e => errors.push(e.message))
    await page.goto(`${base}/`, { waitUntil: 'networkidle' }); await page.locator('[data-draft-item]').first().waitFor({ timeout: 20000 }); await wait(600)
    return { context, page, errors }
  }
  const press = async (page, loc) => phone ? loc.tap() : loc.click()
  /** Every band on the page: `<words>:<look>`, look `open`, `applied`, `skipped`, `closing`, `working` or `note`. */
  const bands = page => page.evaluate(() => [...document.querySelectorAll('[data-draft-item]')].map(e => {
    const words = (e.querySelector('.draft-text')?.textContent ?? '').trim().split(' ')[0]
    return `${words}:${e.classList.contains('draft-band-slot') ? 'note' : e.getAttribute('data-decided') ?? 'open'}`
  }).join(' '))
  const notes = page => page.evaluate(() => [...document.querySelectorAll('.draft-note')].map(e => e.textContent.trim()))
  const toastText = page => page.evaluate(() => [...document.querySelectorAll('.app-toasts .toast__title, .app-toasts [data-slot=toast-title], [data-slot=toast] [data-slot=title]')].map(e => e.textContent.trim()).join(' / ') || [...document.querySelectorAll('.app-toasts li, [data-slot=toast]')].map(e => e.textContent.trim()).join(' / '))
  const apply = (page, words) => page.locator(`button[aria-label="Apply ${words}"]`)
  const skip = (page, words) => page.locator(`button[aria-label="Skip ${words}"]`)
  const hold = (page, ms) => page.route(OUTBOX, async r => { await wait(ms); await r.continue().catch(() => {}) })
  const tag = `${engine} ${phone ? '390' : '1280'}`

  // 1. ✓ with the answer held 3 s: applied in place at once, notice now; then the real line in the same spot.
  {
    reseed(); const { context, page, errors } = await fresh(); await hold(page, 3000)
    const nextTop = async () => (await page.locator('[data-draft-item]', { hasText: 'Email the landlord' }).boundingBox()).y
    const topBefore = await nextTop()
    await press(page, apply(page, 'Renew the passport'))
    await wait(100)
    const early = await bands(page), notice = await toastText(page), topDecided = await nextTop()
    ok(`${tag} 1 ✓: applied at once, no ✓ ✕ left`, /^Renew:applied Email:open Book:open Send:open$/.test(early) && !(await apply(page, 'Renew the passport').count()), early)
    ok(`${tag} 1 ✓: Applied · Undo shows before the server answers`, /Applied/.test(notice) && states() === 'oooo', `${notice} · store ${states()}`)
    await wait(4500)
    const late = await bands(page), lines = await page.locator('.editor-task-title').allTextContents()
    const topAnswered = await nextTop()
    // Nothing below moves when the decided band becomes the real line (Jazz 93fbd48f: a row under his next press).
    ok(`${tag} 1 ✓: nothing below moves, decided or answered`, Math.abs(topAnswered - topDecided) <= 1, `next band at ${topBefore} → ${topDecided} → ${topAnswered}`)
    ok(`${tag} 1 ✓: answered, the band is the real line`, !/Renew/.test(late) && lines.includes('Renew the passport') && states() === 'aooo', `${late} · store ${states()}`)
    ok(`${tag} 1 no page errors`, !errors.length, errors.join('; '))
    await context.close()
  }

  // 2. ✕ with the answer held 3 s: skipped look for the 1 s hold, then closed, before the server has answered.
  {
    reseed(); const { context, page } = await fresh(); await hold(page, 3000)
    await press(page, skip(page, 'Book the dentist'))
    await wait(100)
    const early = await bands(page), notice = await toastText(page)
    ok(`${tag} 2 ✕: skipped look at once`, /Book:skipped/.test(early), early)
    ok(`${tag} 2 ✕: Skipped notice now`, /Skipped/.test(notice), notice)
    await wait(1300)
    const closed = await bands(page)
    ok(`${tag} 2 ✕: closed after its hold, answer still held`, !/Book/.test(closed) && states() === 'oooo', `${closed} · store ${states()}`)
    await wait(2500)
    ok(`${tag} 2 ✕: answered, skipped once`, states() === 'ooso' && !/Book/.test(await bands(page)), states())
    await context.close()
  }

  // 3. His Nov 22 sequence (Bumblebee a12fc0ff): ✓ row 1, ✓ row 3 a second later, Dismiss a second after that, each
  //    answer held 3 s. Rows 1 and 3 stay applied, only 2 and 4 skip, `Skipped 2`, nothing refused.
  {
    reseed(); const { context, page } = await fresh(); await hold(page, 3000)
    await press(page, apply(page, 'Renew the passport')); await wait(1000)
    await press(page, apply(page, 'Book the dentist')); await wait(1000)
    await press(page, page.locator('.draft-line button', { hasText: 'Dismiss' }))
    await wait(100)
    const early = await bands(page), notice = await toastText(page)
    ok(`${tag} 3 his sequence: 1 and 3 applied, 2 and 4 skipped at once`, early === 'Renew:applied Email:skipped Book:applied Send:skipped', early)
    ok(`${tag} 3 his sequence: Skipped 2`, /Skipped 2/.test(notice), notice)
    let s = ''
    for (let i = 0; i < 30 && (s = states()) !== 'asas'; i++) await wait(500)
    ok(`${tag} 3 his sequence: stored as decided`, s === 'asas', s)
    ok(`${tag} 3 his sequence: nothing refused`, !(await notes(page)).length, (await notes(page)).join(' / '))
    await context.close()
  }

  if (phone) {
    // 4. Decided elsewhere first: ✓ is refused, said on its line for 4 s, and the Applied notice closes.
    {
      reseed(); const { context, page } = await fresh()
      const { ws, day, draft } = draftNow(), item = draft.items.find(i => i.taskId && ws.tasks.find(t => t.id === i.taskId)?.title === 'Renew the passport')
      const repo = new SqliteWorkspaceRepository(storePath, undefined, { allowMissingLegacy: true }), w = await repo.load()
      await repo.execute({ operationId: crypto.randomUUID(), expectedRevision: w.revision, action: { type: 'skip-draft', pageId: day.id, itemIds: [item.id] } })
      await press(page, apply(page, 'Renew the passport'))
      let n = []
      for (let i = 0; i < 20 && !(n = await notes(page)).length; i++) await wait(150)
      await wait(700) // the closed notice's exit
      const notice = await toastText(page)
      ok(`${tag} 4 refused: said where he pressed`, n.includes('Not applied · changed elsewhere'), `${n.join(' / ')} · ${await bands(page)}`)
      ok(`${tag} 4 refused: no Applied notice left`, !/Applied/.test(notice), notice)
      await wait(4300)
      ok(`${tag} 4 refused: the note goes after 4 s`, !(await notes(page)).length && states() === 'sooo', `${(await notes(page)).join(' / ')} · ${states()}`)
      await context.close()
    }

    // 4b. The draft changed elsewhere (another item skipped there), then ✓ here: the server holds it. Said on its line,
    //     the Applied notice closes, and the banner keeps Keep mine / Discard (Ratchet 0fd0406e).
    {
      reseed(); const { context, page } = await fresh()
      const { day, draft } = draftNow(), last = draft.items[3]
      const repo = new SqliteWorkspaceRepository(storePath, undefined, { allowMissingLegacy: true }), w = await repo.load()
      await repo.execute({ operationId: crypto.randomUUID(), expectedRevision: w.revision, action: { type: 'skip-draft', pageId: day.id, itemIds: [last.id] } })
      await press(page, apply(page, 'Renew the passport'))
      let n = []
      for (let i = 0; i < 20 && !(n = await notes(page)).length; i++) await wait(150)
      await wait(700)
      const notice = await toastText(page), banner = await page.locator('body').textContent()
      ok(`${tag} 4b held: said where he pressed, back to offered`, n.includes('Not applied · changed elsewhere') && /Renew:open/.test(await bands(page)), `${n.join(' / ')} · ${await bands(page)}`)
      ok(`${tag} 4b held: no Applied notice left`, !/Applied/.test(notice), notice)
      ok(`${tag} 4b held: the banner keeps its way back`, /Keep mine/.test(banner) && /Discard/.test(banner))
      ok(`${tag} 4b held: nothing applied`, states() === 'ooos', states())
      await wait(4500)
      ok(`${tag} 4b held: still said after 4 s, while it's held`, (await notes(page)).includes('Not applied · changed elsewhere'), (await notes(page)).join(' / '))
      await page.getByRole('button', { name: 'Discard' }).first().click(); await wait(800)
      ok(`${tag} 4b held: Discard in the banner ends it`, !(await notes(page)).length && /Renew:open/.test(await bands(page)), `${(await notes(page)).join(' / ')} · ${await bands(page)}`)
      await context.close()
    }

    // 4c. Decided offline, held only when the outbox sends it later, on this page (Ratchet 34690a2c): said in place, its
    //     own Applied notice closes; a newer decision's notice stays.
    {
      reseed(); const { context, page } = await fresh()
      await page.route(OUTBOX, r => r.abort())
      await press(page, apply(page, 'Renew the passport')); await wait(400)
      const { day, draft } = draftNow(), last = draft.items[3]
      const repo = new SqliteWorkspaceRepository(storePath, undefined, { allowMissingLegacy: true }), w = await repo.load()
      await repo.execute({ operationId: crypto.randomUUID(), expectedRevision: w.revision, action: { type: 'skip-draft', pageId: day.id, itemIds: [last.id] } })
      await press(page, skip(page, 'Book the dentist')); await wait(300)
      const before = await bands(page)
      await page.unroute(OUTBOX)
      let n = []
      for (let i = 0; i < 60 && !(n = await notes(page)).length; i++) await wait(250)
      await wait(700)
      const notice = await toastText(page)
      ok(`${tag} 4c held later: said in place`, n.includes('Not applied · changed elsewhere') && /Renew:open/.test(await bands(page)), `${before} → ${await bands(page)} · ${n.join(' / ')}`)
      ok(`${tag} 4c held later: its Applied notice closed, the newer Skipped stays`, !/Applied/.test(notice) && /Skipped/.test(notice), notice)
      await context.close()
    }

    // 4d. The same for ✕, Dismiss, and a ✕ decided offline and held when sent later (Ratchet 85c5939a): a skip is his,
    //     not the app's, so it's said in place and the banner keeps its way back.
    for (const how of ['✕', 'Dismiss', '✕ offline']) {
      reseed(); const { context, page } = await fresh()
      if (how === '✕ offline') await page.route(OUTBOX, r => r.abort())
      const elsewhere = async () => {
        const { day, draft } = draftNow(), last = draft.items[3]
        const repo = new SqliteWorkspaceRepository(storePath, undefined, { allowMissingLegacy: true }), w = await repo.load()
        await repo.execute({ operationId: crypto.randomUUID(), expectedRevision: w.revision, action: { type: 'skip-draft', pageId: day.id, itemIds: [last.id] } })
      }
      if (how !== '✕ offline') await elsewhere()
      if (how === 'Dismiss') await press(page, page.locator('.draft-line button', { hasText: 'Dismiss' }))
      else await press(page, skip(page, 'Renew the passport'))
      if (how === '✕ offline') { await wait(400); await elsewhere(); await page.unroute(OUTBOX) }
      let n = []
      for (let i = 0; i < 60 && !(n = await notes(page)).length; i++) await wait(250)
      await wait(700)
      const notice = await toastText(page), banner = await page.locator('body').textContent()
      ok(`${tag} 4d ${how} held: said in place, back to offered`, n.includes('Not skipped · changed elsewhere') && /Renew:open/.test(await bands(page)), `${n.join(' / ')} · ${await bands(page)}`)
      ok(`${tag} 4d ${how} held: no Skipped notice, the banner keeps its way back`, !/Skipped/.test(notice) && /Keep mine/.test(banner) && /Discard/.test(banner), notice)
      ok(`${tag} 4d ${how} held: nothing skipped here`, states() === 'ooos', states())
      await context.close()
    }

    // 5. Second presses: a decided band has no ✓ ✕; Apply all twice in one frame sends one apply, for the rest only.
    {
      reseed(); const { context, page } = await fresh()
      const sent = []
      await page.route(OUTBOX, async r => { sent.push(JSON.stringify(r.request().postDataJSON() ?? r.request().postData())); await wait(1500); await r.continue().catch(() => {}) })
      await press(page, apply(page, 'Email the landlord')); await wait(100)
      ok(`${tag} 5 a decided band has no ✓ ✕ to press again`, !(await apply(page, 'Email the landlord').count()) && !(await skip(page, 'Email the landlord').count()))
      const line = await page.locator('.draft-line').textContent()
      ok(`${tag} 5 the draft line counts what's left`, /3 suggestions/.test(line), line.trim())
      await page.locator('.draft-line button', { hasText: 'Apply all' }).evaluate(b => { b.click(); b.click() })
      let s = ''
      for (let i = 0; i < 20 && (s = states()) !== 'aaaa'; i++) await wait(500)
      const applies = sent.filter(x => /apply-draft/.test(x))
      ok(`${tag} 5 Apply all twice in one frame: one apply for the three left`, s === 'aaaa' && applies.length === 2, `${s} · ${applies.length} apply-draft sent`)
      await context.close()
    }

    // 6. ✓, Undo at once, the ✓'s answer lost; reopen: offered again, no line added, and it stays that way.
    {
      reseed(); const { context, page } = await fresh()
      let first = true
      await page.route(OUTBOX, async r => {
        if (first && /apply-draft/.test(r.request().postData() ?? '')) { first = false; await r.fetch().catch(() => {}); await r.abort(); return }
        await r.continue().catch(() => {})
      })
      await press(page, apply(page, 'Send the rent receipt')); await wait(150)
      await page.locator('[data-slot=toast] button, .app-toasts button', { hasText: 'Undo' }).first().click()
      await wait(100)
      ok(`${tag} 6 Undo at once: offered again`, /Send:open/.test(await bands(page)), await bands(page))
      await wait(8000)
      await page.unroute(OUTBOX)
      await page.reload({ waitUntil: 'networkidle' }); await page.locator('[data-draft-item]').first().waitFor({ timeout: 20000 }); await wait(2500)
      const lines = await page.locator('.bn-block-content').allTextContents()
      ok(`${tag} 6 after reopening: offered, no line added`, /Send:open/.test(await bands(page)) && !lines.some(l => /Send the rent receipt/.test(l)) && states() === 'oooo', `${await bands(page)} · store ${states()}`)
      await context.close()
    }

    // 7. Stored and never sent (offline), then a reload: the decided looks come from the stored changes (§2.6).
    {
      reseed(); const { context, page } = await fresh()
      await page.route(OUTBOX, r => r.abort())
      await press(page, apply(page, 'Email the landlord')); await wait(300)
      await press(page, skip(page, 'Book the dentist')); await wait(1500)
      await page.reload({ waitUntil: 'domcontentloaded' }); await page.locator('[data-draft-item]').first().waitFor({ timeout: 20000 }); await wait(1500)
      // A change stored before this load is drawn as made (outbox §4): the applied line is on the page, not a band.
      const after = await bands(page), lines = await page.locator('.editor-task-title').allTextContents()
      ok(`${tag} 7 reload while unsent: applied is on the page, skipped stays closed`, !/Email|Book/.test(after) && lines.includes('Email the landlord') && states() === 'oooo', `${after} · lines ${lines.join(', ')} · store ${states()}`)
      await page.unroute(OUTBOX)
      let s = ''
      for (let i = 0; i < 40 && (s = states()) !== 'oaso'; i++) await wait(500)
      ok(`${tag} 7 back online: sent as decided`, s === 'oaso', s)
      await context.close()
    }

    // 8. A browser that can't store anything (no IndexedDB): working in place of ✓ ✕ until the answer, then applied;
    //    a failed send brings the band back with `Not applied · try again`.
    for (const fails of [false, true]) {
      reseed()
      const context = await browser.newContext({ viewport: { width: 390, height: 844 }, hasTouch: true, timezoneId: 'America/Vancouver', serviceWorkers: 'block' })
      await context.addInitScript(() => { Object.defineProperty(window, 'indexedDB', { value: undefined }) })
      const page = await context.newPage()
      await page.goto(`${base}/`, { waitUntil: 'networkidle' }); await page.locator('[data-draft-item]').first().waitFor({ timeout: 20000 }); await wait(600)
      await page.route('**/_serverFn/**', async r => { if (!/apply-draft/.test(r.request().postData() ?? '')) return r.continue(); await wait(2000); if (fails) await r.abort(); else await r.continue().catch(() => {}) })
      await press(page, apply(page, 'Book the dentist')); await wait(400)
      const during = await bands(page)
      ok(`${tag} 8 nothing stored${fails ? ', send fails' : ''}: working at once`, /Book:working/.test(during), during)
      await wait(2600)
      const after = await bands(page), n = await notes(page)
      if (fails) ok(`${tag} 8 send fails: back, with Not applied · try again`, /Book:open/.test(after) && n.includes('Not applied · try again'), `${after} · ${n.join(' / ')}`)
      else ok(`${tag} 8 answered: applied, its notice now`, !/Book/.test(after) && states() === 'ooao' && /Applied/.test(await toastText(page)), `${after} · ${states()}`)
      await context.close()
    }
  }
  await browser.close()
}
console.log(`\n${results.filter(Boolean).length}/${results.length} passed`)
process.exit(results.every(Boolean) ? 0 : 1)
