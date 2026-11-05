// A Timeline's rows, from trying to break #142: a bar's name stays clear of the handle and toggle at the left, Esc cancels a row's drag, the drop line shows where a row will land, and a parent only there for a filter's match starts open, on a Timeline, table and list.
// Usage: node tests/evidence/timeline/rows.mjs <base-url> <store-path> [chromium|webkit] [shots-dir]  (a throwaway store the server uses, never his data)
import * as pw from '@playwright/test'
import { execSync } from 'node:child_process'
const [base, S, engine = 'chromium', shots] = process.argv.slice(2)
if (!base || !S) { console.error('Usage: node tests/evidence/timeline/rows.mjs <base-url> <store-path> [chromium|webkit] [shots-dir]'); process.exit(2) }
const browser = await pw[engine].launch({ headless: true })
let fails = 0
const check = (ok, what, extra) => { if (!ok) fails++; console.log(ok ? 'PASS' : 'FAIL', what, extra === undefined ? '' : JSON.stringify(extra)) }
const open = async (...args) => {
  execSync(`rm -f ${S} ${S}-wal ${S}-shm && node --no-warnings tests/evidence/sub-items/seed.ts ${S} timeline && node --no-warnings tests/evidence/timeline/seed-rows.ts ${S} ${args.join(' ')}`, { stdio: 'ignore' })
  const c = await browser.newContext({ viewport: { width: 1280, height: 760 }, serviceWorkers: 'block' }), p = await c.newPage(), errors = []
  p.on('pageerror', e => { if (!/access control checks|ResizeObserver/.test(e.message)) errors.push(e.message) })
  await p.goto(`${base}/pages?page=work`); await p.waitForTimeout(2300)
  return { c, p, errors, wait: ms => p.waitForTimeout(ms) }
}
const lane = (p, id) => p.locator(`.database-bar-lane[data-row="${id}"]`).first()
const lanes = p => p.locator('.database-bar-lane[data-row]').evaluateAll(l => l.map(e => e.dataset.row))
const store = () => JSON.parse(execSync(`sqlite3 ${S} "select data from workspace"`, { maxBuffer: 1 << 26 }).toString())
const toLeft = (p, id, offset) => p.locator('.database-timeline').evaluate((e, [id, offset]) => { const b = document.querySelector(`.database-bar-lane[data-row="${id}"] .database-bar`); e.scrollLeft += b.getBoundingClientRect().x - e.getBoundingClientRect().x - offset }, [id, offset])
const titleX = (p, id) => lane(p, id).locator('.database-bar-title').evaluate(t => { const r = document.createRange(); r.selectNodeContents(t.firstChild); return Math.round(r.getBoundingClientRect().x) })
const box = async l => l.boundingBox()
// 1. The name and what's at the left.
{ const { c, p, errors, wait } = await open('closed')
  await lane(p, 'top').locator('.database-sub-toggle').click(); await wait(300)
  for (const offset of [10, -20]) { await toLeft(p, 'top', offset); await wait(300); await p.mouse.move(800, (await box(lane(p, 'top'))).y + 18); await wait(150)
    const t = await titleX(p, 'top'), toggle = await box(lane(p, 'top').locator('.database-sub-toggle')), bar = await box(lane(p, 'top').locator('.database-bar'))
    check(t >= toggle.x + toggle.width - 1, `a parent's bar ${offset} px from the left: its name starts after the toggle`, [t, toggle.x + toggle.width, bar.x]) }
  if (shots) await p.screenshot({ path: `${shots}/${engine}-name-closed.png` })
  await toLeft(p, 'other', -20); await wait(300); await p.mouse.move(800, (await box(lane(p, 'other'))).y + 18); await wait(150)
  const o = await titleX(p, 'other'), h = await box(lane(p, 'other').locator('.database-pane-handle'))
  check(o >= h.x + h.width - 1, "a row's bar part off the left: its name starts after the handle", [o, h.x + h.width])
  await p.locator('.database-timeline-toggle').click(); await wait(600); await toLeft(p, 'other', 480); await wait(300)
  const pane = await box(lane(p, 'other').locator('.database-pane')), inPane = await titleX(p, 'other')
  check(inPane >= pane.x + pane.width, 'with the table open, a name stays clear of the table too', [inPane, pane.x + pane.width])
  check(errors.length === 0, 'no page errors', errors)
  await c.close() }
