// R3-26 Several rows on a List, Board and Gallery, in the built app, on a fresh store from board/seed-board.ts. At 1280: Shift and ⌘-click, a box from
// empty space, the bar's Edit and Delete with one Undo, and dragging picked cards on a Board with one Undo, pending and failed. At 390: Select rows, a tap ticks, All leaves out a hidden group.
// Usage: node tests/evidence/several-rows/several-rows.mjs <base-url> <store-path> <1280|390> [chromium|webkit] [shots-dir]  (a throwaway store the server at <base-url> reads, never his data)
import * as pw from '@playwright/test'
import { execSync } from 'node:child_process'
const [base, storePath, width, engine = 'chromium', shots] = process.argv.slice(2)
if (!base || !storePath || !width) { console.error('Usage: node tests/evidence/several-rows/several-rows.mjs <base-url> <store-path> <1280|390> [chromium|webkit] [shots-dir]'); process.exit(2) }
const wide = width === '1280'
execSync(`rm -f ${storePath} ${storePath}-wal ${storePath}-shm && node tests/evidence/board/seed-board.ts ${storePath}`, { stdio: 'ignore' })
const store = () => JSON.parse(execSync(`sqlite3 ${storePath} "select data from workspace"`, { maxBuffer: 1 << 26 }).toString())
const pageOf = id => store().pages.find(p => p.id === id)
const browser = await pw[engine].launch({ headless: true })
const context = await browser.newContext({ viewport: { width: Number(width), height: wide ? 900 : 844 }, hasTouch: !wide, serviceWorkers: 'block' })
const page = await context.newPage()
const errors = []; page.on('pageerror', e => { if (!/access control checks|ResizeObserver/.test(e.message)) errors.push(e.message) })
let fails = 0
const check = (ok, what, extra) => { if (!ok) fails++; console.log(ok ? 'PASS' : 'FAIL', what, extra === undefined ? '' : JSON.stringify(extra)) }
const wait = ms => page.waitForTimeout(ms)
const shot = async name => { if (shots) await page.screenshot({ path: `${shots}/${engine}-${width}-${name}.png` }) }
const tap = l => wide ? l.click() : l.tap()
const block = page.locator('.database-block').first(), menu = page.locator('.database-menu'), bar = block.locator('.database-picked-bar')
const closeMenu = async () => { await page.keyboard.press('Escape'); await wait(250); if (await menu.count()) { await page.locator('.database-menu-scrim').click({ position: { x: 5, y: 5 } }).catch(() => {}); await wait(250) } }
const layout = async name => { await tap(block.locator('.database-more-button')); await wait(300); await tap(menu.getByRole('menuitem', { name: 'Layout' })); await wait(300); await tap(menu.getByRole('menuitemradio', { name })); await wait(700); if (await menu.getByRole('menuitem', { name: 'Status' }).count()) { await tap(menu.getByRole('menuitem', { name: 'Status' }).first()); await wait(600) } await closeMenu(); await wait(300) }
const item = id => block.locator(`[data-card="${id}"], [data-row="${id}"]`).first()
const isPicked = id => item(id).evaluate(e => e.classList.contains('is-chosen'))
const undo = async () => { await tap(page.getByRole('button', { name: 'Undo' }).first()); await wait(1000) }
const done = async () => { if (await bar.count()) { await tap(bar.getByRole('button', { name: 'Done' })); await wait(250) } }
const titleOf = id => item(id).locator('.database-card-title, .database-gallery-title, .database-list-title, button').first()

