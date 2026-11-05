// R4-17 in the built app: several to-dos, at 1280 and 390. The four columns and no Delete; one change and one Undo; each to-do ends as if edited alone; the limit says so.
// Usage: node tests/evidence/todos-many/todos-many.mjs <base-url> <store-path> [chromium|webkit] [shots-dir]  (a throwaway store the server uses)
import * as pw from '@playwright/test'
import { execSync } from 'node:child_process'
const [base, S, engine = 'chromium', shots] = process.argv.slice(2)
if (!base || !S) { console.error('Usage: node tests/evidence/todos-many/todos-many.mjs <base-url> <store-path> [chromium|webkit] [shots-dir]'); process.exit(2) }
const seed = kind => execSync(`rm -f ${S} ${S}-wal ${S}-shm && node --no-warnings tests/evidence/todos-many/seed.ts ${S} ${kind}`, { stdio: 'ignore' })
const tasks = () => JSON.parse(execSync(`sqlite3 ${S} "select data from workspace"`, { maxBuffer: 1 << 26 }).toString()).tasks
const task = title => tasks().find(t => t.title === title)
const browser = await pw[engine].launch({ headless: true })
let fails = 0
const check = (ok, what, extra) => { if (!ok) fails++; console.log(ok ? 'PASS' : 'FAIL', what, extra === undefined ? '' : JSON.stringify(extra)) }
const open = async (viewport, extra = {}) => { const c = await browser.newContext({ viewport, serviceWorkers: 'block', ...extra }), p = await c.newPage(); const errors = []; p.on('pageerror', e => { if (!/access control checks|ResizeObserver/.test(e.message)) errors.push(e.message) }); await p.goto(`${base}/pages?page=todos`); await p.waitForTimeout(2500); return { c, p, errors, wait: ms => p.waitForTimeout(ms), bar: p.locator('.database-picked-bar'), row: t => p.locator('tr.database-row', { hasText: t }) } }
const notice = p => p.locator('[role=alert], [role=status]').allInnerTexts().then(t => t.join(' | ').replace(/\s+/g, ' '))

// A table at 1280.
seed('')
{ const { c, p, errors, wait, bar, row } = await open({ width: 1280, height: 900 })
  await row('Book the flights').hover(); await row('Book the flights').locator('.database-row-pick').click(); await wait(200)
  await row('Call the bank').hover(); await row('Call the bank').locator('.database-row-pick').click({ modifiers: ['Shift'] }); await wait(200)
  check((await bar.innerText()).startsWith('3 to-dos') , 'the boxes and Shift-click pick a range', await bar.innerText())
  check(await bar.getByText('Delete').count() === 0, 'there\'s no Delete on this bar')
  await bar.getByRole('button', { name: /Edit property/ }).click(); await wait(200)
  const items = await bar.getByRole('menuitem').allInnerTexts()
  check(items.join() === 'Status,Planned,Start,Deadline' || items.sort().join() === 'Deadline,Planned,Start,Status', 'it offers the four a to-do can change', items)
  if (shots) await p.screenshot({ path: `${shots}/${engine}-table-menu.png` })
  await bar.getByRole('menuitem', { name: 'Status' }).click(); await wait(300)
  await p.locator('#property-options [role=option]', { hasText: 'Done' }).click(); await wait(1200)
  check(['Book the flights', 'Water the plants', 'Call the bank'].every(t => task(t).status === 'done') && task('Pay the rent').status === 'open', 'Status changes all three', tasks().map(t => [t.title, t.status]))
  check(/3 to-dos changed/.test(await notice(p)), 'and the notice says how many', await notice(p))
  await p.getByRole('button', { name: 'Undo' }).first().click(); await wait(1200)
  check(['Book the flights', 'Water the plants', 'Call the bank'].every(t => task(t).status === 'open'), 'one Undo puts all three back')
  // Each ends as if edited alone: a cancelled one can't be planned, and a paused one opens.
  await bar.getByRole('button', { name: 'Done' }).click().catch(() => {}); await wait(200)
  for (const t of ['Paused one', 'Cancelled one']) { await row(t).hover(); await row(t).locator('.database-row-pick').click(); await wait(100) }
  check((await bar.innerText()).startsWith('2 to-dos'), 'picks a paused and a cancelled one', await bar.innerText())
  await bar.getByRole('button', { name: /Edit property/ }).click(); await wait(200)
  await bar.getByRole('menuitem', { name: 'Planned' }).click(); await wait(400)
  await p.locator('.property-popover .property-row, .property-popover button', { hasText: 'Tomorrow' }).first().click()
  await wait(1300)
  const said = await notice(p)
  check(/1 to-do changed · 1 couldn't/.test(said), 'the notice says how many changed and how many couldn\'t', said)
  check(task('Paused one').paused === false && task('Cancelled one').status === 'cancelled', 'the paused one opens, and the cancelled one stays', [task('Paused one').paused, task('Cancelled one').status])
  check(errors.length === 0, 'no page errors', errors)
  await c.close() }

