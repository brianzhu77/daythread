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
console.log(fails ? `${fails} FAILED` : 'ALL PASS')
await browser.close()
process.exit(fails ? 1 : 0)