// 2. Esc, and the drop line.
{ const { c, p, errors, wait } = await open('closed')
  const before = await lanes(p), start = async id => { await lane(p, id).hover(); await wait(120); const h = await box(lane(p, id).locator('.database-pane-handle')); await p.mouse.move(h.x + 6, h.y + 6); await p.mouse.down(); return h }
  const h = await start('other'), t = await box(lane(p, 'top')); await p.mouse.move(h.x + 6, t.y + 3, { steps: 5 }); await wait(120)
  check(await p.locator('.is-drop-before').count() === 1, 'dragging a row shows a line')
  await p.keyboard.press('Escape'); await wait(200)
  check(await p.locator('.is-drop-before').count() === 0 && await p.locator('.database-bar-lane.is-dragging').count() === 0, 'Esc takes it away')
  await p.mouse.up(); await wait(1200)
  check((await lanes(p)).join() === before.join(), 'and letting go moves nothing', await lanes(p))
  await lane(p, 'top').locator('.database-sub-toggle').click(); await wait(300)
  const h2 = await start('other'), kid = await box(lane(p, 'kid')); await p.mouse.move(h2.x + 6, kid.y + 4, { steps: 5 }); await wait(150)
  const line = await p.locator('.is-drop-before').evaluateAll(l => l.map(e => e.dataset.row))
  check(line.length === 1 && line[0] !== 'kid', "dragging over a sub-item, the line isn't on it", line)
  await p.mouse.up(); await wait(1300)
  const now = await lanes(p), at = now.indexOf('other')
  check(now[at + 1] === line[0], 'and the row lands where the line was', [now, line])
  check(now.indexOf('kid') === now.indexOf('top') + 1, 'with the sub-item still under its parent', now)
  check(errors.length === 0, 'no page errors', errors)
  await c.close() }
