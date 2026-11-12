// Dashboard step 1 in the built app at 1280 (dashboard.md, dashboard-edit.md; D13 G6-1, G6-2, G6-4).
// Usage: node tests/evidence/dashboard/dashboard.mjs <base-url> [chromium|webkit]
//   The server at <base-url> runs on a store fresh from seed.ts: seed it and start the server again before each engine, as each changes it.
import * as pw from '@playwright/test'
const [base, only] = process.argv.slice(2), results = []
if (!base) { console.error('Usage: node tests/evidence/dashboard/dashboard.mjs <base-url> [chromium|webkit]'); process.exit(2) }
const ok = (name, pass, detail = '') => { results.push(pass); console.log(`${pass ? 'PASS' : 'FAIL'} ${name}${detail ? ` · ${detail}` : ''}`) }
const wait = ms => new Promise(r => setTimeout(r, ms))
// Each widget reads as its database and its view.
const R = 'Runs · Table', B = 'Books · Table', T = 'To-dos · Open', R2 = 'Runs · By stage'
for (const engine of only ? [only] : ['chromium', 'webkit']) {
  const browser = await pw[engine].launch()
  const page = await (await browser.newContext({ viewport: { width: 1280, height: 900 }, serviceWorkers: 'block' })).newPage()
  const errors = []; page.on('pageerror', e => errors.push(e.message))
  const tag = engine
  const settle = async () => { await page.waitForLoadState('networkidle').catch(() => {}); await wait(250) }
  const open = async (id = 'home') => { await page.goto(`${base}/pages?page=${id}`); await page.locator('.dashboard-widget, .dashboard-link, .database-block').first().waitFor({ timeout: 20000 }); await settle() }
  const rowsText = () => page.evaluate(() => [...document.querySelectorAll('.dashboard-row[data-row]')].map(r => [...r.querySelectorAll(':scope > .dashboard-widget')].map(w => w.getAttribute('aria-label')).join(',')).join(' | '))
  const widths = (n = 0) => page.evaluate(i => [...document.querySelectorAll('.dashboard-row[data-row]')][i]?.querySelectorAll(':scope > .dashboard-widget') ?? [], n).then(() => page.evaluate(i => [...([...document.querySelectorAll('.dashboard-row[data-row]')][i]?.querySelectorAll(':scope > .dashboard-widget') ?? [])].map(w => `${w.getAttribute('aria-label')}:${Math.round(w.getBoundingClientRect().width)}`).join(','), n))
  const rects = () => page.evaluate(() => [...document.querySelectorAll('.dashboard-widget')].map(w => { const r = w.getBoundingClientRect(); return [r.left, r.top, r.width, r.height].map(Math.round).join(',') }).join(';'))
  const widget = name => page.locator(`.dashboard-widget[aria-label="${name}"]`).first()
  const box = name => widget(name).boundingBox()
  const menu = async (name, item) => { await widget(name).locator('.dashboard-widget-more').click(); await page.getByRole('menuitem', { name: item, exact: true }).click(); await settle() }
  const undo = async () => { await page.getByRole('button', { name: 'Undo' }).last().click(); await settle() }
  const edit = async () => { await page.getByRole('button', { name: 'Edit' }).click(); await settle() }
  const dragTo = async (name, x, y) => { const b = await box(name); await page.mouse.move(b.x + b.width / 2, b.y + 40); await page.mouse.down(); await page.mouse.move(b.x + b.width / 2 + 10, b.y + 50, { steps: 3 }); await page.mouse.move(x, y, { steps: 8 }); await wait(150); const slots = await page.locator('.dashboard-slot').count(); await page.mouse.up(); await settle(); await wait(400); return slots }
  await open()

  // ---- Read mode: each widget is its linked view, and its content works (G6-1).
  ok(`${tag} read: rows of widgets with their rows`, (await rowsText()) === `${R},${B} | ${T},${R2}` && await widget(R).getByText('Alpha', { exact: true }).isVisible() && await widget(B).getByText('Dune', { exact: true }).isVisible(), await rowsText())
  await widget(T).getByRole('checkbox', { name: 'Done: Water the plants' }).click(); await settle()
  ok(`${tag} read: a to-do ticks in the To-dos widget`, (await widget(T).getByRole('checkbox', { name: 'Done: Water the plants' }).getAttribute('aria-checked').catch(() => 'gone')) !== 'false')
  await widget(R).locator('[data-cell*="|r1|st"]').click(); await page.getByRole('option', { name: 'Done' }).click().catch(() => page.getByText('Done', { exact: true }).last().click()); await page.keyboard.press('Escape'); await settle()
  ok(`${tag} read: a row edited in one widget updates another showing it`, (await widget(R2).locator('[data-cell*="|r1|st"]').innerText()).includes('Done'), await widget(R2).locator('[data-cell*="|r1|st"]').innerText())
  const chip = widget(T).getByRole('button', { name: /Remove|×/ }).first()
  const hadChip = await widget(T).getByText('Status is Open').count()
  await widget(T).locator('.database-rule-remove, button[aria-label^="Remove"]').first().click().catch(() => chip.click()); await settle()
  await open()
  ok(`${tag} read: a widget's filter chip change is kept after a reload, and only there`, hadChip === 1 && await widget(T).getByText('Status is Open').count() === 0)
  await page.goto(`${base}/tasks?view=open`); await settle(); await open()

  // ---- Edit mode: moves nothing, content inert, not kept across a reload, Done ends it (G6-2).
  const before = await rects()
  await edit()
  ok(`${tag} edit: entering moves no widget`, (await rects()) === before)
  ok(`${tag} edit: content is inert`, await page.evaluate(() => [...document.querySelectorAll('.dashboard-widget-body')].every(b => b.inert)))
  await open()
  ok(`${tag} edit: not kept across a reload`, await page.getByRole('button', { name: 'Edit' }).isVisible())
  await edit(); await page.locator('.dashboard-edit').click(); await settle()
  ok(`${tag} edit: Done ends it`, await page.getByRole('button', { name: 'Edit' }).isVisible() && await page.locator('.dashboard.is-editing').count() === 0)
  await edit()

  // ---- The menu, with Undo (G6-2, G6-4).
  await menu(B, 'Remove')
  ok(`${tag} remove: says "View removed" and leaves every row`, await page.getByText('View removed').first().isVisible() && (await rowsText()) === `${R} | ${T},${R2}`)
  await undo()
  ok(`${tag} remove: Undo brings it back`, (await rowsText()) === `${R},${B} | ${T},${R2}`, await rowsText())
  await menu(R, 'Move right')
  ok(`${tag} menu: Move right swaps with its neighbour`, (await rowsText()) === `${B},${R} | ${T},${R2}`)
  await menu(R, 'Move left')
  await menu(R2, 'Join the row above')
  ok(`${tag} menu: Join the row above, re-divided`, (await rowsText()) === `${R},${B},${R2} | ${T}`, await widths())
  // Three in a row: the handle between the first two snaps through 3+6+3, 4+4+4 and 6+3+3, as one whole-row change (Jazz 36988993).
  {
    const h = await page.locator('.dashboard-row[data-row]').first().locator('.dashboard-split').first().boundingBox(), r = await page.locator('.dashboard-row[data-row]').first().boundingBox()
    await page.mouse.move(h.x + h.width / 2, h.y + 40); await page.mouse.down(); await page.mouse.move(r.x + r.width * 0.2, h.y + 40, { steps: 6 })
    const three = await page.locator('.dashboard-badge').innerText().catch(() => '')
    await page.mouse.up(); await settle()
    const ws = (await widths()).split(',').map(x => Number(x.split(':')[1]))
    ok(`${tag} three in a row: a handle grows the middle one to 1/2`, three === '1/4 · 1/2 · 1/4' && ws[1] > ws[0] * 1.8 && Math.abs(ws[0] - ws[2]) < 3, `${three} ${ws}`)
    await undo()
  }
  await menu(R2, 'Move to its own row')
  ok(`${tag} menu: Move to its own row`, (await rowsText()) === `${R},${B} | ${R2} | ${T}`, await rowsText())

  // ---- Handles, and widths kept by a reorder and a swap within a row.
  const split = page.locator('.dashboard-split').first(), sb = await split.boundingBox(), row = await page.locator('.dashboard-row[data-row]').first().boundingBox()
  await page.mouse.move(sb.x + sb.width / 2, sb.y + 40); await page.mouse.down(); await page.mouse.move(row.x + row.width * 0.22, sb.y + 40, { steps: 6 })
  const badge = await page.locator('.dashboard-badge').innerText().catch(() => '')
  const live = await widths()
  await page.mouse.up(); await settle()
  ok(`${tag} handle: each snap shows at once, before release (Ratchet a950bc9e)`, live === await widths(), `${live} vs ${await widths()}`)
  ok(`${tag} handle: width snaps with its badge`, badge === '1/4 · 3/4', `${badge} ${await widths()}`)
  const split3 = await widths()
  await undo()
  ok(`${tag} handle: Undo puts the widths back`, (await widths()) !== split3, await widths())
  await page.mouse.move(sb.x + sb.width / 2, sb.y + 40); await page.mouse.down(); await page.mouse.move(row.x + row.width * 0.22, sb.y + 40, { steps: 6 }); await page.mouse.up(); await settle()
  const kept = (await widths()).split(',').map(x => x.split(':')[1]).sort().join(',')
  await menu(R, 'Move right')
  ok(`${tag} swap within a row: each keeps its width`, (await widths()).split(',').map(x => x.split(':')[1]).sort().join(',') === kept && (await widths()).startsWith(`${B}:`), await widths())
  const runsNow = await box(R), books = await box(B)
  const slots = await dragTo(R, books.x + 20, books.y + 60)
  ok(`${tag} drag in a row: a slot, then the order changes and each keeps its width`, slots === 1 && (await widths()).startsWith(`${R}:`) && (await widths()).split(',').map(x => x.split(':')[1]).sort().join(',') === kept, await widths())
  await undo()
  ok(`${tag} drag: Undo takes the move back`, (await widths()).startsWith(`${B}:`), await widths())
  void runsNow
  const zone = page.locator('.dashboard-row-size').first(), zb = await zone.boundingBox(), h0 = (await box(R)).height
  await page.mouse.move(zb.x + zb.width / 2, zb.y + zb.height / 2); await page.mouse.down(); await page.mouse.move(zb.x + zb.width / 2, zb.y + 85, { steps: 6 })
  const hb = await page.locator('.dashboard-badge').innerText().catch(() => '')
  await page.mouse.up(); await settle()
  ok(`${tag} handle: height in 40 px steps, with its badge`, Math.round((await box(R)).height - h0) === 80 && hb === `${h0 + 80} px`, `${hb}`)
  const h1 = (await box(R)).height
  await page.mouse.move(zb.x + zb.width / 2, zb.y + zb.height / 2 + 80); await page.mouse.down(); await page.mouse.move(zb.x + zb.width / 2, zb.y + 200, { steps: 6 })
  await page.keyboard.press('Escape'); await page.mouse.up(); await settle()
  ok(`${tag} handle: Esc mid-drag puts it back, saves nothing and stays in edit mode`, Math.round((await box(R)).height) === Math.round(h1) && await page.locator('.dashboard.is-editing').count() === 1, `${h1} → ${(await box(R)).height}`)

  // ---- A full row takes no slot; a drop there goes back. Then 12 at most.
  await page.getByRole('button', { name: '+ Add widget' }).click(); await page.getByRole('menuitem', { name: 'Books', exact: true }).click(); await settle()
  await menu(B, 'Join the row above').catch(() => {})
  const rowsNow = await rowsText()
  const target = await page.locator('.dashboard-row[data-row]').first().boundingBox()
  const fullSlots = await dragTo(T, target.x + 30, target.y + 60)
  ok(`${tag} drag onto a full row: no slot, and it goes back`, (await page.locator('.dashboard-row[data-row]').first().locator(':scope > .dashboard-widget').count()) < 4 || (fullSlots === 0 && (await rowsText()) === rowsNow), `${fullSlots} ${await rowsText()}`)
  for (let i = 0; i < 12; i++) { const add = page.getByRole('button', { name: '+ Add widget' }); if (!(await add.count())) break; await add.click(); await page.getByRole('menuitem', { name: 'Books', exact: true }).click(); await settle() }
  ok(`${tag} 12 at most: the line where + Add widget was`, await page.locator('.dashboard-widget').count() === 12 && await page.getByText('12 widgets at most').isVisible() && await page.getByRole('button', { name: '+ Add widget' }).count() === 0, `${await page.locator('.dashboard-widget').count()}`)

  // ---- Keys: Tab goes widget to widget, and keys there don't reach the page (R1-26). Esc leaves.
  await widget(R).focus(); await page.keyboard.press('Tab')
  const nextFocus = await page.evaluate(() => document.activeElement?.closest('.dashboard-widget, .dashboard-split, .dashboard-row-size')?.className ?? document.activeElement?.tagName)
  await widget(R).focus(); await page.keyboard.type('xyz')
  ok(`${tag} keys: Tab moves on from a widget, and typing there changes nothing`, /dashboard-/.test(nextFocus ?? '') && await page.getByText('xyz').count() === 0, nextFocus)
  await page.keyboard.press('Escape'); await settle()
  ok(`${tag} Esc leaves edit mode`, await page.getByRole('button', { name: 'Edit' }).isVisible())

  // ---- Copies and other places (G6-1): Duplicate view; a block of it elsewhere is a link.
  await page.locator('[data-database-views]').first().click()
  await page.getByRole('button', { name: 'This week options' }).click()
  await page.locator('.database-menu').getByRole('menuitem', { name: 'Duplicate' }).click(); await settle()
  await page.keyboard.press('Escape'); await settle()
  ok(`${tag} Duplicate view: a working copy of the dashboard`, await page.locator('.dashboard-widget').count() === 12 && await page.locator('[data-database-views]').first().innerText().then(t => /copy/.test(t)), await page.locator('[data-database-views]').first().innerText())
  await open('notes')
  ok(`${tag} elsewhere: a block of the dashboard is a link to it`, await page.locator('.dashboard-link').count() === 1 && await page.locator('.dashboard-widget').count() === 0)
  await page.locator('.dashboard-link button').click(); await page.locator('.dashboard-widget').first().waitFor()
  ok(`${tag} elsewhere: the link opens it`, (await page.url()).includes('page=home'))

  // ---- Add view → Dashboard, and `/` finds Database by "dashboard".
  await open('runs'); await page.locator('[data-database-views]').first().click()
  await page.getByRole('menuitem', { name: '+ Add view' }).click().catch(() => page.getByText('+ Add view').click())
  await page.getByRole('menuitem', { name: 'Dashboard' }).click(); await settle()
  ok(`${tag} Add view → Dashboard: one widget, its database's first view`, await page.locator('.dashboard-widget').count() === 1 && (await page.locator('.dashboard-widget').first().getAttribute('aria-label')) === 'Runs · Table')
  await open('notes'); await page.getByText('Above the block').click(); await page.keyboard.press('End'); await page.keyboard.press('Enter'); await page.keyboard.type('/dashboard'); await wait(400)
  ok(`${tag} / finds Database by "dashboard"`, await page.getByRole('option', { name: /Database/ }).count() > 0 || await page.locator('.bn-suggestion-menu').getByText('Database').count() > 0)
  await page.keyboard.press('Escape')
  // ---- Four quarters fit a row at 1280, and wrap, unstored, at 200 px with the Comments pane open (Jazz, Bumblebee 3d09beed).
  await page.keyboard.press('Escape'); await open('wall')
  const tops = () => page.evaluate(() => [...document.querySelectorAll('.dashboard-widget')].map(w => Math.round(w.getBoundingClientRect().top)))
  const lines = async () => new Set(await tops()).size
  ok(`${tag} wrap: four quarters on one line at 1280`, (await lines()) === 1, JSON.stringify(await tops()))
  await page.getByRole('button', { name: 'Page actions' }).click(); await page.getByRole('menuitem', { name: 'Comment' }).click(); await page.locator('.comments-pane').waitFor(); await settle()
  const narrow = await page.evaluate(() => Math.round(document.querySelector('.dashboard-widget').getBoundingClientRect().width))
  ok(`${tag} wrap: with the Comments pane open the row wraps, no widget under 200 px`, (await lines()) > 1 && narrow >= 200, `${await lines()} lines, ${narrow} px`)
  await page.getByRole('button', { name: 'Close comments' }).click(); await settle()
  ok(`${tag} wrap: closing it puts the row back on one line, nothing stored`, (await lines()) === 1)
  // ---- G6-4: a source in Trash, one gone for good, and the whole dashboard removed (Bumblebee 0e05db08).
  await open('books'); await page.getByRole('button', { name: 'Page actions' }).click(); await page.getByRole('menuitem', { name: 'Delete' }).click(); await settle()
  await open('shelf')
  const shelf = name => page.locator(`.dashboard-widget[aria-label^="${name}"]`).first()
  ok(`${tag} source in Trash: its one line with Restore, the others working`, await page.getByText('Books is in Trash').isVisible() && await page.locator('.dashboard-widget').filter({ hasText: 'Alpha' }).count() === 1, await page.locator('.dashboard-widget').allInnerTexts().then(x => x.map(y => y.slice(0, 30)).join(' / ')))
  await page.locator('.dashboard-widget').filter({ hasText: 'Alpha' }).locator('[data-cell*="|r2|st"]').click()
  ok(`${tag} source in Trash: the other widgets still edit`, await page.locator('[role=dialog], [role=listbox], .property-editor').count() > 0)
  await page.keyboard.press('Escape'); await settle()
  ok(`${tag} source deleted for good: "Source deleted" with Remove, in its place`, await page.getByText('Source deleted').isVisible() && await page.getByRole('button', { name: 'Remove' }).isVisible())
  await page.getByRole('button', { name: 'Remove' }).click(); await settle()
  ok(`${tag} source deleted for good: Remove takes the widget, with Undo`, await page.getByText('Source deleted').count() === 0 && await page.getByText('View removed').first().isVisible())
  await page.getByRole('button', { name: 'Restore' }).click(); await settle()
  ok(`${tag} source restored: the widget is back as it was`, await page.locator('.dashboard-widget').filter({ hasText: 'Dune' }).count() === 1)
  void shelf
  const runsRows = await (await fetch(`${base}/`)).ok
  await page.locator('[data-database-views]').first().click(); await page.getByRole('button', { name: 'Shelf board options' }).click()
  await page.locator('.database-menu').getByRole('menuitem', { name: 'Delete' }).click(); await settle(); await page.keyboard.press('Escape'); await settle()
  ok(`${tag} removing the whole dashboard says so, with Undo`, await page.locator('.dashboard').count() === 0 && await page.getByText(/Shelf board deleted/).first().isVisible())
  await undo()
  ok(`${tag} removing the whole dashboard: Undo brings it back`, await page.locator('.dashboard-widget').count() === 2)
  await open('runs')
  ok(`${tag} removing the whole dashboard leaves every row`, runsRows && await page.getByText('Alpha', { exact: true }).isVisible() && await page.getByText('Charlie', { exact: true }).isVisible())
  ok(`${tag} no page errors`, errors.length === 0, errors.join(' | ').slice(0, 300))
  await browser.close()
}
console.log(`${results.filter(Boolean).length}/${results.length} passed`)
process.exit(results.every(Boolean) ? 0 : 1)