await page.goto(`${base}/pages?page=books`); await wait(2500)
for (const name of ['List', 'Board', 'Gallery']) {
  await layout(name)
  if (wide) {
    // ⌘-click and Shift-click pick, and open nothing.
    const url = page.url()
    await titleOf('dune').click({ modifiers: ['Meta'] }); await wait(200)
    check(page.url() === url && await isPicked('dune') && (await bar.innerText()).includes('1 row'), `${name}: ⌘-click picks a row and opens nothing`, await bar.innerText().catch(() => ''))
    await titleOf('emma').click({ modifiers: ['Meta'] }); await wait(200)
    check((await bar.innerText()).includes('2 rows'), `${name}: another adds to it`)
    await titleOf('dune').click({ modifiers: ['Meta'] }); await wait(200)
    check(!(await isPicked('dune')) && (await bar.innerText()).includes('1 row'), `${name}: again takes it off`)
    await done()
    check(await bar.count() === 0, `${name}: Done ends it`)
    await titleOf('dune').click({ modifiers: ['Meta'] }); await wait(150)
    const ids = await block.locator('[data-card], [data-row]').evaluateAll(els => [...new Set(els.map(e => e.dataset.card ?? e.dataset.row))])
    const far = ids[Math.min(ids.indexOf('dune') + 2, ids.length - 1)]
    await titleOf(far).click({ modifiers: ['Shift'] }); await wait(200)
    const span = Math.abs(ids.indexOf(far) - ids.indexOf('dune')) + 1
    check((await bar.innerText()).includes(`${span} rows`), `${name}: Shift-click takes the range`, [await bar.innerText(), span])
    await shot(`${name}-picked`)
    // A plain press on empty space clears; a box from empty space picks what it touches.
    const start = name === 'Board' ? await block.locator('.database-column').first().boundingBox() : await block.boundingBox()
    const empty = name === 'Board' ? { x: start.x + start.width - 8, y: start.y + start.height - 6 } : { x: start.x - 0 + 2, y: start.y + 2 }
    await page.mouse.click(empty.x, empty.y); await wait(200)
    check(await bar.count() === 0, `${name}: a press on empty space clears`)
    if (name === 'Board') {
      await block.locator('.database-board').evaluate(e => { e.scrollLeft = 0 }); await wait(100)
      const col = await block.locator('.database-column', { has: page.locator('[data-card="emma"]') }).first().boundingBox()
      const a = await item('dune').boundingBox()
      await page.mouse.move(col.x + 40, col.y + col.height + 30); await page.mouse.down()
      await page.mouse.move(a.x + 40, a.y + 20, { steps: 8 }); await wait(120)
      check(await page.locator('.database-pick-box').count() === 1, `${name}: a box draws`)
      await shot(`${name}-box`)
      await page.mouse.up(); await wait(200)
      check(await page.locator('.database-pick-box').count() === 0 && await isPicked('dune') && await isPicked('emma'), `${name}: and picks the cards it touches`, await bar.innerText().catch(() => ''))
      await done()
    } else {
      // A list's rows run edge to edge, so its empty space is beside its + New, as a gallery's is.
      const foot = block.locator(name === 'List' ? '.database-new' : '.database-new-row').first()
      await foot.scrollIntoViewIfNeeded(); await wait(100)
      const f = await foot.boundingBox(), edge = await block.boundingBox()
      const near = await block.locator('[data-row]').evaluateAll((els, y) => { const above = els.filter(e => e.getBoundingClientRect().bottom <= y + 1); return above.at(-1)?.dataset.row ?? els[0].dataset.row }, f.y)
      const b = await item(near).boundingBox()
      await page.mouse.move(edge.x + edge.width - 8, f.y + f.height / 2); await page.mouse.down()
      await page.mouse.move(b.x + b.width - 40, b.y + b.height / 2, { steps: 8 }); await wait(120)
      check(await page.locator('.database-pick-box').count() === 1, `${name}: a box draws`)
      await page.mouse.up(); await wait(200)
      check(await isPicked(near), `${name}: and picks what it touches`, await bar.innerText().catch(() => ''))
      await shot(`${name}-box`)
      await done()
    }
  }
  if (!wide) {
    await tap(block.locator('.database-more-button')); await wait(300); await tap(menu.getByRole('menuitem', { name: 'Select rows' })); await wait(300)
    check(await bar.count() === 1, `${name}: ⋯ → Select rows starts it`)
    await shot(`${name}-picking`)
    const url = page.url()
    await tap(titleOf('dune')); await wait(200); await tap(titleOf('emma')); await wait(200)
    check(page.url() === url && (await bar.innerText()).includes('2 rows') && await isPicked('dune'), `${name}: a tap ticks and opens nothing`, [await bar.innerText(), page.url(), url, await isPicked('dune')])
    await shot(`${name}-ticked`)
    await done()
    await tap(titleOf('emma')); await wait(1500)
    check(page.url().includes('page=emma'), `${name}: after Done a tap opens a row`)
    await page.goBack(); await wait(1800)
  }
  // Edit property, from the bar, on the cards: it opens, saves on both, and one Undo takes back both.
  const pagesOf = () => [pageOf('dune').values.pages, pageOf('ubik').values.pages]
  const pagesBefore = pagesOf()
  if (wide) { await titleOf('dune').click({ modifiers: ['Meta'] }); await titleOf('ubik').click({ modifiers: ['Meta'] }) }
  else { await tap(block.locator('.database-more-button')); await wait(300); await tap(menu.getByRole('menuitem', { name: 'Select rows' })); await wait(300); await tap(titleOf('dune')); await wait(150); await tap(titleOf('ubik')) }
  await wait(250)
  await tap(bar.getByRole('button', { name: /Edit property/ })); await wait(200)
  await tap(bar.getByRole('menuitem', { name: 'Pages' })); await wait(300)
  check(await bar.count() === 1 && await page.locator('.property-field').count() === 1, `${name}: Edit property opens its editor, with the picks kept`, await bar.innerText().catch(() => 'no bar'))
  await page.locator('.property-field').fill('7'); await wait(100)
  if (wide) await page.keyboard.press('Enter'); else await page.getByText('Done', { exact: true }).last().tap()
  await wait(1200)
  check(pagesOf().every(v => v === 7), `${name}: it saves on both`, pagesOf())
  await undo()
  check(JSON.stringify(pagesOf()) === JSON.stringify(pagesBefore), `${name}: one Undo takes back both`, pagesOf())
  await done()
  // Delete, one Undo.
  const before = [pageOf('dune').values.kind, pageOf('ubik').values.kind]
  if (wide) { await titleOf('dune').click({ modifiers: ['Meta'] }); await titleOf('ubik').click({ modifiers: ['Meta'] }) }
  else { await tap(block.locator('.database-more-button')); await wait(300); await tap(menu.getByRole('menuitem', { name: 'Select rows' })); await wait(300); await tap(titleOf('dune')); await wait(150); await tap(titleOf('ubik')) }
  await wait(250)
  await tap(bar.getByRole('button', { name: 'Delete' })); await wait(1100)
  check(Boolean(pageOf('dune').trashedAt) && Boolean(pageOf('ubik').trashedAt) && await bar.count() === 0, `${name}: Delete takes both, and ends it`)
  await undo()
  check(!pageOf('dune').trashedAt && !pageOf('ubik').trashedAt && pageOf('dune').values.kind === before[0], `${name}: one Undo brings back both`)
}

