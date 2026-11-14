// Place step 1 in the built app (place-contract.md, D15 G8-1 to G8-4, G8-7): the cell and its links, the search with its
// thresholds, failures and late replies, keeping words, current location and its exits, and step 1's network.
// Usage: node tests/evidence/place/place.mjs <base-url> <stand-in-log> [chromium|webkit]
//   The server at <base-url> runs on a store fresh from seed.ts with DAYTHREAD_PLACE_UPSTREAM pointing at
//   mock-photon.mjs, whose log is <stand-in-log>; reseed and restart both before each engine.
import * as pw from '@playwright/test'
import { readFileSync } from 'node:fs'
const [base, log, only] = process.argv.slice(2), results = []
if (!base || !log) { console.error('Usage: node tests/evidence/place/place.mjs <base-url> <stand-in-log> [chromium|webkit]'); process.exit(2) }
const ok = (name, pass, detail = '') => { results.push(pass); console.log(`${pass ? 'PASS' : 'FAIL'} ${name}${detail ? ` · ${detail}` : ''}`) }
const wait = ms => new Promise(r => setTimeout(r, ms))
const sent = () => readFileSync(log, 'utf8').split('\n').filter(Boolean).map(l => JSON.parse(l))
const today = new Date().toLocaleDateString('en-US', { month: 'short', day: 'numeric' })

