// Dashboard's leftovers in the built app (dashboard-edit.md §5, §6; D13 G6-1): a row's handles reached by Tab after its
// widgets and drawn in the gaps, the row's `+` in the right gutter, and Pages' `+` → Dashboard.
// Usage: node tests/evidence/dashboard/leftovers.mjs <base-url> [chromium|webkit]
//   The server at <base-url> runs on a store fresh from seed.ts: seed it and start the server again before each engine, as each changes it.
import * as pw from '@playwright/test'
const [base, only] = process.argv.slice(2), results = []
if (!base) { console.error('Usage: node tests/evidence/dashboard/leftovers.mjs <base-url> [chromium|webkit]'); process.exit(2) }
const ok = (name, pass, detail = '') => { results.push(pass); console.log(`${pass ? 'PASS' : 'FAIL'} ${name}${detail ? ` · ${detail}` : ''}`) }
const wait = ms => new Promise(r => setTimeout(r, ms))
const R = 'Runs · Table', B = 'Books · Table', T = 'To-dos · Open', R2 = 'Runs · By stage'
for (const engine of only ? [only] : ['chromium', 'webkit']) {
  const browser = await pw[engine].launch()
  const context = await browser.newContext({ viewport: { width: 1280, height: 900 }, serviceWorkers: 'block' })
  const page = await context.newPage()
  const errors = []; page.on('pageerror', e => errors.push(e.message))
  const tag = engine
  const settle = async () => { await page.waitForLoadState('networkidle').catch(() => {}); await wait(250) }
  const open = async (id = 'home') => { await page.goto(`${base}/pages?page=${id}`); await page.locator('.dashboard-widget, .dashboard-link, .database-block').first().waitFor({ timeout: 20000 }); await settle() }
  const edit = async () => { await page.getByRole('button', { name: 'Edit' }).click(); await settle() }
  const undo = async () => { await page.getByRole('button', { name: 'Undo' }).last().click(); await settle() }
  const widget = name => page.locator(`.dashboard-widget[aria-label="${name}"]`).first()
  const rowsText = () => page.evaluate(() => [...document.querySelectorAll('.dashboard-row[data-row]')].map(r => [...r.querySelectorAll(':scope > .dashboard-widget')].map(w => `${w.getAttribute('aria-label')}:${getComputedStyle(w).getPropertyValue('--widget-width').trim()}`).join(',')).join(' | '))
  // Where focus is, by kind: a widget by its name, or a row's control.
  const focused = () => page.evaluate(() => {
    const a = document.activeElement
    if (!a) return 'none'
    if (a.classList.contains('dashboard-widget')) return `widget:${a.getAttribute('aria-label')}`
    if (a.closest('.dashboard-widget-menu')) return 'more'
    if (a.classList.contains('dashboard-split')) return 'split'
    if (a.classList.contains('dashboard-row-size')) return 'height'
    if (a.closest('.dashboard-row-add')) return 'add'
    return a.className || a.tagName
  })
  // Each shown width handle's centre against the middle of the gap it sits in, in px.
  const handleGaps = () => page.evaluate(() => [...document.querySelectorAll('.dashboard-row[data-row]')].flatMap(row => {
    const ws = [...row.querySelectorAll(':scope > .dashboard-widget')]
    return [...row.querySelectorAll(':scope > .dashboard-split')].filter(h => getComputedStyle(h).display !== 'none').map(h => {
      const k = Number(h.dataset.k), a = ws[k - 1].getBoundingClientRect(), b = ws[k].getBoundingClientRect(), r = h.getBoundingClientRect()
      return Math.round(Math.abs((r.left + r.right) / 2 - (a.right + b.left) / 2))
    })
  }))

  // ---- Tab: a row's widgets, then its handles, then the next row (§5: "Tab reaches it after its row's widgets").
  await open(); await edit()
  await widget(R).focus()
  const order = [await focused()]
  // WebKit, as Safari, passes over buttons on Tab unless Option is held, as everywhere in the app.
  const tab = engine === 'webkit' ? 'Alt+Tab' : 'Tab'
  for (let i = 0; i < 12 && !order.includes(`widget:${T}`); i++) { await page.keyboard.press(tab); order.push(await focused()) }
  const firstRow = order.slice(0, order.indexOf(`widget:${T}`))
  const lastWidget = Math.max(firstRow.indexOf(`widget:${R}`), firstRow.indexOf(`widget:${B}`))
  ok(`${tag} Tab: a row's widgets first, then its width handle, its height handle and its +, then the next row`,
    firstRow.filter(x => x.startsWith('widget:')).join() === `widget:${R},widget:${B}` && firstRow.indexOf('split') > lastWidget && firstRow.indexOf('height') > firstRow.indexOf('split') && firstRow.indexOf('add') > firstRow.indexOf('height'), order.join(' → '))
  for (let i = 0; i < 3; i++) await page.keyboard.press(`Shift+${tab}`)
  const onSplit = await focused()
  await page.keyboard.press('ArrowLeft'); await settle()
  ok(`${tag} Tab: the handle it reaches works by key, one snap and one Undo`, onSplit === 'split' && (await rowsText()).startsWith(`${R}:4,${B}:8`), `${onSplit} ${await rowsText()}`)
  await undo()

  // ---- The handles are drawn in their gaps, out of the widgets, and stay there through a drag (§5).
  let gaps = await handleGaps()
  ok(`${tag} handles: each centred in the gap between its two widgets`, gaps.length === 2 && gaps.every(g => g <= 1), JSON.stringify(gaps))
  {
    const split = page.locator('.dashboard-row[data-row]').first().locator('.dashboard-split'), sb = await split.boundingBox(), row = await page.locator('.dashboard-row[data-row]').first().boundingBox()
    await page.mouse.move(sb.x + sb.width / 2, sb.y + 40); await page.mouse.down(); await page.mouse.move(row.x + row.width * 0.3, sb.y + 40, { steps: 6 })
    const held = await handleGaps()
    await page.mouse.up(); await settle()
    gaps = await handleGaps()
    ok(`${tag} handles: a dragged handle follows its gap as each snap shows, and after release`, held[0] <= 1 && gaps.every(g => g <= 1) && (await rowsText()).startsWith(`${R}:4`), `${JSON.stringify(held)} ${JSON.stringify(gaps)} ${await rowsText()}`)
    await undo()
  }
  ok(`${tag} handles: none inside a widget`, await page.locator('.dashboard-widget .dashboard-split').count() === 0)

  // ---- The row's +: shown on hover or focus, in the right gutter, at the row's end with the row re-divided (§6).
  const add = page.locator('.dashboard-row[data-row]').first().locator('.dashboard-row-add')
  await page.mouse.move(5, 5); await wait(300)
  const restOpacity = await add.evaluate(e => getComputedStyle(e).opacity)
  await widget(B).hover(); await wait(300)
  const hoverOpacity = await add.evaluate(e => getComputedStyle(e).opacity)
  const geo = await page.evaluate(() => {
    const row = document.querySelector('.dashboard-row[data-row]').getBoundingClientRect(), plus = document.querySelector('.dashboard-row-add button').getBoundingClientRect()
    const more = document.querySelector('.dashboard-row[data-row] > .dashboard-widget:last-of-type .dashboard-widget-more')?.getBoundingClientRect()
    const overlaps = more && !(plus.right <= more.left || plus.left >= more.right || plus.bottom <= more.top || plus.top >= more.bottom)
    return { gap: Math.round(plus.left - row.right), size: `${Math.round(plus.width)}x${Math.round(plus.height)}`, inside: plus.right <= document.documentElement.clientWidth, middle: Math.round(Math.abs((plus.top + plus.bottom) / 2 - (row.top + row.bottom) / 2)), overlaps }
  })
  ok(`${tag} row +: hidden at rest, shown while the row is hovered`, restOpacity === '0' && hoverOpacity === '1', `${restOpacity} → ${hoverOpacity}`)
  ok(`${tag} row +: 44 px, in the right gutter at the row's middle, inside the window and clear of the ⋯`, geo.size === '44x44' && geo.gap >= 0 && geo.inside && geo.middle <= 1 && !geo.overlaps, JSON.stringify(geo))
  await add.locator('button').click()
  await page.getByRole('menuitem', { name: 'Books', exact: true }).click(); await settle()
  ok(`${tag} row +: the widget joins at that row's end, and the widths go equal`, (await rowsText()).startsWith(`${R}:4,${B}:4,${B}:4 |`), await rowsText())
  // Narrowed to 960 in edit mode, a row of thirds wraps under 200 px: only handles between neighbours side by side show,
  // each in its gap; wide again, both are back in theirs (§7, measured again on resize).
  await page.setViewportSize({ width: 960, height: 900 }); await settle()
  const lines = await page.evaluate(() => new Set([...document.querySelector('.dashboard-row[data-row]').querySelectorAll(':scope > .dashboard-widget')].map(w => Math.round(w.getBoundingClientRect().top))).size)
  const wrapGaps = await handleGaps()
  ok(`${tag} wrapped row: a handle only between neighbours side by side, each in its gap`, lines > 1 && wrapGaps.every(g => g <= 1) && await page.locator('.dashboard-row[data-row]').first().locator('.dashboard-split:visible').count() < 2, `${lines} lines, ${JSON.stringify(wrapGaps)}`)
  await page.locator('.dashboard-row[data-row]').first().locator('.dashboard-widget').first().hover(); await wait(200)
  const narrowPlus = await page.evaluate(() => { const r = document.querySelector('.dashboard-row-add button')?.getBoundingClientRect(); return r ? Math.round(document.documentElement.clientWidth - r.right) : null })
  await page.getByRole('button', { name: 'Add a widget to this row' }).first().click(); await page.getByRole('menuitem', { name: 'Books', exact: true }).click(); await settle()
  ok(`${tag} row +: at 960 it's still inside the window, and adds there`, narrowPlus !== null && narrowPlus >= 0 && (await rowsText()).startsWith(`${R}:3,${B}:3,${B}:3,${B}:3 |`) && await page.locator('.dashboard-row[data-row]').first().locator('.dashboard-row-add').count() === 0, `${narrowPlus} px to spare · ${await rowsText()}`)
  await undo()
  ok(`${tag} row +: one Undo takes it back`, (await rowsText()).startsWith(`${R}:4,${B}:4,${B}:4 |`), await rowsText())
  await page.setViewportSize({ width: 1280, height: 900 }); await settle()
  const unwrapGaps = await handleGaps()
  ok(`${tag} wrapped row: wide again, every handle is back in its gap`, unwrapGaps.length === 3 && unwrapGaps.every(g => g <= 1), JSON.stringify(unwrapGaps))
  await page.mouse.move(5, 5); await page.keyboard.press('Escape'); await settle()
  ok(`${tag} row +: not in read mode`, await page.locator('.dashboard-row-add').count() === 0)

  // A row of four has no room, so no +; nor do any rows at 12 widgets.
  await open('wall'); await edit()
  ok(`${tag} row +: none on a row of four`, await page.locator('.dashboard-widget').count() === 4 && await page.locator('.dashboard-row-add').count() === 0)
  await open(); await edit()
  for (let i = 0; i < 12; i++) { const more = page.getByRole('button', { name: '+ Add widget' }); if (!(await more.count())) break; await more.click(); await page.getByRole('menuitem', { name: 'Books', exact: true }).click(); await settle() }
  ok(`${tag} row +: none at 12 widgets`, await page.locator('.dashboard-widget').count() === 12 && await page.locator('.dashboard-row-add').count() === 0, `${await page.locator('.dashboard-widget').count()} widgets, ${await page.locator('.dashboard-row-add').count()} +`)

  // ---- Pages' + → Dashboard (G6-1): one widget, its own Table, the caret in the title; the Table is the second view.
  for (const [where, trigger] of [['Pages', '.round-add'], ['the sidebar', '.side-label-add']]) {
    await page.goto(`${base}/pages`); await settle()
    await page.locator(trigger).first().click()
    const items = await page.locator('.new-page-menu-list [role=menuitem]').allInnerTexts()
    await page.getByRole('menuitem', { name: 'Dashboard', exact: true }).click()
    await page.locator('.dashboard-widget').first().waitFor({ timeout: 10000 }).catch(() => {}); await settle()
    const label = await page.locator('.dashboard-widget').first().getAttribute('aria-label').catch(() => null)
    ok(`${tag} ${where}' + → Dashboard: Page, Database, Dashboard, Import CSV; it opens on a dashboard of one widget, its own Table`,
      items.join() === 'Page,Database,Dashboard,Import CSV' && await page.locator('.dashboard-widget').count() === 1 && / · Table$/.test(label ?? '') && /focus=title/.test(page.url()), `${items.join()} · ${label} · ${page.url().split('?')[1]}`)
    const name = where === 'Pages' ? 'Plans' : 'Habits'
    await page.keyboard.type(name); await page.keyboard.press('Enter'); await settle()
    const id = new URL(page.url()).searchParams.get('page')
    await open(id)
    ok(`${tag} ${where}' + → Dashboard: the title typed first is its name, and its widget reads it after a reload`, (await page.locator('.dashboard-widget').first().getAttribute('aria-label')) === `${name} · Table`, await page.locator('.dashboard-widget').first().getAttribute('aria-label'))
    if (where === 'Pages') {
      await page.locator('[data-database-views]').first().click()
      const views = await page.locator('.database-menu button[aria-label$=" options"]').evaluateAll(bs => bs.map(b => b.getAttribute('aria-label').replace(/ options$/, '')))
      await page.keyboard.press('Escape')
      ok(`${tag} Pages' + → Dashboard: Dashboard first, its Table second`, views.join() === 'Dashboard,Table', views.join(' / '))
    }
  }

  ok(`${tag} no page errors`, errors.length === 0, errors.join(' | ').slice(0, 200))
  await browser.close()
}
const failed = results.filter(x => !x).length
console.log(`${results.length - failed}/${results.length} passed`)
process.exit(failed ? 1 : 0)
