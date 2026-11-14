// A table's sideways edges come from classes, not a scroll timeline (Lead b43f8f97): the clipped edge fades only while
// there's more to the right, pinned Name's hairline shows only once scrolled, and both follow a widget dragged narrower.
// Usage: node tests/evidence/databases/table-edges.mjs <base-url> [chromium|webkit]
//   The server at <base-url> runs on a store fresh from tests/evidence/dashboard/seed.ts; reseed and restart before each engine.
import * as pw from '@playwright/test'
const [base, only] = process.argv.slice(2), results = []
if (!base) { console.error('Usage: node tests/evidence/databases/table-edges.mjs <base-url> [chromium|webkit]'); process.exit(2) }
const ok = (name, pass, detail = '') => { results.push(pass); console.log(`${pass ? 'PASS' : 'FAIL'} ${name}${detail ? ` · ${detail}` : ''}`) }
const wait = ms => new Promise(r => setTimeout(r, ms))
for (const engine of only ? [only] : ['chromium', 'webkit']) {
  const browser = await pw[engine].launch()
  const page = await (await browser.newContext({ viewport: { width: 1280, height: 900 }, serviceWorkers: 'block' })).newPage()
  const errors = []; page.on('pageerror', e => errors.push(e.message))
  const tag = engine
  const settle = async () => { await page.waitForLoadState('networkidle').catch(() => {}); await wait(300) }
  const open = async id => { await page.goto(`${base}/pages?page=${id}`); await page.locator('.database-scroll').first().waitFor({ timeout: 20000 }); await settle() }
  // What the scroller shows: its classes, whether its mask paints, and the hairline's opacity on a Name cell.
  const edges = (within = '') => page.evaluate(sel => {
    const el = document.querySelector(`${sel} .database-scroll`.trim())
    const cs = getComputedStyle(el), mask = cs.maskImage || cs.webkitMaskImage || 'none'
    const cell = el.querySelector('.database-td.is-title') ?? el.querySelector('.database-th.is-title')
    return { more: el.classList.contains('has-more-right'), scrolled: el.classList.contains('is-scrolled'), mask: mask !== 'none', line: Number(getComputedStyle(cell, '::after').opacity), left: Math.round(el.scrollLeft), room: el.scrollWidth - el.clientWidth }
  }, within)
  const show = e => `more=${e.more} mask=${e.mask} scrolled=${e.scrolled} line=${e.line} left=${e.left}/${e.room}`
  const scrollTo = async x => { await page.evaluate(x => { const el = document.querySelector('.database-scroll'); el.scrollLeft = x === 'end' ? el.scrollWidth : x }, x); await wait(150) }

  // ---- A table wider than the page: Wide's eight columns.
  await open('wide')
  let e = await edges()
  ok(`${tag} at its start: the fade on the right, no hairline`, e.room > 0 && e.more && e.mask && !e.scrolled && e.line === 0, show(e))
  await scrollTo(40); e = await edges()
  ok(`${tag} scrolled a little: the fade stays, the hairline shows`, e.more && e.mask && e.scrolled && e.line === 1, show(e))
  await scrollTo('end'); e = await edges()
  ok(`${tag} at the far end: no fade, the hairline stays`, !e.more && !e.mask && e.scrolled && e.line === 1, show(e))
  await scrollTo(0); e = await edges()
  ok(`${tag} back at the start: the fade again, no hairline`, e.more && e.mask && !e.scrolled && e.line === 0, show(e))
  // ---- A table that fits: Runs on its own page has nothing clipped, until the window alone makes it narrower.
  await open('runs'); e = await edges()
  ok(`${tag} a table that fits: no fade and no hairline`, e.room <= 1 && !e.more && !e.mask && !e.scrolled && e.line === 0, show(e))
  // A narrower window alone, with no scroll: Runs' widget on the dashboard clips somewhere below 1280, and each step agrees.
  await open('home')
  const R = '.dashboard-widget[aria-label="Runs · Table"]', steps = []
  for (const width of [1100, 1000, 900, 800, 1280]) {
    await page.setViewportSize({ width, height: 900 }); await wait(400)
    const at = await edges(R); steps.push({ width, ...at })
  }
  ok(`${tag} the window narrower and wider: the fade comes exactly while it clips, with no scroll`, steps.some(x => x.room > 1) && steps.every(x => x.more === x.room > 1 && x.mask === x.more && !x.scrolled) && steps.at(-1).room <= 1, steps.map(x => `${x.width}:${x.left}/${x.room}${x.more ? '+fade' : ''}`).join(' '))

  // ---- Bumblebee's case: a widget dragged narrower until its table scrolls gets the fade; widened, it goes.
  await open('home')
  const before = await edges(R)
  await page.getByRole('button', { name: 'Edit' }).click(); await settle()
  const split = await page.locator('.dashboard-split').first().boundingBox(), row = await page.locator('.dashboard-row[data-row]').first().boundingBox()
  await page.mouse.move(split.x + split.width / 2, split.y + 40); await page.mouse.down()
  await page.mouse.move(row.x + row.width * 0.22, split.y + 40, { steps: 6 }); await wait(200)
  const mid = await edges(R)
  await page.mouse.up(); await settle()
  const narrow = await edges(R)
  ok(`${tag} widget dragged to 1/4: its table scrolls and fades, already mid-drag`, !before.more && mid.more && narrow.room > 1 && narrow.more && narrow.mask, `before ${show(before)} · mid ${show(mid)} · after ${show(narrow)}`)
  await page.getByRole('button', { name: 'Undo' }).last().click(); await settle()
  const wide = await edges(R)
  ok(`${tag} widened again: the fade goes`, wide.room <= 1 && !wide.more && !wide.mask, show(wide))

  ok(`${tag} no page errors`, errors.length === 0, errors.join(' | '))
  await browser.close()
}
const failed = results.filter(r => !r).length
console.log(`\n${results.length - failed}/${results.length} passed`)
process.exit(failed ? 1 : 0)
