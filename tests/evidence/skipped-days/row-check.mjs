// #377 (Jazz sketch v4, Lead 028d4a5e, Ratchet e60932f5): a carried to-do skipped before says on which days and offers
// Another day on its row. Each case reseeds a throwaway store (tests/evidence/skipped-days/seed.ts), never his data.
// Usage: node tests/evidence/skipped-days/row-check.mjs <base-url> <store-path> [chromium|webkit]
//   Chromium at 390 with touch (his phone's shape); WebKit at 1280 with a mouse and the keyboard.
import * as pw from '@playwright/test'
import { execSync } from 'node:child_process'
import { DatabaseSync } from 'node:sqlite'
import { SqliteWorkspaceRepository } from '../../../src/server/sqlite-repository.ts'
import { draftOf } from '../../../src/domain/day-draft.ts'
import { plannedOn } from '../../../src/domain/workspace.ts'
const [base, storePath, only] = process.argv.slice(2), results = []
if (!base || !storePath) { console.error('Usage: node tests/evidence/skipped-days/row-check.mjs <base-url> <store-path> [chromium|webkit]'); process.exit(2) }
const ok = (name, pass, detail = '') => { results.push(pass); console.log(`${pass ? 'PASS' : 'FAIL'} ${name}${detail ? ` · ${detail}` : ''}`) }
const wait = ms => new Promise(r => setTimeout(r, ms))
const reseed = () => execSync(`node --no-warnings tests/evidence/skipped-days/seed.ts ${storePath}`, { stdio: 'ignore' })
const stored = () => {
  for (let i = 0; ; i++) {
    try { const db = new DatabaseSync(storePath, { readOnly: true, timeout: 2000 }); try { return JSON.parse(db.prepare('SELECT data FROM workspace WHERE id = 1').get().data) } finally { db.close() } }
    catch (e) { if (i > 5 || !/locked|busy/i.test(String(e))) throw e }
  }
}
const zone = 'America/Vancouver'
const day = offset => new Intl.DateTimeFormat('en-CA', { timeZone: zone }).format(new Date(Date.now() + offset * 86_400_000))
const wd = iso => new Date(`${iso}T12:00:00Z`).toLocaleDateString('en-US', { weekday: 'short', timeZone: 'UTC' })
const md = iso => `${Number(iso.slice(5, 7))}/${Number(iso.slice(8, 10))}`
const KATHY = 'Kathy homework app', TRV = 'Renew TRV', LONG = 'Set up the Kathy homework app on the iPad and share it with her teacher', LENNY = 'Lenny’s vet booking'
const itemOf = title => { const ws = stored(), page = ws.pages.find(p => p.type === 'daily' && p.date === day(0)), t = ws.tasks.find(x => x.title === title); return { ws, page, t, item: draftOf(ws, page.id).items.find(i => i.taskId === t.id) } }