// A change that takes a while says so in the bar (Planned on 500 is about 6 s on the deployed Worker), and a quick one doesn't flash.
seed('')
{ const { c, p, errors, wait, bar, row } = await open({ width: 1280, height: 900 })
  for (const t of ['Book the flights', 'Water the plants', 'Call the bank']) { await row(t).hover(); await row(t).locator('.database-row-pick').click(); await wait(100) }
  let release; const held = new Promise(r => { release = r })
  await p.route('**/_serverFn/**', async route => { if ((route.request().postData() ?? '').includes('edit-todos')) await held; await route.continue().catch(() => {}) })
  await bar.getByRole('button', { name: /Edit property/ }).click(); await wait(200)
  await bar.getByRole('menuitem', { name: 'Planned' }).click(); await wait(400)
  await p.locator('.property-popover .property-row, .property-popover button', { hasText: 'Tomorrow' }).first().click(); await wait(150)
  check(!/Changing/.test(await bar.innerText()), 'not in the first moment, so a quick change doesn\'t flash', await bar.innerText())
  await wait(500)
  check(/Changing 3 to-dos…/.test(await bar.innerText()), 'then it says so while it\'s held', await bar.innerText())
  release(); await wait(1200)
  check((await bar.innerText()).startsWith('3 to-dos'), 'and goes back to the count when it\'s done', await bar.innerText())
  check(/3 to-dos changed/.test(await notice(p)), 'with the usual notice', await notice(p))
  check(errors.length === 0, 'no page errors', errors)
  await c.close() }

// A second change queued behind the first: the bar keeps saying so until both are done.
seed('')
{ const { c, p, errors, wait, bar, row } = await open({ width: 1280, height: 900 })
  for (const t of ['Book the flights', 'Water the plants', 'Call the bank']) { await row(t).hover(); await row(t).locator('.database-row-pick').click(); await wait(100) }
  const held = []
  await p.route('**/_serverFn/**', async route => { if ((route.request().postData() ?? '').includes('edit-todos')) await new Promise(r => held.push(r)); await route.continue().catch(() => {}) })
  const plan = async day => { await bar.getByRole('button', { name: /Edit property/ }).click(); await wait(200); await bar.getByRole('menuitem', { name: 'Planned' }).click(); await wait(400); await p.locator('.property-popover .property-row, .property-popover button', { hasText: day }).first().click(); await wait(200); await p.keyboard.press('Escape'); await wait(150) }
  await plan('Tomorrow'); await plan('Today'); await wait(500)
  check(/Changing 3 to-dos…/.test(await bar.innerText()) && held.length === 1, 'two changes, one sent and one queued', [await bar.innerText(), held.length])
  held[0](); await wait(900)
  check(/Changing 3 to-dos…/.test(await bar.innerText()) && held.length === 2, 'the first done, it still says so while the second is held', [await bar.innerText(), held.length])
  held[1](); await wait(1200)
  check((await bar.innerText()).startsWith('3 to-dos'), 'and goes back to the count after the last', await bar.innerText())
  check(errors.length === 0, 'no page errors', errors)
  await c.close() }

