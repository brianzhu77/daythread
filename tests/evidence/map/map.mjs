// Place step 2, the Map view, in the built app (map-contract.md; D15 G8-9 to G8-11): the one outside host with no
// referrer or cookies, the lazy chunk, pins, counts, card and clusters, one live map, the inline block, the states, keys.
// Usage: node tests/evidence/map/map.mjs <base-url> [chromium|webkit]
//   The server at <base-url> runs on a store fresh from seed.ts. Map tiles come from OpenFreeMap itself.
import * as pw from '@playwright/test'
const [base, only] = process.argv.slice(2), results = []
if (!base) { console.error('Usage: node tests/evidence/map/map.mjs <base-url> [chromium|webkit]'); process.exit(2) }
const ok = (name, pass, detail = '') => { results.push(pass); console.log(`${pass ? 'PASS' : 'FAIL'} ${name}${detail ? ` · ${detail}` : ''}`) }
const wait = ms => new Promise(r => setTimeout(r, ms))
// Headless Chromium has no WebGL2 of its own; SwiftShader gives it one, as a real browser has (map-contract.md §1).
const gl = { chromium: { args: ['--enable-unsafe-swiftshader', '--use-angle=swiftshader', '--ignore-gpu-blocklist'] }, webkit: {} }

for (const engine of only ? [only] : ['chromium', 'webkit']) {
  const browser = await pw[engine].launch(gl[engine])
  const tag = engine
  const fresh = async (opts = {}) => {
    const context = await browser.newContext({ viewport: { width: 1280, height: 900 }, serviceWorkers: 'block', ...opts })
    const page = await context.newPage()
    const log = { outside: [], chunks: 0, errors: [] }
    page.on('pageerror', e => log.errors.push(e.message))
    page.on('request', r => {
      const u = new URL(r.url())
      if (u.hostname !== '127.0.0.1') log.outside.push({ host: u.hostname, path: u.pathname, referer: r.headers()['referer'] ?? '', cookie: Boolean(r.headers()['cookie']) })
      else if (/\/assets\/database-map-[^/]*\.js$/.test(u.pathname)) log.chunks++
    })
    return { context, page, log }
  }
  const settle = async page => { await page.waitForLoadState('networkidle').catch(() => {}); await wait(400) }
  const ready = page => page.locator('.map-frame.is-ready').first().waitFor({ timeout: 20000 }).then(() => true, () => false)
  const mapAt = (page, lon, lat, i = 0) => page.locator('.map-canvas').nth(i).evaluate((el, [lon, lat]) => { const p = el.mapForChecks.project([lon, lat]), r = el.getBoundingClientRect(); return { x: r.left + p.x, y: r.top + p.y } }, [lon, lat])
  const zoomOf = (page, i = 0) => page.locator('.map-canvas').nth(i).evaluate(el => el.mapForChecks.getZoom())

  // ---- No map, no cost: a day page and a database page without a Map view load no MapLibre and ask nothing outside (G8-11, R2-7).
  {
    const { context, page, log } = await fresh()
    await page.goto(`${base}/today`); await settle(page)
    ok(`${tag} no cost: a day page loads no map chunk and asks nothing outside`, log.chunks === 0 && log.outside.length === 0, `${log.chunks} chunks, ${log.outside.length} outside`)
    await context.close()
  }

  // ---- The Map view: one host, no referrer, no cookies; pins, counts, the card (G8-9 to G8-11).
  {
    const { context, page, log } = await fresh()
    await page.goto(`${base}/pages?page=eats`)
    const drew = await ready(page); await wait(1500)
    ok(`${tag} map: draws on its own page, the chunk loaded once`, drew && await page.locator('.map-canvas canvas').count() === 1 && log.chunks === 1, `${log.chunks} chunks`)
    const hosts = [...new Set(log.outside.map(r => r.host))]
    ok(`${tag} boundary: every outside request is to tiles.openfreemap.org, with no Referer and no cookie`, log.outside.length > 3 && hosts.join() === 'tiles.openfreemap.org' && log.outside.every(r => !r.referer && !r.cookie), `${log.outside.length} requests to ${hosts.join(' ')}`)
    ok(`${tag} boundary: the light scheme asks positron`, log.outside.some(r => r.path === '/styles/positron') && !log.outside.some(r => r.path === '/styles/dark'))
    ok(`${tag} boundary: attribution is linked, at the bottom right, and starts collapsed`, await page.locator('.maplibregl-ctrl-bottom-right .maplibregl-ctrl-attrib a[href*="openstreetmap.org/copyright"]').count() === 1 && await page.locator('.maplibregl-ctrl-attrib.maplibregl-compact:not(.maplibregl-compact-show)').count() === 1)
    ok(`${tag} counts: "No place · 2 ›" and no "shown" line under 100`, await page.getByRole('button', { name: 'No place · 2 ›' }).isVisible() && await page.getByText(/ of \d+ shown/).count() === 0)
    await page.getByRole('button', { name: 'No place · 2 ›' }).click()
    ok(`${tag} counts: it opens the rows with words and no pin, and the empty ones`, await page.locator('.map-no-place').getByText('Someday').isVisible() && await page.locator('.map-no-place').getByText('Unplaced').isVisible())
    // Zoomed in on Stanley Park, its pin alone; a tap shows its card with the row's shown property.
    await page.locator('.map-canvas').evaluate(el => el.mapForChecks.jumpTo({ center: [-123.1417, 49.3017], zoom: 15 })); await wait(1500)
    const pin = await mapAt(page, -123.1417, 49.3017)
    await page.mouse.click(pin.x, pin.y); await wait(500)
    const card = page.locator('.map-card')
    ok(`${tag} card: a tap on a pin shows its title and shown property`, await card.isVisible() && (await card.innerText()).includes('Stanley Park') && (await card.innerText()).includes('note 3'), await card.innerText().catch(() => ''))
    await page.keyboard.press('Escape'); await wait(300)
    ok(`${tag} card: Esc closes it`, await card.count() === 0)
    await page.mouse.click(pin.x, pin.y); await wait(500)
    await card.getByRole('button').first().click(); await settle(page)
    ok(`${tag} card: a tap on it opens the row`, page.url().includes('page=e3'), page.url())
    await context.close()
  }

  // ---- Clusters and the cap (G8-9, G8-10).
  {
    const { context, page } = await fresh()
    await page.goto(`${base}/pages?page=many`); await ready(page); await wait(1500)
    ok(`${tag} cap: "100 of 240 shown" under the map`, await page.getByText('100 of 240 shown').isVisible())
    const clusters = await page.locator('.map-canvas').evaluate(el => el.mapForChecks.queryRenderedFeatures({ layers: ['map-clusters'] }).map(f => ({ n: f.properties.point_count, c: f.geometry.coordinates })))
    const total = clusters.reduce((a, c) => a + c.n, 0)
    const z0 = await zoomOf(page)
    if (clusters[0]) { const at = await mapAt(page, clusters[0].c[0], clusters[0].c[1]); await page.mouse.click(at.x, at.y); await wait(1500) }
    ok(`${tag} clusters: Ink circles with counts that never exceed the 100 shown; a tap zooms in`, clusters.length > 0 && total <= 100 && (await zoomOf(page)) > z0, `${clusters.length} clusters holding ${total}, zoom ${z0.toFixed(1)} → ${(await zoomOf(page)).toFixed(1)}`)
    await context.close()
  }

  // ---- One live map per page: a dashboard of three Map widgets (Lead 9f694596).
  {
    const { context, page, log } = await fresh()
    await page.goto(`${base}/pages?page=board`); await ready(page); await wait(1000)
    const contexts = () => page.locator('.map-canvas canvas').count()
    ok(`${tag} one live map: three Map widgets, one canvas, MapLibre loaded once, the others "Show map"`, await contexts() === 1 && log.chunks === 1 && await page.getByRole('button', { name: 'Show map' }).count() === 2, `${await contexts()} canvases, ${log.chunks} chunks`)
    await page.getByRole('button', { name: 'Show map' }).first().click(); await ready(page); await wait(1500)
    const frames = await page.locator('.map-frame').evaluateAll(fs => fs.map(f => f.classList.contains('is-live')))
    ok(`${tag} one live map: Show map moves it there, and the one it left gets "Show map"`, await contexts() === 1 && frames.join() === 'false,true,false' && await page.getByRole('button', { name: 'Show map' }).count() === 2, frames.join())
    ok(`${tag} one live map: no page errors`, log.errors.length === 0, log.errors.join(' | ').slice(0, 200))
    await context.close()
  }

  // ---- Inline at 1280 (400 px), and at 390 "Open the map ›" (G8-9).
  {
    const { context, page } = await fresh()
    await page.goto(`${base}/pages?page=notes`); await page.locator('.database-map').first().waitFor()
    await page.evaluate(() => document.querySelector('.database-map')?.scrollIntoView()); await ready(page)
    const h = await page.locator('.map-frame').first().evaluate(el => el.getBoundingClientRect().height)
    ok(`${tag} inline at 1280: the map draws in its block, 400 px tall`, Math.round(h) === 400, `${h}`)
    await context.close()
  }
  {
    const { context, page, log } = await fresh({ viewport: { width: 390, height: 844 }, hasTouch: true })
    await page.goto(`${base}/pages?page=notes`); await page.getByText('Above the map').waitFor(); await settle(page); await wait(800)
    ok(`${tag} 390: an inline block says "Open the map ›", with no map and nothing asked outside`, await page.getByRole('button', { name: 'Open the map ›' }).isVisible() && await page.locator('.map-canvas').count() === 0 && log.outside.length === 0)
    await page.getByRole('button', { name: 'Open the map ›' }).click(); await ready(page); await page.waitForTimeout(500)
    ok(`${tag} 390: it opens the map on its database's page, attribution collapsed`, page.url().includes('page=eats') && await page.locator('.map-canvas canvas').count() === 1 && await page.locator('.maplibregl-ctrl-attrib.maplibregl-compact:not(.maplibregl-compact-show)').count() === 1)
    await context.close()
  }
  // A dashboard at 390 stacks its widgets in a scrolling page: Map widgets are "Open the map ›", no chunk until the tap,
  // and a one-finger drag over one scrolls the page (Lead fc1d9019, Jazz 3934e41e).
  {
    const { context, page, log } = await fresh({ viewport: { width: 390, height: 844 }, hasTouch: true, isMobile: engine === 'chromium' })
    await page.goto(`${base}/pages?page=board`); await page.getByText('Maps').first().waitFor(); await settle(page); await wait(800)
    ok(`${tag} 390 dashboard: every Map widget is "Open the map ›", with no map chunk and nothing asked outside`, await page.getByRole('button', { name: 'Open the map ›' }).count() === 3 && log.chunks === 0 && log.outside.length === 0 && await page.locator('.map-canvas').count() === 0, `${log.chunks} chunks`)
    if (engine === 'chromium') {
      // A short window, so the stacked widgets overflow it; a one-finger swipe up from the first Map widget.
      await page.setViewportSize({ width: 390, height: 420 }); await wait(300)
      const cdp = await context.newCDPSession(page)
      const at = await page.getByRole('button', { name: 'Open the map ›' }).first().boundingBox()
      const y0 = await page.evaluate(() => window.scrollY)
      await cdp.send('Input.synthesizeScrollGesture', { x: Math.round(at.x + 40), y: Math.round(at.y), yDistance: -200, gestureSourceType: 'touch', speed: 600 }); await wait(600)
      const y1 = await page.evaluate(() => window.scrollY)
      ok(`${tag} 390 dashboard: a one-finger swipe over a Map widget scrolls the page`, y1 > y0 + 50, `${y0} → ${y1}`)
      await page.setViewportSize({ width: 390, height: 844 }); await page.evaluate(() => window.scrollTo(0, 0)); await wait(300)
    }
    await page.getByRole('button', { name: 'Open the map ›' }).first().click(); await ready(page)
    ok(`${tag} 390 dashboard: the tap opens the full-page map, the chunk loading only then`, page.url().includes('page=eats') && log.chunks === 1 && await page.locator('.map-canvas canvas').count() === 1, `${log.chunks} chunks`)
    await context.close()
  }

  // ---- Dark: the dark style, asked of the same host.
  {
    const { context, page, log } = await fresh({ colorScheme: 'dark' })
    await page.goto(`${base}/pages?page=eats`); await ready(page)
    ok(`${tag} dark: the dark style`, log.outside.some(r => r.path === '/styles/dark') && !log.outside.some(r => r.path === '/styles/positron'))
    await context.close()
  }

  // ---- States: the style failing, Retry only on his tap; a hostile style never drawn; its property gone (G8-10, G8-11).
  {
    const { context, page, log } = await fresh()
    let styleAsks = 0
    await context.route(/tiles\.openfreemap\.org\/styles\//, route => { styleAsks++; return route.fulfill({ status: 500, body: '' }) })
    await page.goto(`${base}/pages?page=eats`); await page.getByText('Map unavailable').waitFor({ timeout: 15000 }).catch(() => {}); await wait(3000)
    ok(`${tag} unavailable: "Map unavailable · Retry", the frame at its height, and no asking again by itself`, await page.getByText('Map unavailable').isVisible() && styleAsks === 1 && Math.round(await page.locator('.map-frame').first().evaluate(el => el.getBoundingClientRect().height)) >= 400, `${styleAsks} asks`)
    await page.getByRole('button', { name: 'Retry' }).click(); await wait(1500)
    ok(`${tag} unavailable: Retry asks once, on the tap`, styleAsks === 2)
    await context.unroute(/tiles\.openfreemap\.org\/styles\//)
    await context.route(/tiles\.openfreemap\.org\/styles\//, async route => { const real = await (await fetch(route.request().url())).json(); real.sprite = 'https://example.org/sprite'; return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(real) }) })
    await page.getByRole('button', { name: 'Retry' }).click(); await wait(2500)
    ok(`${tag} boundary: a style naming another host isn't drawn, and nothing is asked of that host`, await page.getByText('Map unavailable').isVisible() && !log.outside.some(r => r.host !== 'tiles.openfreemap.org'))
    await context.close()
  }
  {
    const { context, page } = await fresh()
    await page.goto(`${base}/pages?page=eats`); await ready(page)
    await page.locator('[data-database-views]').first().click()
    await page.getByRole('menuitemradio', { name: /Old map/ }).click(); await settle(page)
    ok(`${tag} property gone: "Choose a Place property"`, await page.getByRole('button', { name: 'Choose a Place property' }).isVisible())
    await context.close()
  }

  // ---- Made from + Add view → Map; with one Place property it needs no asking (G8-9).
  {
    const { context, page } = await fresh()
    await page.goto(`${base}/pages?page=many`); await ready(page)
    await page.locator('[data-database-views]').first().click()
    const before = await page.locator('.database-menu button[aria-label="Map options"]').count()
    await page.getByRole('menuitem', { name: '+ Add view' }).click().catch(() => page.getByText('+ Add view').click())
    await page.getByRole('menuitem', { name: 'Map', exact: true }).click(); await settle(page)
    await page.keyboard.press('Escape'); await ready(page)
    await page.locator('[data-database-views]').first().click()
    const maps = await page.locator('.database-menu button[aria-label="Map options"]').count()
    await page.keyboard.press('Escape')
    ok(`${tag} made: + Add view → Map makes another Map view, by the one Place property, drawn`, maps === before + 1 && await page.locator('.map-frame.is-ready').count() === 1 && await page.getByText('100 of 240 shown').isVisible(), `${before} → ${maps} Map views`)
    await context.close()
  }

  // ---- Keys: letters, cut and paste in the map never reach the page (R1-26).
  {
    const { context, page } = await fresh()
    await page.goto(`${base}/pages?page=eats`); await ready(page)
    // Counted on the page around it, as the page editor would hear them.
    await page.evaluate(() => { window.reached = 0; document.body.addEventListener('keydown', () => window.reached++); document.body.addEventListener('paste', () => window.reached++) })
    await page.locator('.map-canvas canvas').focus()
    const z0 = await zoomOf(page)
    for (const k of ['x', 'Meta+v', 'Meta+x', 'Equal']) await page.keyboard.press(k)
    await wait(800)
    ok(`${tag} keys: letters, paste and cut stay in the map; + zooms it`, (await page.evaluate(() => window.reached)) === 0 && (await zoomOf(page)) > z0, `${await page.evaluate(() => window.reached)} reached the page`)
    await context.close()
  }
  await browser.close()
}

// ---- No WebGL2: "Map isn't available in this browser", no Retry (Lead 9f694596). Plain headless Chromium has none.
{
  const browser = await pw.chromium.launch()
  const page = await (await browser.newContext({ viewport: { width: 1280, height: 900 }, serviceWorkers: 'block' })).newPage()
  const outside = []; page.on('request', r => { if (new URL(r.url()).hostname !== '127.0.0.1') outside.push(r.url()) })
  await page.goto(`${base}/pages?page=eats`); await page.getByText("Map isn't available in this browser").waitFor({ timeout: 15000 }).catch(() => {})
  ok('no WebGL2: "Map isn\'t available in this browser", no Retry, nothing asked outside', await page.getByText("Map isn't available in this browser").isVisible() && await page.getByRole('button', { name: 'Retry' }).count() === 0 && outside.length === 0, `${outside.length} outside`)
  await browser.close()
}
const failed = results.filter(x => !x).length
console.log(`${results.length - failed}/${results.length} passed`)
process.exit(failed ? 1 : 0)