for (const engine of only ? [only] : ['chromium', 'webkit']) {
  const browser = await pw[engine].launch()
  const phone = engine === 'chromium', tag = `${engine} ${phone ? '390' : '1280'}`
  const fresh = async () => {
    const context = await browser.newContext({ ...(phone ? { viewport: { width: 390, height: 844 }, hasTouch: true } : { viewport: { width: 1280, height: 900 } }), timezoneId: zone, serviceWorkers: 'block' })
    const page = await context.newPage(), errors = []
    page.on('pageerror', e => errors.push(e.message))
    await page.goto(`${base}/`, { waitUntil: 'networkidle' }); await page.locator('[data-draft-item]').first().waitFor({ timeout: 20000 }); await wait(600)
    return { context, page, errors }
  }
  const press = (page, loc) => (phone ? loc.tap() : loc.click())
  const band = (page, title) => page.locator('.draft-band', { has: page.locator('.draft-text', { hasText: new RegExp(`^${title}$`) }) })
  const another = (page, title) => band(page, title).locator('.draft-another')
  const choices = page => page.locator('.draft-days')
  const toast = page => page.evaluate(() => [...document.querySelectorAll('[data-slot=toast]')].map(e => e.textContent.trim()).join(' / '))
  const notes = page => page.evaluate(() => [...document.querySelectorAll('.draft-note')].map(e => e.textContent.trim()))

  // 1. Labels: the drafts' own days, a date for one more than 6 days back, a count from four; none on a never-skipped
  // to-do or a line. At 1280 the label stays on the title's line, so the band keeps its height.
  {
    reseed(); const { context, page, errors } = await fresh()
    const meta = async title => (await band(page, title).locator('.draft-skips [aria-hidden]').textContent().catch(() => null))
    const kathy = await meta(KATHY), trv = await meta(TRV), long = await meta(LONG)
    ok(`${tag} 1 labels`, kathy === `skipped ${md(day(-8))}, ${wd(day(-2))}, ${wd(day(-1))}` && trv === `skipped ${wd(day(-1))}` && long === 'skipped 5 times', `${kathy} | ${trv} | ${long}`)
    const full = await band(page, LONG).locator('.draft-skips .sr-only').textContent()
    ok(`${tag} 1 the full list is in the accessible text`, (full.match(/,/g) ?? []).length === 4, full)
    const ageShown = await band(page, KATHY).locator('.m-age').isVisible(), lennyAge = await band(page, LENNY).locator('.draft-since').isVisible()
    ok(`${tag} 1 the age: ${phone ? 'hidden on a labelled row (Lead f056fda9), kept on others' : 'kept'}`, ageShown === !phone && lennyAge, `labelled ${ageShown}, plain ${lennyAge}`)
    ok(`${tag} 1 no label or Another day on a never-skipped to-do or a line`, await band(page, LENNY).locator('.draft-meta').count() === 0 && await page.locator('.draft-band.is-line .draft-meta').count() === 0)
    if (!phone) {
      const h = async t => Math.round((await band(page, t).boundingBox()).height)
      ok(`${tag} 1 band height unchanged by the label`, await h(TRV) === await h(LENNY), `${await h(TRV)} vs ${await h(LENNY)}`)
    }
    ok(`${tag} 1 no page errors`, !errors.length, errors.join(' | ')); await context.close()
  }

  // 2. Geometry at 390 (Lead 028d4a5e): ✓ ✕ centred on the title's first line; the label and Another day's 44 px target
  // stop short of ✓ and never reach ✕.
  if (phone) {
    reseed(); const { context, page } = await fresh()
    const geometry = title => band(page, title).evaluate(b => {
      const text = b.querySelector('.draft-text').getClientRects()[0], [check, cross] = [...b.querySelectorAll('.draft-acts button')].map(x => x.getBoundingClientRect())
      const meta = b.querySelector('.draft-meta').getBoundingClientRect(), a = b.querySelector('.draft-another').getBoundingClientRect()
      const lineMid = text.top + text.height / 2, target = { left: a.left - 6, right: a.right + 4, top: a.top - 13, bottom: a.bottom + 13 }
      const overlaps = (x, y) => x.left < y.right && y.left < x.right && x.top < y.bottom && y.top < x.bottom
      return { dCheck: check.top + check.height / 2 - lineMid, dCross: cross.top + cross.height / 2 - lineMid, gap: check.left - meta.right, hitsCheck: overlaps(target, check), hitsCross: overlaps(target, cross), inBand: target.bottom <= b.getBoundingClientRect().bottom + 0.5, h: Math.round(b.getBoundingClientRect().height) }
    })
    for (const title of [KATHY, TRV, LONG]) {
      const g = await geometry(title)
      ok(`${tag} 2 ${title.slice(0, 20)}: ✓ ✕ on the title's first line`, Math.abs(g.dCheck) <= 1.5 && Math.abs(g.dCross) <= 1.5, `Δ✓ ${g.dCheck.toFixed(1)} Δ✕ ${g.dCross.toFixed(1)}, band ${g.h}px`)
      ok(`${tag} 2 ${title.slice(0, 20)}: label stops 8 px short of ✓; Another day's target clear of ✓ ✕, inside the band`, g.gap >= 7.5 && !g.hitsCheck && !g.hitsCross && g.inBand, JSON.stringify(g))
    }
    await press(page, another(page, KATHY)); await wait(200)
    const mids = await choices(page).evaluate(d => [...d.children].map(c => { const r = c.getBoundingClientRect(); return r.top + r.height / 2 }))
    const g = await geometry(KATHY)
    ok(`${tag} 2 choices open: ✓ ✕ still on the title's first line, clear of Another day`, Math.abs(g.dCheck) <= 1.5 && Math.abs(g.dCross) <= 1.5 && !g.hitsCheck && !g.hitsCross && g.gap >= 7.5, JSON.stringify(g))
    ok(`${tag} 2 Move to and its choices on one line`, Math.max(...mids) - Math.min(...mids) < 8, mids.map(Math.round).join(' '))
    await context.close()
  }

  // 8. Nothing below moves during the hold (Jazz 2cb3d6c2, Ratchet d6d28a51): after a day pick, the band keeps its
  // height until it closes with its choices; after a plain ✕ on a tall band (long title and label) too.
  {
    for (const [title, next, how] of [[KATHY, TRV, 'day'], [LONG, LENNY, 'day'], [LONG, LENNY, '✕']]) {
      reseed(); const { context, page } = await fresh()
      if (how === 'day') { await press(page, another(page, title)); await wait(150) }
      const top = async () => (await band(page, next).boundingBox()).y
      const before = await top(), seen = []
      await press(page, how === 'day' ? choices(page).locator('button').first() : page.locator(`button[aria-label="Skip ${title}"]`))
      let t = 0
      for (const at of [60, 300, 600, 900]) { await wait(at - t); t = at; seen.push(Math.round((await top()) - before)) }
      ok(`${tag} 8 ${how} on ${title.slice(0, 20)}: the next band holds still through the hold`, seen.every(d => Math.abs(d) <= 0.5), `moved ${seen.join(', ')} px at 60/300/600/900 ms`)
      await context.close()
    }
  }

  // 9. Label layout (Jazz 2cb3d6c2): at 390 line 2 breaks between the age and the days, never leaving a day alone; at
  // 1280 a label pushed under a long title starts at the title's edge.
  {
    reseed(); const { context, page } = await fresh()
    if (phone) {
      const g = await band(page, KATHY).evaluate(b => ({ lines: b.querySelector('.draft-skips').getClientRects().length, h: Math.round(b.querySelector('.draft-skips').getBoundingClientRect().height) }))
      ok(`${tag} 9 the days stay on one line of their own`, g.lines === 1 && g.h <= 20, JSON.stringify(g))
    } else {
      const d = await band(page, LONG).evaluate(b => Math.round(b.querySelector('.draft-meta').getBoundingClientRect().left - b.querySelector('.draft-text').getBoundingClientRect().left))
      ok(`${tag} 9 a label under a long title starts at the title's edge`, d === 0, `${d} px`)
    }
    await context.close()
  }

  // 3. Pick a day: decided in place at once (struck, "moved to", the day marked), one write: skipped here, planned
  // there, tagged as the row's. The band and its choices close after the hold; the line counts one fewer.
  {
    reseed(); const { context, page, errors } = await fresh()
    const countBefore = await page.locator('.draft-line').textContent()
    await press(page, another(page, KATHY)); await wait(150)
    const pick = choices(page).locator('button').nth(1), date = (await pick.getAttribute('aria-label')).replace(/^.* to /, '')
    await press(page, pick); await wait(120)
    const look = await band(page, KATHY).getAttribute('data-decided'), moved = await band(page, KATHY).locator('.draft-moved').textContent().catch(() => '')
    const chosen = await choices(page).locator('button.is-chosen').count()
    ok(`${tag} 3 decided at once: struck, moved to, the day marked`, look === 'skipped' && /^moved to /.test(moved) && chosen === 1, `${look} · ${moved} · chosen ${chosen}`)
    await wait(1500)
    const { item, t, ws } = itemOf(KATHY)
    ok(`${tag} 3 stored: skipped here, planned on the day, via the row`, item.state === 'skipped' && item.via === 'row' && Boolean(item.until) && plannedOn(ws, t.id) === item.until, `${item.state} ${item.until} ${item.via} (picked ${date})`)
    ok(`${tag} 3 band and choices closed; notice says Moved to`, await band(page, KATHY).count() === 0 && await choices(page).count() === 0 && /Moved to/.test(await toast(page)), await toast(page))
    const countAfter = await page.locator('.draft-line').textContent()
    ok(`${tag} 3 the line counts one fewer`, Number(countBefore.match(/\d+/)[0]) - 1 === Number(countAfter.match(/\d+/)[0]), `${countBefore} → ${countAfter}`)

    // 4. Undo: the skip and the move both go; the band comes back open with the same days (today's skip doesn't count).
    await press(page, page.locator('[data-slot=toast] button', { hasText: 'Undo' }).first()); await wait(1500)
    const back = itemOf(KATHY)
    const label = await band(page, KATHY).locator('.draft-skips [aria-hidden]').textContent().catch(() => null)
    ok(`${tag} 4 Undo: open again, plan back, same days`, back.item.state === 'open' && !back.item.until && plannedOn(back.ws, back.t.id) === day(-9) && label === `skipped ${md(day(-8))}, ${wd(day(-2))}, ${wd(day(-1))}`, `${back.item.state} · ${plannedOn(back.ws, back.t.id)} · ${label}`)
    ok(`${tag} 3-4 no page errors`, !errors.length, errors.join(' | ')); await context.close()
  }

  // 5. Refused (skipped in another tab meanwhile): no half move, the band doesn't come back as something to act on,
  // and a note says why where he pressed.
  {
    reseed(); const { context, page, errors } = await fresh()
    await press(page, another(page, TRV)); await wait(150)
    const { page: day0, item } = itemOf(TRV)
    const repo = new SqliteWorkspaceRepository(storePath, undefined, { allowMissingLegacy: true }), ws = await repo.load()
    await repo.execute({ operationId: crypto.randomUUID(), expectedRevision: ws.revision, action: { type: 'skip-draft', pageId: day0.id, itemIds: [item.id] } })
    await press(page, choices(page).locator('button').first()); await wait(1500)
    const after = itemOf(TRV)
    ok(`${tag} 5 refused: still only skipped, not moved`, after.item.state === 'skipped' && !after.item.until && plannedOn(after.ws, after.t.id) === day(-9), `${after.item.state} ${after.item.until ?? ''}`)
    ok(`${tag} 5 note says why; no band to act on`, (await notes(page)).includes('Not moved · changed elsewhere') && await band(page, TRV).locator('.draft-acts button').count() === 0, (await notes(page)).join(' | '))
    ok(`${tag} 5 no page errors`, !errors.length, errors.join(' | ')); await context.close()
  }

  // 6. Apply all while the choices are open: they close, and the row is decided along with the rest.
  {
    reseed(); const { context, page } = await fresh()
    await press(page, another(page, KATHY)); await wait(150)
    await press(page, page.locator('.draft-line button', { hasText: 'Apply all' })); await wait(1500)
    const { item } = itemOf(KATHY)
    ok(`${tag} 6 Apply all with choices open: choices gone, row applied`, await choices(page).count() === 0 && item.state === 'applied', `${await choices(page).count()} · ${item.state}`)
    await context.close()
  }

  // 7. Keyboard (laptop): Enter opens and focuses the first day, Esc closes and puts focus back on Another day; a day
  // picked from the keyboard hands focus to the next suggestion's ✓ when its band closes. Pick… cancelled stores nothing.
  if (!phone) {
    reseed(); const { context, page } = await fresh()
    await another(page, KATHY).focus(); await page.keyboard.press('Enter'); await wait(200)
    const first = await page.evaluate(() => document.activeElement?.closest('.draft-days') !== null && document.activeElement?.tagName === 'BUTTON')
    await page.keyboard.press('Escape'); await wait(200)
    const backOn = await page.evaluate(() => document.activeElement?.classList.contains('draft-another'))
    ok(`${tag} 7 Enter opens on the first day; Esc closes, focus back on Another day`, first && backOn && await choices(page).count() === 0, `first ${first} back ${backOn}`)
    await page.keyboard.press('Enter'); await wait(200)
    const rev = stored().revision
    await choices(page).locator('button', { hasText: 'Pick…' }).focus(); await page.keyboard.press('Enter'); await wait(300); await page.keyboard.press('Escape'); await wait(900)
    ok(`${tag} 7 Pick… cancelled: nothing stored, choices still open`, stored().revision === rev && await choices(page).count() === 1, `rev ${rev} → ${stored().revision}`)
    await choices(page).locator('button').first().focus(); await page.keyboard.press('Enter'); await wait(1500)
    const focus = await page.evaluate(() => document.activeElement?.getAttribute('aria-label') ?? document.activeElement?.className ?? '')
    ok(`${tag} 7 after the hold, focus on the next suggestion's ✓`, /^Apply /.test(focus) && !focus.includes('Kathy homework app'), focus)
    await context.close()
  }
  await browser.close()
}
const failed = results.filter(r => !r).length
console.log(`${results.length - failed}/${results.length} passed`)
process.exit(failed ? 1 : 0)