// A Board at 1280: ⌘-click, then drag them together.
seed('')
{ const { c, p, errors, wait, bar } = await open({ width: 1280, height: 900 })
  const menu = p.locator('.database-menu')
  await p.locator('.database-more-button').first().click(); await wait(300); await menu.getByRole('menuitem', { name: 'Layout' }).click(); await wait(300); await menu.getByRole('menuitemradio', { name: 'Board' }).click(); await wait(800); await p.keyboard.press('Escape'); await wait(400)
  const card = t => p.locator('[data-card]', { hasText: t })
  await card('Book the flights').click({ modifiers: ['Meta'] }); await wait(150)
  await card('Pay the rent').click({ modifiers: ['Meta'] }); await wait(250)
  check((await bar.innerText()).startsWith('2 to-dos'), '⌘-click picks cards', await bar.innerText())
  if (shots) await p.screenshot({ path: `${shots}/${engine}-board.png` })
  const from = await card('Book the flights').boundingBox(), to = await p.locator('.database-column').filter({ has: p.locator('.database-column-head', { hasText: 'Done' }) }).first().boundingBox()
  await p.mouse.move(from.x + 40, from.y + 12); await p.mouse.down(); await p.mouse.move(from.x + 60, from.y + 24, { steps: 4 }); await p.mouse.move(to.x + to.width / 2, to.y + 60, { steps: 12 }); await wait(250); await p.mouse.up(); await wait(1400)
  check(task('Book the flights').status !== 'open' && task('Pay the rent').status === task('Book the flights').status && task('Call the bank').status === 'open', 'dragging one moves both', tasks().map(t => [t.title, t.status]))
  check(/2 to-dos moved to /.test(await notice(p)), 'with one notice', await notice(p))
  await p.getByRole('button', { name: 'Undo' }).first().click(); await wait(1200)
  check(task('Book the flights').status === 'open' && task('Pay the rent').status === 'open', 'and one Undo')
  check(errors.length === 0, 'no page errors on a Board', errors)
  await c.close() }

// At 390.
seed('')
{ const { c, p, errors, wait, bar, row } = await open({ width: 390, height: 844 }, engine === 'chromium' ? { hasTouch: true } : {})
  const menu = p.locator('.database-menu')
  await p.locator('.database-more-button').first().click(); await wait(300)
  await menu.getByRole('menuitem', { name: 'Select rows' }).click(); await wait(400)
  check(await bar.count() === 1 && (await bar.innerText()).includes('0 to-dos'), '390: ⋯ → Select rows starts it', await bar.innerText())
  await bar.getByRole('button', { name: 'All' }).click(); await wait(300)
  check(/^\d+ to-dos/.test(await bar.innerText()), '390: All picks them', await bar.innerText())
  if (shots) await p.screenshot({ path: `${shots}/${engine}-390.png` })
  check(errors.length === 0, '390: no page errors', errors)
  await c.close() }

// Past the limit, it says so.
seed('many')
{ const { c, p, errors, wait, bar } = await open({ width: 390, height: 844 }, engine === 'chromium' ? { hasTouch: true } : {})
  const menu = p.locator('.database-menu')
  await p.locator('.database-more-button').first().click(); await wait(300); await menu.getByRole('menuitem', { name: 'Select rows' }).click(); await wait(400)
  await bar.getByRole('button', { name: 'All' }).click(); await wait(1500)
  const text = await bar.innerText()
  check(/500 to-dos · 500 at most/.test(text) && await bar.getByRole('button', { name: 'All' }).count() === 0, 'with 505, All takes 500 and says so', text)
  check(await bar.getByRole('button', { name: /Edit property/ }).count() === 1, 'and those can still be edited')
  if (shots) await p.screenshot({ path: `${shots}/${engine}-limit.png` })
  // The most the bar lets through goes through, and comes back with one Undo.
  await bar.getByRole('button', { name: /Edit property/ }).click(); await wait(300)
  await bar.getByRole('menuitem', { name: 'Status' }).click(); await wait(300)
  await p.locator('#property-options [role=option]', { hasText: 'Done' }).click(); await wait(6000)
  const done = () => tasks().filter(t => /^To-do /.test(t.title) && t.status === 'done').length
  check(done() === 500 && /500 to-dos changed/.test(await notice(p)), '500 change in one go, with the notice', [done(), await notice(p)])
  await p.getByRole('button', { name: 'Undo' }).first().click(); await wait(6000)
  check(done() === 0, 'and one Undo puts all 500 back', done())
  check(errors.length === 0, 'limit: no page errors', errors)
  await c.close() }
console.log(fails ? `${fails} FAILED` : 'ALL PASS')
await browser.close()
process.exit(fails ? 1 : 0)
