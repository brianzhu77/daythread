// Dashboard step 1 in the built app at 1280 (dashboard.md, dashboard-edit.md; D13 G6-1, G6-2, G6-4).
// Usage: node tests/evidence/dashboard/dashboard.mjs <base-url> [chromium|webkit]
//   The server at <base-url> runs on a store fresh from seed.ts: seed it and start the server again before each engine, as each changes it.
import * as pw from '@playwright/test'
const [base, only] = process.argv.slice(2), results = []
if (!base) { console.error('Usage: node tests/evidence/dashboard/dashboard.mjs <base-url> [chromium|webkit]'); process.exit(2) }
const ok = (name, pass, detail = '') => { results.push(pass); console.log(`${pass ? 'PASS' : 'FAIL'} ${name}${detail ? ` · ${detail}` : ''}`) }
const wait = ms => new Promise(r => setTimeout(r, ms))
for (const engine of only ? [only] : ['chromium', 'webkit']) {
  const browser = await pw[engine].launch()
  const page = await (await browser.newContext({ viewport: { width: 1280, height: 900 }, serviceWorkers: 'block' })).newPage()
  const errors = []; page.on('pageerror', e => errors.push(e.message))
  const settle = async () => { await page.waitForLoadState('networkidle').catch(() => {}); await wait(250) }
  const layout = () => page.evaluate(() => [...document.querySelectorAll('.dashboard-row')].filter(r => r.dataset.row).map(r => [...r.querySelectorAll(':scope > .dashboard-widget')].map(w => `${w.getAttribute('aria-label')}:${Math.round(w.getBoundingClientRect().width)}`).join(',')).join(' | '))
  const names = () => page.evaluate(() => [...document.querySelectorAll('.dashboard-row')].filter(r => r.dataset.row).map(r => [...r.querySelectorAll(':scope > .dashboard-widget')].map(w => w.getAttribute('aria-label')).join(',')).join(' | '))
  const rects = () => page.evaluate(() => [...document.querySelectorAll('.dashboard-widget')].map(w => { const r = w.getBoundingClientRect(); return [r.left, r.top, r.width, r.height].map(Math.round).join(',') }).join(';'))
  const menu = async (widget, item) => { await page.locator(`.dashboard-widget[aria-label="${widget}"] .dashboard-widget-more`).click(); await page.getByRole('menuitem', { name: item, exact: true }).click(); await settle() }
  const tag = engine
  await page.goto(`${base}/pages?page=home`); await page.locator('.dashboard-widget').first().waitFor({ timeout: 20000 }); await settle()

  // Read mode: each widget is its linked view, with its rows, and its content works.
  ok(`${tag} read: two widgets side by side with their rows`, (await names()) === 'Runs,Books' && await page.getByText('Alpha', { exact: true }).isVisible() && await page.getByText('Dune', { exact: true }).isVisible(), await names())
  await page.locator('.dashboard-widget[aria-label="Runs"] [data-cell*="|r1|st"]').click()
  ok(`${tag} read: a cell opens its editor`, await page.locator('[role=dialog], .property-popover, [data-floating-ui-portal], .property-editor').count() > 0 || await page.locator('.app-menu, [role=listbox]').count() > 0)
  await page.keyboard.press('Escape'); await settle()

  // Edit mode moves nothing, and its content takes nothing.
  const before = await rects()
  await page.getByRole('button', { name: 'Edit' }).click(); await settle()
  ok(`${tag} edit: entering moves no widget`, (await rects()) === before, `${before} → ${await rects()}`)
  ok(`${tag} edit: content is inert`, await page.evaluate(() => [...document.querySelectorAll('.dashboard-widget-body')].every(b => b.inert)))
  await page.locator('.dashboard-widget[aria-label="Runs"] [data-cell*="|r1|st"]').click({ force: true }).catch(() => {})
  ok(`${tag} edit: a click in a widget opens nothing`, await page.locator('.property-editor, [role=listbox]').count() === 0)

  // The menu: Duplicate, the swaps, its own row, the row above, Remove with Undo.
  await menu('Runs', 'Duplicate')
  ok(`${tag} menu: Duplicate goes right after it, the row split in three`, (await names()) === 'Runs,Runs,Books', await layout())
  await page.locator('.dashboard-widget[aria-label="Runs"]').nth(1).locator('.dashboard-widget-more').click(); await page.getByRole('menuitem', { name: 'Remove' }).click(); await settle()
  ok(`${tag} menu: Remove says "View removed"`, await page.getByText('View removed').first().isVisible())
  await page.getByRole('button', { name: 'Undo' }).first().click(); await settle()
  ok(`${tag} menu: Undo brings it back`, (await names()) === 'Runs,Runs,Books', await names())
  await page.locator('.dashboard-widget[aria-label="Runs"]').nth(1).locator('.dashboard-widget-more').click(); await page.getByRole('menuitem', { name: 'Remove' }).click(); await settle()
  await menu('Runs', 'Move right')
  ok(`${tag} menu: Move right swaps with its neighbour`, (await names()) === 'Books,Runs', await names())
  await menu('Runs', 'Move to its own row')
  ok(`${tag} menu: Move to its own row puts it full width under its row`, (await names()) === 'Books | Runs', await layout())
  await menu('Runs', 'Join the row above')
  ok(`${tag} menu: Join the row above puts it at that row's end, re-divided`, (await names()) === 'Books,Runs', await layout())

  // Dragging (the Lift Rule): within a row, and to a new row; a drop back in place sends nothing.
  const box = async name => page.locator(`.dashboard-widget[aria-label="${name}"]`).first().boundingBox()
  const dragTo = async (name, x, y) => { const b = await box(name); await page.mouse.move(b.x + b.width / 2, b.y + 40); await page.mouse.down(); await page.mouse.move(b.x + b.width / 2 + 10, b.y + 50, { steps: 3 }); await page.mouse.move(x, y, { steps: 8 }); await wait(150); await page.mouse.up(); await settle(); await wait(400) }
  const books = await box('Books')
  await dragTo('Runs', books.x + 20, books.y + 60)
  ok(`${tag} drag: before its neighbour in its own row`, (await names()) === 'Runs,Books', await layout())
  const runsBox = await box('Runs')
  await dragTo('Runs', runsBox.x + runsBox.width / 2 + 5, runsBox.y + 60)
  ok(`${tag} drag: let go where it was, nothing changes`, (await names()) === 'Runs,Books', await names())
  const last = await box('Books')
  await dragTo('Books', last.x + 40, last.y + last.height + 60)
  ok(`${tag} drag: below the last row makes a new row`, (await names()) === 'Runs | Books', await layout())
  await dragTo('Books', (await box('Runs')).x + (await box('Runs')).width - 10, (await box('Runs')).y + 60)
  ok(`${tag} drag: into a row with room joins it, re-divided`, (await names()) === 'Runs,Books', await layout())

  // The width handle between neighbours snaps to allowed splits; the height handle in 40 px steps.
  const split = page.locator('.dashboard-split').first(), sb = await split.boundingBox(), row = await page.locator('.dashboard-row[data-row]').first().boundingBox()
  await page.mouse.move(sb.x + sb.width / 2, sb.y + 40); await page.mouse.down(); await page.mouse.move(row.x + row.width * 0.36, sb.y + 40, { steps: 6 })
  const badge = await page.locator('.dashboard-badge').innerText().catch(() => '')
  await page.mouse.up(); await settle()
  const [rw, bw] = [(await box('Runs')).width, (await box('Books')).width]
  ok(`${tag} handle: width snaps to 1/3 · 2/3, with its badge`, badge === '1/3 · 2/3' && Math.abs(rw / (rw + bw) - 1 / 3) < 0.04, `${badge} ${Math.round(rw)}:${Math.round(bw)}`)
  const sizer = page.locator('.dashboard-row-size').first(), zb = await sizer.boundingBox(), h0 = (await box('Runs')).height
  await page.mouse.move(zb.x + zb.width / 2, zb.y + zb.height / 2); await page.mouse.down(); await page.mouse.move(zb.x + zb.width / 2, zb.y + 85, { steps: 6 })
  const hb = await page.locator('.dashboard-badge').innerText().catch(() => '')
  await page.mouse.up(); await settle()
  ok(`${tag} handle: height in 40 px steps, with its badge`, Math.round((await box('Runs')).height - h0) === 80 && hb === `${h0 + 80} px`, `${hb} ${h0} → ${(await box('Runs')).height}`)

  // + Add widget: a database and its first view, as a full-width row at the end.
  await page.getByRole('button', { name: '+ Add widget' }).click(); await page.getByRole('menuitem', { name: 'To-dos' }).click(); await settle()
  ok(`${tag} add: To-dos as a row of its own at the end`, (await names()) === 'Runs,Books | To-dos', await names())

  // Esc leaves edit mode; Done does too.
  await page.locator('body').click({ position: { x: 5, y: 5 } }); await page.keyboard.press('Escape'); await settle()
  ok(`${tag} Esc leaves edit mode`, await page.getByRole('button', { name: 'Edit' }).isVisible())

  // Add view → Dashboard on an existing database: one widget, a copy of its first view.
  await page.goto(`${base}/pages?page=books`); await page.locator('[data-database-views]').first().waitFor(); await settle()
  await page.locator('[data-database-views]').first().click()
  await page.getByRole('menuitem', { name: '+ Add view' }).click().catch(() => page.getByText('+ Add view').click())
  await page.getByRole('menuitem', { name: 'Dashboard' }).click(); await settle()
  ok(`${tag} Add view → Dashboard opens with one widget of this database`, await page.locator('.dashboard-widget').count() === 1 && await page.getByText('Dune', { exact: true }).isVisible())
  ok(`${tag} no page errors`, errors.length === 0, errors.join(' | ').slice(0, 300))
  if (process.env.SHOTS) { await page.goto(`${base}/pages?page=home`); await page.locator('.dashboard-widget').first().waitFor(); await page.getByRole('button', { name: 'Edit' }).click(); await settle(); await page.screenshot({ path: `${process.env.SHOTS}/${engine}-edit.png` }) }
  await browser.close()
}
console.log(`${results.filter(Boolean).length}/${results.length} passed`)
process.exit(results.every(Boolean) ? 0 : 1)