// The table's picks stay marked too, after the page's own selection is cleared (the editor clears its `is-picked`, and only its own).
if (wide) {
  await layout('Table')
  await block.locator('tr.database-row[data-row="dune"]').hover(); await block.locator('tr.database-row[data-row="dune"] .database-row-gutter input').click(); await wait(150)
  await block.locator('tr.database-row[data-row="emma"]').hover(); await block.locator('tr.database-row[data-row="emma"] .database-row-gutter input').click(); await wait(150)
  check(await block.locator('tr.database-row.is-picked').count() === 2, "a table's two picked rows both stay marked", await block.locator('tr.database-row.is-picked').count())
  // A block can be drawn again as focus goes to the bar's editor: its picks and the editor stay.
  await tap(bar.getByRole('button', { name: /Edit property/ })); await wait(200)
  await tap(bar.getByRole('menuitem', { name: 'Pages' })); await wait(300)
  check(await bar.count() === 1 && await page.locator('.property-field').count() === 1, "a table's Edit property opens too")
  await page.locator('.property-field').fill('9'); await page.keyboard.press('Enter'); await wait(1200)
  check(pageOf('dune').values.pages === 9 && pageOf('emma').values.pages === 9, 'and saves on both')
  await undo()
  await done()
}

// All leaves out a hidden group, on a board too.
if (!wide) {
  await tap(block.locator('.database-more-button')); await wait(300); await tap(menu.getByRole('button', { name: 'Group' })); await wait(300)
  await tap(menu.locator('.database-group-list').first().getByLabel('Show Finished')); await wait(800); await closeMenu()
  await layout('Board')
  await tap(block.locator('.database-more-button')); await wait(300); await tap(menu.getByRole('menuitem', { name: 'Select rows' })); await wait(300)
  await tap(bar.getByRole('button', { name: 'All' })); await wait(200)
  const open = store().pages.filter(p => p.parentId === 'list' && !p.trashedAt && p.values?.status !== 'done')
  check((await bar.innerText()).includes(`${open.length} rows`), "All leaves out a hidden group's rows", [await bar.innerText(), open.length])
  await done()
}

