// Dashboard step 2 in the built app (dashboard-edit.md §7, Jazz 352627d8; D13 G6-3, G6-5, and G6-7's late loading).
// Usage: node tests/evidence/dashboard/phone.mjs <base-url> [chromium|webkit]  (the server on a store fresh from seed.ts; reseed per engine)
import * as pw from '@playwright/test'
const [base, only] = process.argv.slice(2), results = []
if (!base) { console.error('Usage: node tests/evidence/dashboard/phone.mjs <base-url> [chromium|webkit]'); process.exit(2) }
const ok = (name, pass, detail = '') => { results.push(pass); console.log(`${pass ? 'PASS' : 'FAIL'} ${name}${detail ? ` · ${detail}` : ''}`) }
const wait = ms => new Promise(r => setTimeout(r, ms))
const R = 'Runs · Table', B = 'Books · Table', T = 'To-dos · Open', R2 = 'Runs · By stage'
for (const engine of only ? [only] : ['chromium', 'webkit']) {
  const browser = await pw[engine].launch()
  const phone = await browser.newContext({ viewport: { width: 390, height: 800 }, hasTouch: true, ...(engine === 'chromium' ? { isMobile: true } : {}), serviceWorkers: 'block' })
  const page = await phone.newPage(), errors = []
  page.on('pageerror', e => errors.push(e.message))
  const tag = `${engine} 390`
  const settle = async (p = page) => { await p.waitForLoadState('networkidle').catch(() => {}); await wait(300) }
  const order = (p = page) => p.evaluate(() => [...document.querySelectorAll('.dashboard-widget')].map(w => w.getAttribute('aria-label')).join(','))
  const widget = (name, p = page) => p.locator(`.dashboard-widget[aria-label="${name}"]`).first()
  await page.goto(`${base}/pages?page=home`); await page.locator('.dashboard-widget').first().waitFor({ timeout: 20000 }); await settle()

  // Full width, one above another, in reading order; stored widths ignored.
  const geo = await page.evaluate(() => [...document.querySelectorAll('.dashboard-widget')].map(w => { const r = w.getBoundingClientRect(); return [Math.round(r.left), Math.round(r.width)] }))
  ok(`${tag} full width, in reading order`, (await order()) === [R, B, T, R2].join(',') && geo.every(([l, w]) => l === geo[0][0] && w === geo[0][1] && w >= 340), `${await order()} ${JSON.stringify(geo)}`)
  ok(`${tag} the head: name and ⋯ left, Edit right, on one row`, await page.evaluate(() => { const e = document.querySelector('.dashboard-edit').getBoundingClientRect(), n = document.querySelector('.dashboard-head [data-database-views]').getBoundingClientRect(); return Math.abs((e.top + e.bottom) / 2 - (n.top + n.bottom) / 2) < 10 && e.left > n.right }))

  // Late loading: widgets far below hold their place, 360 px at least, until they come near.
  const waiting = await page.evaluate(() => [...document.querySelectorAll('.dashboard-lazy:not([data-loaded])')].map(e => Math.round(e.getBoundingClientRect().height)))
  ok(`${tag} off-screen widgets hold 360 px until they load`, waiting.length > 0 && waiting.every(h => h >= 360), JSON.stringify(waiting))
  await page.mouse.wheel(0, 4000); await wait(600); await page.mouse.wheel(0, 4000); await wait(600)
  ok(`${tag} scrolled to, they load`, await page.locator('.dashboard-lazy:not([data-loaded])').count() === 0)
  await page.evaluate(() => window.scrollTo(0, 0)); await settle()

  // Height follows content up to 360 px, then a fade and Show more; never a scroll down inside.
  const books = widget(B)
  await books.scrollIntoViewIfNeeded(); await wait(300)
  const clipped = await books.evaluate(w => { const c = w.querySelector('.dashboard-clip'); return { h: Math.round(c.getBoundingClientRect().height), clipped: c.classList.contains('is-clipped'), scroll: ['auto', 'scroll'].includes(getComputedStyle(w.querySelector('.dashboard-widget-body')).overflowY) } })
  ok(`${tag} a tall widget stops at 360 px with Show more, and doesn't scroll inside`, clipped.clipped && clipped.h <= 361 && !clipped.scroll && await books.getByRole('button', { name: 'Show more' }).isVisible(), JSON.stringify(clipped))
  await books.getByRole('button', { name: 'Show more' }).click(); await wait(200)
  ok(`${tag} Show more opens it in place, and Show less closes it`, (await books.locator('.dashboard-clip').evaluate(c => c.getBoundingClientRect().height)) > 400 && await books.getByRole('button', { name: 'Show less' }).isVisible())
  ok(`${tag} a short widget is its own height`, (await widget(R).locator('.dashboard-clip').evaluate(c => !c.classList.contains('is-clipped'))) && await widget(R).getByRole('button', { name: 'Show more' }).count() === 0)

  // Edit mode: no handles, no dragging; the menu is Duplicate, Move up, Move down, Remove; a move is a swap, scrolled to and washed.
  await page.locator('.dashboard-edit').click(); await settle()
  ok(`${tag} edit: no handles`, await page.locator('.dashboard-split, .dashboard-row-size').count() === 0)
  await widget(B).locator('.dashboard-widget-more').click()
  const items = await page.locator('.app-menu [role=menuitem]').allInnerTexts()
  ok(`${tag} edit: the menu is Duplicate, Move up, Move down, Remove`, items.join(',') === 'Duplicate,Move up,Move down,Remove', items.join(','))
  await page.getByRole('menuitem', { name: 'Move down' }).click(); await wait(250)
  const washed = await widget(B).evaluate(w => w.classList.contains('is-moved'))
  await settle(); await wait(900)
  const inView = await widget(B).evaluate(w => { const r = w.getBoundingClientRect(); return r.top < innerHeight && r.bottom > 0 })
  ok(`${tag} Move down swaps with the next, scrolls to it and washes it`, (await order()) === [R, T, B, R2].join(',') && washed && inView, await order())
  await page.getByRole('button', { name: 'Undo' }).last().click(); await settle()
  ok(`${tag} the move has one Undo`, (await order()) === [R, B, T, R2].join(','), await order())
  await widget(R).locator('.dashboard-widget-more').click()
  ok(`${tag} edit: the first has no Move up`, (await page.locator('.app-menu [role=menuitem]').allInnerTexts()).join(',') === 'Duplicate,Move down,Remove')
  await page.keyboard.press('Escape')
  // Across rows the swap trades widths, so the 1280 layout keeps every other widget where it was.
  await widget(T).locator('.dashboard-widget-more').click(); await page.getByRole('menuitem', { name: 'Move up' }).click(); await settle()
  const desk = await browser.newContext({ viewport: { width: 1280, height: 900 }, serviceWorkers: 'block' }), wide = await desk.newPage()
  await wide.goto(`${base}/pages?page=home`); await wide.locator('.dashboard-widget').first().waitFor(); await settle(wide)
  const rows = await wide.evaluate(() => [...document.querySelectorAll('.dashboard-row[data-row]')].map(r => [...r.querySelectorAll(':scope > .dashboard-widget')].map(w => w.getAttribute('aria-label')).join(',')).join(' | '))
  ok(`${tag} a move at 390 is a swap at 1280 too, nothing else moved`, rows === `${R},${T} | ${B},${R2}`, rows)
  // Show more stays open for the session: away to another page and back, still open (Jazz 352627d8).
  await page.keyboard.press('Escape'); await page.locator('.dashboard-edit').click(); await settle()
  await page.goto(`${base}/pages?page=home`); await page.locator('.dashboard-widget').first().waitFor(); await settle()
  await widget(B).scrollIntoViewIfNeeded(); await wait(300)
  if (await widget(B).getByRole('button', { name: 'Show more' }).count()) await widget(B).getByRole('button', { name: 'Show more' }).click()
  await page.getByRole('link', { name: 'Pages' }).first().click().catch(() => page.locator('a[href*="/pages"]').first().click()); await settle()
  await page.goBack(); await page.locator('.dashboard-widget').first().waitFor(); await settle()
  await widget(B).scrollIntoViewIfNeeded(); await wait(300)
  ok(`${tag} Show more stays open after leaving and coming back`, await widget(B).getByRole('button', { name: 'Show less' }).isVisible())
  // A long name ends in "…" before Edit; a wide table scrolls sideways inside its widget.
  await page.goto(`${base}/pages?page=wall`); await page.locator('.dashboard-widget').first().waitFor(); await settle()
  const head = await page.evaluate(() => { const l = document.querySelector('.dashboard-head .database-view-label'), e = document.querySelector('.dashboard-edit'); return { cut: l.scrollWidth > l.clientWidth, ellipsis: getComputedStyle(l).textOverflow, clear: l.getBoundingClientRect().right <= e.getBoundingClientRect().left } })
  ok(`${tag} a long name ends in … before Edit`, head.cut && head.ellipsis === 'ellipsis' && head.clear, JSON.stringify(head))
  const wideW = page.locator('.dashboard-widget[aria-label^="Wide"]')
  await wideW.scrollIntoViewIfNeeded(); await wait(500)
  const sideways = await wideW.evaluate(w => { const s = w.querySelector('.database-scroll'); if (!s) return null; const before = s.scrollLeft; s.scrollLeft = 200; return { over: s.scrollWidth > s.clientWidth, moved: s.scrollLeft > before } })
  ok(`${tag} a wide table scrolls sideways inside its widget`, Boolean(sideways?.over && sideways?.moved), JSON.stringify(sideways))
  ok(`${tag} no page errors`, errors.length === 0, errors.join(' | ').slice(0, 300))

  // ---- G6-5, two tabs at 1280: a move in one and a filter edit in the other, from a tab that hadn't seen the move, both survive.
  const other = await desk.newPage(); other.on('pageerror', e => errors.push(e.message))
  await other.goto(`${base}/pages?page=home`); await other.locator('.dashboard-widget').first().waitFor(); await settle(other)
  await wide.locator('.dashboard-edit').click(); await settle(wide)
  await widget(T, wide).locator('.dashboard-widget-more').click(); await wide.getByRole('menuitem', { name: 'Move left' }).click(); await settle(wide)
  // The other tab still shows the dashboard from before the move, and removes the To-dos widget's filter chip.
  const sent = []
  const count = r => { if (r.request().method() === 'POST' && r.url().includes('_serverFn')) sent.push(r.status()) }
  other.on('response', count)
  const staleRevision = await other.evaluate(() => document.querySelectorAll('.dashboard-row[data-row]')[0]?.querySelector('.dashboard-widget')?.getAttribute('aria-label'))
  await widget(T, other).locator('.database-rule-remove, button[aria-label^="Remove"]').first().click(); await settle(other); await wait(600)
  other.off('response', count)
  ok(`two tabs (${engine}): the other tab hadn't seen the move, was refused and sent again`, staleRevision !== T && sent.length >= 2, `it showed ${staleRevision} first; ${sent.length} requests`)
  for (const p of [wide, other]) { await p.reload(); await p.locator('.dashboard-widget').first().waitFor(); await settle(p) }
  const both = await wide.evaluate(() => [...document.querySelectorAll('.dashboard-row[data-row]')][0]?.querySelector('.dashboard-widget')?.getAttribute('aria-label'))
  ok(`two tabs (${engine}): the move survives`, both === T, both)
  ok(`two tabs (${engine}): the filter edit survives`, await widget(T, wide).getByText('Status is Open').count() === 0)
  // Undo refuses a change that isn't the newest any more.
  await wide.locator('.dashboard-edit').click(); await settle(wide)
  await widget(T, wide).locator('.dashboard-widget-more').click(); await wide.getByRole('menuitem', { name: 'Move right' }).click(); await settle(wide)
  await other.locator('.dashboard-edit').click(); await settle(other)
  await widget(B, other).locator('.dashboard-widget-more').click(); await other.getByRole('menuitem', { name: 'Move right' }).click(); await settle(other)
  await wide.getByRole('button', { name: 'Undo' }).last().click(); await settle(wide)
  ok(`two tabs (${engine}): Undo refuses a widget change that's no longer the newest`, await wide.getByText("Can't undo · edited since").first().isVisible().catch(() => false))
  // Refused twice: the other tab, behind, moves a widget this tab has just removed; it says so and draws the dashboard as it is.
  await widget(R2, wide).locator('.dashboard-widget-more').click(); await wide.getByRole('menuitem', { name: 'Remove' }).click(); await settle(wide)
  await widget(R2, other).locator('.dashboard-widget-more').click(); await other.getByRole('menuitem', { name: /Move (left|right)/ }).first().click(); await settle(other); await wait(500)
  ok(`two tabs (${engine}): refused again, it says so and shows the dashboard as it is now`, await other.getByText('Changed in another tab, so nothing was changed').first().isVisible().catch(() => false) && await widget(R2, other).count() === 0)
  await desk.close()
  await browser.close()
}
console.log(`${results.filter(Boolean).length}/${results.length} passed`)
process.exit(results.every(Boolean) ? 0 : 1)