// 2b. A parent dropped just past its own sub-items, or on them, is where it already was: nothing sent, so the last change keeps its Undo.
for (const [view, line, handle, rowsOf] of [['Plan', id => `.database-bar-lane[data-row="${id}"]`, '.database-pane-handle', lanes], ['table', id => `tr.database-row[data-row="${id}"]`, '.database-row-handle', p => p.locator('tr.database-row').evaluateAll(l => l.map(e => e.dataset.row))], ['list', id => `.database-list-row[data-row="${id}"]`, '.database-list-handle', p => p.locator('.database-list-row').evaluateAll(l => l.map(e => e.dataset.row))]]) {
  const { c, p, errors, wait } = await open()
  if (view !== 'Plan') { await p.locator('.database-view-name').first().click(); await wait(250); await p.locator('.database-view-pick', { hasText: view }).click(); await wait(800) }
  await p.locator(line('top')).locator('.database-sub-toggle').first().click(); await wait(300)
  const seen = await rowsOf(p), own = seen[seen.indexOf('top') + 1], after = seen[seen.indexOf('top') + 2]
  check(own === 'kid' && after, `${view}: the parent is open, with its sub-items under it`, seen)
  const revision = () => store().revision, before = revision()
  for (const [what, onto] of [["past its own sub-items", after], ['on its own sub-item', own]]) {
    await p.locator(line('top')).first().hover(); await wait(120)
    const h = await box(p.locator(line('top')).locator(handle).first()), t = await box(p.locator(line(onto)).first())
    await p.mouse.move(h.x + 6, h.y + 6); await p.mouse.down(); await p.mouse.move(h.x + 6, t.y + 3, { steps: 6 }); await wait(150); await p.mouse.up(); await wait(1200)
    check(revision() === before, `${view}: a parent dropped ${what} sends nothing`, [before, revision()])
    check(await p.getByText('Row moved').count() === 0, `${view}: and says nothing`)
    check((await rowsOf(p)).join() === seen.join(), `${view}: and stays put`, await rowsOf(p))
  }
  check(errors.length === 0, `${view}: no page errors`, errors)
  await c.close()
}
// 3. A filter only a sub-item matches: grand, under kid, under top.
for (const [view, rowsOf] of [['Plan', lanes], ['table', p => p.locator('tr.database-row').evaluateAll(l => l.map(e => e.dataset.row))], ['list', p => p.locator('.database-list-row').evaluateAll(l => l.map(e => e.dataset.row))]]) {
  const { c, p, errors, wait } = await open('filter')
  if (view !== 'Plan') { await p.locator('.database-view-name').first().click(); await wait(250); await p.locator('.database-view-pick', { hasText: view }).click(); await wait(800) }
  const seen = await rowsOf(p)
  check(seen.includes('grand') && seen.includes('kid') && seen.includes('top'), `${view}: a filter's only match shows, with its parents open above it`, seen)
  if (shots) await p.screenshot({ path: `${shots}/${engine}-filter-${view}.png` })
  const toggle = p.locator(view === 'Plan' ? '.database-bar-lane[data-row="top"] .database-sub-toggle' : view === 'table' ? 'tr.database-row[data-row="top"] .database-sub-toggle' : '.database-list-row[data-row="top"] .database-sub-toggle').first()
  await toggle.click(); await wait(300)
  check(!(await rowsOf(p)).includes('grand'), `${view}: closed by hand, it closes`, await rowsOf(p))
  await p.mouse.move(2, 2); await p.waitForTimeout(600)
  check(!(await rowsOf(p)).includes('grand'), `${view}: and stays closed`, await rowsOf(p))
  await toggle.click(); await wait(300)
  check((await rowsOf(p)).includes('grand'), `${view}: and opens again`, await rowsOf(p))
  await toggle.click(); await wait(300)
  // Changing the filter and coming back to it: that was a change, so it starts open again.
  await p.locator('.database-chip-open').first().click(); await wait(300)
  await p.getByLabel('Condition').first().selectOption({ index: 1 }); await wait(700)
  await p.getByLabel('Condition').first().selectOption('eq'); await wait(700)
  await p.keyboard.press('Escape'); await wait(300)
  check((await rowsOf(p)).includes('grand'), `${view}: another filter and back, the parent has started open again`, await rowsOf(p))
  await toggle.click(); await wait(300)
  // Clearing the filter: back to as it was, with nothing kept.
  const stored = () => JSON.stringify(store().pages.find(x => x.id === 'work').database.views.map(v => [v.id, v.subItemsDisplay ?? null]))
  const beforeStored = stored()
  await p.getByRole('button', { name: 'Remove filter' }).first().click(); await wait(1200)
  const after = await rowsOf(p)
  check(after.includes('top') && !after.includes('kid'), `${view}: clearing the filter leaves the parent closed, as it was before`, after)
  check(stored() === beforeStored && !Object.keys(await p.evaluate(() => ({ ...localStorage }))).some(k => /shut/.test(k)), `${view}: and nothing about it was kept`)
  check(errors.length === 0, `${view}: no page errors`, errors)
  await c.close()
}
// 4. Esc during a drag in a peek, with the caret in the peek's text and without: it takes the drag, and the next one takes the peek.
for (const caret of [true, false]) {
  const { c, p, errors, wait } = await open('closed', 'peek')
  await p.goto(`${base}/pages?page=work&peek=other`); await wait(2300)
  const peek = p.locator('.peek'), inner = id => peek.locator(`.database-bar-lane[data-row="${id}"]`).first(), inside = () => peek.locator('.database-bar-lane[data-row]').evaluateAll(l => l.map(e => e.dataset.row))
  const say = caret ? 'with the caret in its text' : 'with no caret'
  const prepare = async () => { if (caret) { await peek.getByText('A line above').click(); await wait(200) } else { await p.evaluate(() => { document.activeElement?.blur?.(); getSelection()?.removeAllRanges() }); await wait(100) } }
  check(await peek.count() === 1 && (await inside()).includes('other'), `in a peek ${say}: the Timeline shows`, await inside())
  const was = await inside(), revision = store().revision
  const line = async () => { await prepare(); await inner('other').hover(); await wait(120); const h = await box(inner('other').locator('.database-pane-handle')), t = await box(inner('top')); await p.mouse.move(h.x + 6, h.y + 6); await p.mouse.down(); await p.mouse.move(h.x + 6, t.y + 3, { steps: 5 }); await wait(150) }
  await line()
  check(await peek.locator('.is-drop-before').count() === 1, `row drag, ${say}: the line shows`)
  await p.keyboard.press('Escape'); await wait(250)
  check(await peek.count() === 1, `row drag, ${say}: Esc leaves the peek open`)
  check(await p.locator('.is-drop-before').count() === 0, `row drag, ${say}: and takes the line away`)
  await p.mouse.up(); await wait(1000)
  check(store().revision === revision && (await peek.count() === 0 || (await inside()).join() === was.join()), `row drag, ${say}: and letting go moves nothing`, [revision, store().revision])
  await prepare(); const bar = await box(inner('top').locator('.database-bar')), when = () => JSON.stringify(store().pages.find(x => x.id === 'top').values.when)
  const dated = when(); await p.mouse.move(bar.x + bar.width / 2, bar.y + bar.height / 2); await p.mouse.down(); await p.mouse.move(bar.x + bar.width / 2 + 60, bar.y + bar.height / 2, { steps: 5 }); await wait(150)
  await p.keyboard.press('Escape'); await wait(250)
  check(await peek.count() === 1, `a bar's drag, ${say}: Esc leaves the peek open`)
  await p.mouse.up(); await wait(1000)
  check(when() === dated, `a bar's drag, ${say}: and letting go moves nothing`, [dated, when()])
  check(new URL(p.url()).searchParams.get('peek') === 'other', `a bar's drag, ${say}: and opens nothing`, p.url())
  await prepare(); await p.keyboard.press('Escape'); await wait(400); if (caret && await peek.count()) { await p.keyboard.press('Escape'); await wait(300) }
  check(await peek.count() === 0, `with no drag, ${say}: Esc closes the peek as ever`)
  check(errors.length === 0, `${say}: no page errors`, errors)
  await c.close()
}
console.log(fails ? `${fails} FAILED` : 'ALL PASS')
await browser.close()
process.exit(fails ? 1 : 0)