// Dragging picked cards on a Board: all of them, one Undo; at once while it saves; a failed save keeps them, with one Retry.
if (wide) {
  await layout('Board')
  const statuses = () => ['dune', 'emma'].map(id => pageOf(id).values.status)
  const startStatuses = statuses()
  const pickBoth = async () => { await titleOf('dune').click({ modifiers: ['Meta'] }); await wait(100); await titleOf('emma').click({ modifiers: ['Meta'] }); await wait(200) }
  const dragToDone = async () => {
    const c = await item('dune').boundingBox(), to = await block.locator('.database-column[data-column="done"]').boundingBox()
    await page.mouse.move(c.x + 20, c.y + 10); await page.mouse.down()
    await page.mouse.move(c.x + 28, c.y + 18, { steps: 3 }); await wait(80)
    await page.mouse.move(Math.min(to.x + 20, 1110), to.y + 60, { steps: 12 }); await wait(250)
  }
  const inDone = id => block.locator(`.database-column[data-column="done"] [data-card="${id}"]`).count()
  await pickBoth(); await dragToDone()
  check((await page.locator('.database-ghost-count').innerText()) === '2 rows', 'the ghost says how many')
  await shot('Board-dragging')
  await page.mouse.up(); await wait(1100)
  check(statuses().every(s => s === 'done'), 'dragging one picked card moves them all', statuses())
  check((await page.locator('[role=alert], [role=status]').allInnerTexts()).join(' ').includes('2 rows moved to Finished'), 'and says so')
  await undo()
  check(JSON.stringify(statuses()) === JSON.stringify(startStatuses), 'one Undo takes back both', statuses())
  const isCommand = req => req.method() === 'POST' && /_serverFn|functions/.test(req.url())
  await page.route('**/*', async route => { if (isCommand(route.request())) await new Promise(res => setTimeout(res, 1500)); await route.continue() })
  await dragToDone(); await page.mouse.up(); await wait(400)
  check(await inDone('dune') === 1 && await inDone('emma') === 1, 'while saving they show in the new column at once')
  await wait(2400)
  check(statuses().every(s => s === 'done'), 'then they save', statuses())
  await tap(page.getByRole('button', { name: 'Undo' }).first()); await wait(2400)
  await page.unroute('**/*')
  await page.route('**/*', route => (isCommand(route.request()) ? route.abort() : route.continue()))
  await dragToDone(); await page.mouse.up(); await wait(1500)
  const unsaved = block.locator('.database-unsaved')
  check(await inDone('dune') === 1 && await inDone('emma') === 1, 'a failed save keeps them where they were dropped')
  check((await unsaved.innerText()).includes('1 change'), 'as one change, with Retry', await unsaved.innerText())
  await page.unroute('**/*')
  await tap(unsaved.getByRole('button', { name: 'Retry' })); await wait(1400)
  check(statuses().every(s => s === 'done') && await unsaved.count() === 0, 'and Retry saves them', statuses())
  await undo()
  check(JSON.stringify(statuses()) === JSON.stringify(startStatuses), 'and one Undo takes them back', statuses())
  await done()
  // A plain drag of a card that isn't picked still moves that one.
  await titleOf('emma').click({ modifiers: ['Meta'] }); await wait(150)
  await dragToDone(); await page.mouse.up(); await wait(1000)
  check(pageOf('dune').values.status === 'done' && pageOf('emma').values.status !== 'done', 'a card that is not picked moves alone', statuses())
  await undo()
}
check(errors.length === 0, 'no page errors', errors)
console.log(fails ? `${fails} FAILED` : 'ALL PASS')
await browser.close()
process.exit(fails ? 1 : 0)