for (const engine of only ? [only] : ['chromium', 'webkit']) {
  const browser = await pw[engine].launch()
  const tag = engine
  const context = await browser.newContext({ viewport: { width: 1280, height: 900 }, serviceWorkers: 'block' })
  // A maps app's page opens in a new tab; answered here, so nothing leaves this machine.
  await context.route(/openstreetmap\.org|maps\.apple\.com/, route => route.fulfill({ status: 200, body: 'map' }))
  const page = await context.newPage()
  const errors = [], outside = []
  page.on('pageerror', e => errors.push(e.message))
  context.on('request', r => { const host = new URL(r.url()).hostname; if (host !== '127.0.0.1' && !/openstreetmap|maps\.apple/.test(host)) outside.push(r.url()) })
  const settle = async () => { await page.waitForLoadState('networkidle').catch(() => {}); await wait(250) }
  const open = async () => { await page.goto(`${base}/pages?page=eats`); await page.getByText('Golden Dumpling').first().waitFor({ timeout: 20000 }); await settle() }
  const cell = row => page.locator(`[data-cell*="|${row}|pl"]`).first()
  const cellText = async row => (await cell(row).innerText()).trim()
  const field = () => page.getByRole('textbox', { name: 'Search Where' })
  const rowsShown = () => page.locator('#place-rows [role=option]').allInnerTexts().then(x => x.map(t => t.replace(/\s+/g, ' ').trim()))
  const highlighted = () => page.locator('#place-rows [role=option][aria-selected=true]').innerText().then(t => t.replace(/\s+/g, ' ').trim()).catch(() => '')
  const edit = async row => { const b = await cell(row).boundingBox(); await page.mouse.click(b.x + b.width - 12, b.y + b.height / 2); await field().waitFor() }
  const type = async text => { await field().pressSequentially(text, { delay: 20 }) }

  // ---- Network: a day page and the database page, nothing open, ask nothing of any provider (G8-7).
  await page.goto(`${base}/today`); await settle(); await open(); await wait(800)
  ok(`${tag} network: a day page and a page with a Place column send nothing to search or any outside host`, sent().length === 0 && outside.length === 0, `${sent().length} searches, ${outside.join(' ')}`)

  // ---- The cell (G8-1).
  const link = page.locator('a.cell-place', { hasText: 'Golden Dumpling' })
  ok(`${tag} cell: a pinned name is a link to OpenStreetMap at 1280, built from the template`, (await link.getAttribute('href')) === 'https://www.openstreetmap.org/?mlat=49.1859&mlon=-123.1338#map=17/49.1859/-123.1338')
  ok(`${tag} cell: words with no pin are plain text`, (await cellText('e2')) === 'ramen place near work' && await cell('e2').locator('a').count() === 0)
  const [tab] = await Promise.all([context.waitForEvent('page'), link.click()])
  await wait(300)
  ok(`${tag} cell: a tap on the name opens the map in a new tab, and doesn't edit`, /openstreetmap\.org\/\?mlat=49\.1859/.test(tab.url()) && await field().count() === 0, tab.url())
  await tab.close()
  await edit('e1')
  ok(`${tag} cell: a tap elsewhere in the cell edits`, await field().isVisible())
  await page.keyboard.press('Escape'); await settle()

  // ---- Opening sends nothing; words already there get the Search row, highlighted (G8-2, G8-6).
  const before = sent().length
  await edit('e2'); await wait(700)
  ok(`${tag} open: nothing is sent on opening, and the Search row is first and highlighted`, sent().length === before && (await highlighted()) === 'Search “ramen place near work”', `${sent().length - before} sent · ${await highlighted()}`)
  await page.keyboard.press('Escape'); await settle()
  ok(`${tag} open: closing saves nothing`, (await cellText('e2')) === 'ramen place near work')

  // ---- As he types: suggestions, the first highlighted; Enter picks; the notice names the city; Undo (G8-2).
  await edit('e4'); await type('Stanley Park'); await page.locator('#place-rows .place-name').first().waitFor(); await wait(200)
  const out = sent().at(-1)
  ok(`${tag} search: as he types, the words and a limit go out, nothing else of his`, out?.q === 'Stanley Park' && out.params.join() === 'q,limit' && !out.headers.some(h => /cookie|authorization|forwarded|x-real-ip|referer/.test(h)), JSON.stringify(out))
  ok(`${tag} search: the first suggestion is highlighted, name with its address`, (await highlighted()).startsWith('Stanley Park Vancouver, British Columbia, Canada'), await highlighted())
  ok(`${tag} search: the location row, suggestions, then the keep row`, (await rowsShown()).map(t => t.split(' ')[0]).join() === 'Use,Stanley,Stanley,Keep', (await rowsShown()).join(' | '))
  ok(`${tag} search: the foot says where the words go`, await page.getByText('Search by Photon · © OpenStreetMap').isVisible())
  await page.keyboard.press('Enter'); await settle()
  ok(`${tag} pick: Enter takes it, shown in the cell at once as a link`, (await cellText('e4')) === 'Stanley Park' && await cell('e4').locator('a.cell-place').count() === 1)
  ok(`${tag} pick: the notice names the place and its city, with one Undo`, await page.getByText(/Stanley Park, Vancouver/).first().isVisible() && await page.getByText(/Vancouver · Undo/).count() === 0)
  await page.getByRole('button', { name: 'Undo' }).last().click(); await settle()
  ok(`${tag} pick: Undo takes it back`, (await cellText('e4')) === '')

  // ---- Short words wait for Enter or the Search row; 2 characters with CJK search as typed (G8-2, Lead b41107d1).
  for (const [q, asTyped] of [['ab', false], ['京', false], ['西湖', true], ['外滩', true]]) {
    await edit('e4'); const n = sent().length
    await type(q); await wait(800)
    const typedSent = sent().length - n
    const hl = await highlighted()
    if (!asTyped) { await page.keyboard.press('Enter'); await page.locator('#place-rows .place-name').first().waitFor({ timeout: 5000 }).catch(() => {}) }
    ok(`${tag} threshold: "${q}" ${asTyped ? 'searches as typed' : 'sends nothing until Enter, which runs the highlighted Search row'}`,
      asTyped ? typedSent === 1 : typedSent === 0 && hl === `Search “${q}”` && sent().length - n === 1 && sent().at(-1).q === q, `${typedSent} as typed, highlight ${hl}, ${sent().length - n} in all`)
    await page.keyboard.press('Escape'); await settle()
  }
  ok(`${tag} threshold: nothing was saved by any of them`, (await cellText('e4')) === '')

  // ---- No match, failure, Retry and Keep (G8-3).
  await edit('e4'); await type('zzzq'); await page.getByText('No places for “zzzq”').waitFor({ timeout: 5000 }).catch(() => {})
  const lineAbove = await page.evaluate(() => { const line = [...document.querySelectorAll('#place-rows .property-empty')].find(e => e.textContent.includes('No places')); const keep = [...document.querySelectorAll('#place-rows [role=option]')].at(-1); return Boolean(line && keep && line.compareDocumentPosition(keep) & Node.DOCUMENT_POSITION_FOLLOWING) })
  ok(`${tag} no match: "No places for …" where the suggestions go, the keep row under it, no Retry`, await page.getByText('No places for “zzzq”').isVisible() && lineAbove && await page.getByRole('button', { name: 'Retry' }).count() === 0 && (await rowsShown()).at(-1) === 'Keep “zzzq” without a place')
  ok(`${tag} no match: Enter keeps nothing silently`, await (async () => { await page.keyboard.press('Enter'); await wait(300); return await field().isVisible() })())
  await page.keyboard.press('ArrowDown'); await page.keyboard.press('ArrowDown')
  const keepHl = await highlighted()
  await page.keyboard.press('Enter'); await settle()
  ok(`${tag} keep: the keep row, highlighted by the arrows, keeps the words with no pin`, keepHl === 'Keep “zzzq” without a place' && (await cellText('e4')) === 'zzzq' && await cell('e4').locator('a').count() === 0, keepHl)
  await edit('e3'); await type('fail spot'); await page.getByText('Search unavailable').waitFor({ timeout: 5000 }).catch(() => {})
  const failed = sent().length
  await wait(1500)
  ok(`${tag} failure: "Search unavailable · Retry", and no retry by itself`, await page.getByText('Search unavailable').isVisible() && sent().length === failed)
  await page.getByRole('button', { name: 'Retry' }).click(); await wait(800)
  ok(`${tag} failure: Retry sends once, on the tap`, sent().length === failed + 1)
  await page.locator('#place-rows [role=option]', { hasText: 'Keep' }).click(); await settle()
  ok(`${tag} failure: the keep row still keeps his words`, (await cellText('e3')) === 'fail spot')

  // ---- Late replies never overwrite (G8-3).
  await edit('e4'); await field().fill(''); await type('slow one'); await wait(500)
  await page.keyboard.press('Escape'); await wait(3000)
  ok(`${tag} late reply: after a close, nothing changes`, (await cellText('e4')) === 'zzzq')
  await edit('e4'); await field().fill(''); await type('slow two'); await wait(500)
  await page.locator('#place-rows [role=option]', { hasText: 'Keep' }).click(); await wait(3000)
  ok(`${tag} late reply: after a keep, the kept words stay`, (await cellText('e4')) === 'slow two')

  // ---- Enter while suggestions are still loading runs the Search row and pins nothing (G8-2, Bumblebee f1bad398).
  await edit('e4'); await field().fill(''); await type('slow three'); await wait(500)
  const loadingHl = await highlighted(), n2 = sent().length
  await page.keyboard.press('Enter'); await wait(3500)
  ok(`${tag} Enter while loading: the Search row is highlighted, Enter searches again and pins nothing`,
    loadingHl === 'Search “slow three”' && sent().length === n2 + 1 && sent().at(-1).q === 'slow three' && (await cellText('e4')) === 'slow two' && await field().isVisible(), `${loadingHl} · ${sent().length - n2} sent · ${await cellText('e4')}`)
  await page.keyboard.press('Escape'); await settle()

  // ---- Over 256 characters: kept whole, never searched (G8-1).
  await edit('e4'); await field().fill('')
  const n0 = sent().length, long = 'a very long name '.repeat(17).trim()
  await field().fill(long); await wait(800)
  ok(`${tag} long words: "Too long to search", no Search row, nothing sent`, await page.getByText('Too long to search').isVisible() && !(await rowsShown()).some(t => t.startsWith('Search')) && sent().length === n0)
  await page.locator('#place-rows [role=option]', { hasText: 'Keep' }).click(); await settle()
  ok(`${tag} long words: kept whole`, (await cellText('e4')) === long)
  await edit('e4'); await field().fill(''); await field().focus(); await page.keyboard.insertText('x'.repeat(10_001)); await wait(300)
  const held = (await field().inputValue()).length
  await page.locator('#place-rows [role=option]', { hasText: 'Keep' }).click(); await settle()
  ok(`${tag} long words: the field holds at most 10,000 characters, and Keep saves them all`, held === 10_000 && (await cellText('e4')).length === 10_000, `${held} held, ${(await cellText('e4')).length} saved`)

  // ---- Errors.
  ok(`${tag} no page errors, and nothing sent outside this machine`, errors.length === 0 && outside.length === 0, `${errors.join(' | ').slice(0, 200)} ${outside.join(' ')}`)
  await context.close()

  // ---- Current location (G8-4): asked only on the tap; the field's words or "Location on <date>"; a pin, no lookup.
  {
    const ctx = await browser.newContext({ viewport: { width: 1280, height: 900 }, serviceWorkers: 'block', permissions: ['geolocation'], geolocation: { latitude: 49.2827, longitude: -123.1207 } })
    // Every ask is counted, and answered after `delay` ms, so a close or a pick can come first.
    await ctx.addInitScript(() => {
      const real = navigator.geolocation.getCurrentPosition.bind(navigator.geolocation)
      window.__asks = 0; window.__delay = 0
      navigator.geolocation.getCurrentPosition = (ok, no, o) => { window.__asks++; setTimeout(() => real(ok, no, o), window.__delay) }
      navigator.geolocation.watchPosition = () => { window.__watched = true; return 0 }
    })
    const p2 = await ctx.newPage()
    await p2.goto(`${base}/pages?page=eats`); await p2.getByText('Golden Dumpling').first().waitFor({ timeout: 20000 }); await wait(500)
    const c2 = row => p2.locator(`[data-cell*="|${row}|pl"]`).first()
    const ed2 = async row => { const b = await c2(row).boundingBox(); await p2.mouse.click(b.x + b.width - 12, b.y + b.height / 2); await p2.getByRole('textbox', { name: 'Search Where' }).waitFor() }
    const locRow = () => p2.locator('#place-rows [role=option]', { hasText: 'Use current location' })
    await ed2('e3'); await p2.getByRole('textbox', { name: 'Search Where' }).fill('')
    ok(`${tag} location: nothing asked on opening; the row says what it will save`, (await p2.evaluate(() => window.__asks)) === 0 && (await locRow().innerText()).includes(`Saved as “Location on ${today}”`), await locRow().innerText())
    const n1 = sent().length
    await locRow().click(); await wait(800)
    ok(`${tag} location: an empty field saves "Location on ${today}" with a pin, and nothing goes to search`, (await c2('e3').innerText()).trim() === `Location on ${today}` && await c2('e3').locator('a.cell-place').count() === 1 && sent().length === n1 && !(await p2.evaluate(() => window.__watched)))
    ok(`${tag} location: the pin is his position, the link built from it`, /mlat=49\.282700|mlat=49\.2827/.test(await c2('e3').locator('a').getAttribute('href') ?? ''), await c2('e3').locator('a').getAttribute('href'))
    await ed2('e4'); await p2.getByRole('textbox', { name: 'Search Where' }).fill('my desk'); await locRow().click(); await wait(800)
    ok(`${tag} location: with words in the field, they're its name`, (await c2('e4').innerText()).trim() === 'my desk')
    // Exits before the position arrives: close, then a pick; and two taps at once.
    await p2.evaluate(() => { window.__delay = 1500 })
    await ed2('e2'); await locRow().click(); await wait(100)
    const finding = (await locRow().innerText()).includes('Finding your location…')
    await p2.keyboard.press('Escape'); await wait(2200)
    ok(`${tag} location: "Finding your location…", and closing first saves nothing`, finding && (await c2('e2').innerText()).trim() === 'ramen place near work')
    await ed2('e2'); await locRow().click(); await wait(100)
    await p2.getByRole('textbox', { name: 'Search Where' }).fill(''); await p2.getByRole('textbox', { name: 'Search Where' }).pressSequentially('Stanley Park', { delay: 10 })
    await p2.locator('#place-rows .place-name').first().waitFor(); await p2.locator('#place-rows .place-name').first().click(); await wait(2200)
    ok(`${tag} location: a pick before it arrives wins, and the late position is dropped`, (await c2('e2').innerText()).trim() === 'Stanley Park')
    await ed2('e2'); await locRow().click(); await wait(100)
    await p2.getByRole('textbox', { name: 'Search Where' }).pressSequentially('京', { delay: 10 }); await wait(200)
    const back = await locRow().innerText()
    await p2.keyboard.press('Escape'); await wait(2000)
    ok(`${tag} location: typing ends a request still waiting, and the row goes back to what a tap would save`, back.includes('Saved as') && !back.includes('Finding') && (await c2('e2').innerText()).trim() === 'Stanley Park', back.replace(/\s+/g, ' '))
    await ed2('e2'); await p2.getByRole('textbox', { name: 'Search Where' }).fill('twice'); await locRow().click(); await locRow().click(); await wait(2500)
    ok(`${tag} location: two taps at once save once, from the second`, (await c2('e2').innerText()).trim() === 'twice' && (await p2.evaluate(() => window.__asks)) >= 2)
    await ctx.close()
  }
  {
    const ctx = await browser.newContext({ viewport: { width: 1280, height: 900 }, serviceWorkers: 'block' })
    await ctx.addInitScript(() => { navigator.geolocation.getCurrentPosition = (_ok, no) => setTimeout(() => no({ code: 1, message: 'denied' }), 50) })
    const p3 = await ctx.newPage()
    await p3.goto(`${base}/pages?page=eats`); await p3.getByText('Golden Dumpling').first().waitFor({ timeout: 20000 }); await wait(500)
    const b = await p3.locator('[data-cell*="|e1|pl"]').first().boundingBox(); await p3.mouse.click(b.x + b.width - 12, b.y + b.height / 2)
    await p3.locator('#place-rows [role=option]', { hasText: 'Use current location' }).click(); await wait(400)
    ok(`${tag} location: denied reads "Location is off", and search still works`, (await p3.locator('#place-rows').innerText()).includes('Location is off') && await p3.getByRole('textbox', { name: 'Search Where' }).isVisible())
    await ctx.close()
  }

  // ---- At 390: the sheet, Apple Maps, and a pick by tap (G8-1, G8-2).
  {
    const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, isMobile: engine === 'chromium', hasTouch: true, serviceWorkers: 'block' })
    const p4 = await ctx.newPage()
    await p4.goto(`${base}/pages?page=eats`); await p4.getByText('Golden Dumpling').first().waitFor({ timeout: 20000 }); await wait(600)
    ok(`${tag} 390: a pinned name opens Apple Maps, from the template`, (await p4.locator('a.cell-place', { hasText: 'Golden Dumpling' }).getAttribute('href')) === 'https://maps.apple.com/?ll=49.1859%2C-123.1338&q=Golden%20Dumpling')
    const c = p4.locator('[data-cell*="|e3|pl"]').first(), b = await c.boundingBox()
    await p4.mouse.click(b.x + b.width - 8, b.y + b.height / 2)
    const sheet = p4.locator('.property-sheet')
    await sheet.waitFor({ timeout: 5000 }).catch(() => {})
    ok(`${tag} 390: the search is a sheet`, await sheet.isVisible())
    await p4.getByRole('textbox', { name: 'Search Where' }).click(); await p4.getByRole('textbox', { name: 'Search Where' }).fill(''); await p4.getByRole('textbox', { name: 'Search Where' }).pressSequentially('Stanley Park', { delay: 10 })
    await p4.locator('#place-rows .place-name').first().waitFor(); await p4.locator('#place-rows .place-name').first().tap()
    await wait(600)
    ok(`${tag} 390: a tap picks it, the sheet closes and the notice names the city`, (await c.innerText()).trim() === 'Stanley Park' && !(await sheet.isVisible().catch(() => false)) && await p4.getByText(/Stanley Park, Vancouver/).first().isVisible())
    await ctx.close()
  }
  await browser.close()
}
const failed = results.filter(x => !x).length
console.log(`${results.length - failed}/${results.length} passed`)
process.exit(failed ? 1 : 0)
