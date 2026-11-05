// R4-1: the Timeline's table scrolls on its own past 60% of the width, with Name staying and head, rows and foot in step, the bars left alone. With the table closed, a row still moves up and down by a handle, with one Undo; not on a sorted view.
// Usage: node tests/evidence/timeline/pane.mjs <base-url> <store-path> [chromium|webkit] [shots-dir]  (a throwaway store the server uses, never his data)
import * as pw from '@playwright/test'
import { execSync } from 'node:child_process'
const [base, S, engine = 'chromium', shots] = process.argv.slice(2)
if (!base || !S) { console.error('Usage: node tests/evidence/timeline/pane.mjs <base-url> <store-path> [chromium|webkit] [shots-dir]'); process.exit(2) }
const browser = await pw[engine].launch({ headless: true })
let fails = 0
const check = (ok, what, extra) => { if (!ok) fails++; console.log(ok ? 'PASS' : 'FAIL', what, extra === undefined ? '' : JSON.stringify(extra)) }
const open = async (arg = '') => {
  execSync(`rm -f ${S} ${S}-wal ${S}-shm && node --no-warnings tests/evidence/timeline/seed-pane.ts ${S} ${arg}`, { stdio: 'ignore' })
  const c = await browser.newContext({ viewport: { width: 1280, height: 760 }, serviceWorkers: 'block' }), p = await c.newPage(), errors = []
  p.on('pageerror', e => { if (!/access control checks|ResizeObserver/.test(e.message)) errors.push(e.message) })
  await p.goto(`${base}/pages?page=plan`); await p.waitForTimeout(2300)
  return { c, p, errors, wait: ms => p.waitForTimeout(ms) }
}
const lane = (p, id) => p.locator(`.database-bar-lane[data-row="${id}"]`)
const order = p => p.locator('.database-bar-lane[data-row]').evaluateAll(l => l.map(e => e.dataset.row))
const store = () => JSON.parse(execSync(`sqlite3 ${S} "select data from workspace"`, { maxBuffer: 1 << 26 }).toString())
const notices = p => p.locator('[role=alert], [role=status]').allInnerTexts().then(t => t.join(' | ').replace(/\s+/g, ' '))
const middle = b => [b.x + b.width / 2, b.y + b.height / 2]

{ const { c, p, errors, wait } = await open()
  // Closed: the handle.
  const before = await order(p)
  check(await p.locator('.database-pane').count() === 0, 'the table starts closed')
  await lane(p, 'b').hover(); await wait(150)
  const grip = lane(p, 'b').locator('.database-pane-handle')
  check(await grip.evaluate(e => getComputedStyle(e).opacity) === '1', 'hovering a line shows its handle, with the table closed')
  if (shots) await p.screenshot({ path: `${shots}/${engine}-closed.png` })
  const box = await grip.boundingBox(), scale = await p.locator('.database-timeline').boundingBox()
  check(Math.abs(box.x - scale.x) < 8, 'at the left of what is in view', [box.x, scale.x])
  await p.locator('.database-timeline').evaluate(e => { e.scrollLeft += 300 }); await wait(250)
  const after = await grip.boundingBox()
  check(Math.abs(after.x - box.x) < 2, 'and it stays there when the bars scroll', [box.x, after.x])
  await p.locator('.database-timeline').evaluate(e => { e.scrollLeft -= 300 }); await wait(250)
  const under = await lane(p, 'a').boundingBox(), start = await grip.boundingBox()
  await p.mouse.move(...middle(start)); await p.mouse.down(); await p.mouse.move(start.x + 2, under.y + 4, { steps: 5 }); await wait(150)
  check(await lane(p, 'a').evaluate(e => e.classList.contains('is-drop-before')), 'dragging shows where it would land')
  await p.mouse.up(); await wait(1500)
  check((await order(p)).indexOf('b') < (await order(p)).indexOf('a'), 'and letting go moves the row', await order(p))
  await p.getByRole('button', { name: 'Undo' }).first().click(); await wait(1500)
  check((await order(p)).join() === before.join(), 'one Undo puts it back', await order(p))
  // A bar isn't taken by the handle, and still opens and drags.
  const barBox = await lane(p, 'b').locator('.database-bar').boundingBox()
  check(barBox.x > start.x + start.width, 'a bar in the middle is clear of the handle', [barBox.x, start.x])
  // A row whose bar is off to the side keeps its way to it, clear of the handle.
  const off = lane(p, 'far').locator('.database-bar-off')
  await lane(p, 'far').hover(); await wait(150)
  check(await off.count() === 1, 'a bar far off still has its jump')
  check(errors.length === 0, 'closed: no page errors', errors)
  // Open: every column, and scrolling.
  await p.locator('.database-timeline-toggle').click(); await wait(700)
  const heads = await p.locator('.database-pane-head .database-pane-track > span').allInnerTexts()
  check(heads.length === 7 && await lane(p, 'a').locator('.database-pane-columns .database-pane-cell').count() === 7, 'open: every column is there', heads)
  const pane = await lane(p, 'a').locator('.database-pane').boundingBox(), full = await p.locator('.database-timeline').boundingBox()
  check(pane.width <= full.width * 0.6 + 1, 'and the table leaves the bars their room', [pane.width, full.width])
  check(await p.locator('.database-timeline.has-pane-more').count() === 1, 'a fade says there is more')
  if (shots) await p.screenshot({ path: `${shots}/${engine}-open.png` })
  const place = () => p.evaluate(() => { const x = s => document.querySelector(s).getBoundingClientRect().x; const row = document.querySelector('.database-bar-lane[data-row="a"]'); const cells = row.querySelectorAll('.database-pane-columns .database-pane-cell'), heads = document.querySelectorAll('.database-pane-head .database-pane-track > span'); return { name: row.querySelector('.database-pane-name').getBoundingClientRect().x, cell: cells[2].getBoundingClientRect().x, head: heads[2].getBoundingClientRect().x, other: document.querySelector('.database-bar-lane[data-row="b"] .database-pane-columns').children[0].children[2].getBoundingClientRect().x, scroll: document.querySelector('.database-timeline').scrollLeft, bar: document.querySelector('.database-bar').getBoundingClientRect().x } })
  const inLane = async id => { const l = await lane(p, id).boundingBox(), o = await lane(p, id).locator('.database-bar-off').first().boundingBox(); return o && o.y >= l.y - 1 && o.y + o.height <= l.y + l.height + 1 }
  check(await inLane('far'), "a row's jump to its bar off-screen stays on the row's own line")
  check(await lane(p, 'far').evaluate(l => l.getBoundingClientRect().height) === 36 && await p.locator('.database-new').first().evaluate((n, far) => n.getBoundingClientRect().top - far < 60, (await lane(p, 'far').boundingBox()).y + 36), 'and adds no line under it')
  const a = await place()
  // A sideways scroll over the table.
  await lane(p, 'a').locator('.database-pane-name').hover(); await p.mouse.wheel(150, 0); await wait(300)
  const b = await place()
  check(b.cell < a.cell - 100, 'a sideways scroll over the table moves its columns', [a.cell, b.cell])
  check(b.name === a.name, 'Name stays')
  check(b.head === b.cell && b.other === b.cell, 'head and rows stay in step', [b.head, b.cell, b.other])
  check(b.scroll === a.scroll && b.bar === a.bar, 'and the bars stay where they were', [a.scroll, b.scroll])
  if (shots) await p.screenshot({ path: `${shots}/${engine}-scrolled.png` })
  // Over the bars, the bars scroll.
  await lane(p, 'a').locator('.database-bar').hover(); await p.mouse.wheel(120, 0); await wait(300)
  const d = await place()
  check(d.scroll > b.scroll && d.cell === b.cell, 'a sideways scroll over the bars moves the bars, not the columns', [b.scroll, d.scroll])
  await p.locator('.database-timeline').evaluate(e => { e.scrollLeft -= 120 }); await wait(200)
  // The end, and the fade going.
  await p.locator('.database-pane-bar').evaluate(e => { e.scrollLeft = e.scrollWidth }); await wait(250)
  check(await p.locator('.database-timeline.has-pane-more').count() === 0, 'at the end of the columns the fade goes')
  const last = await lane(p, 'a').locator('.database-pane-columns .database-pane-cell').last().boundingBox(), box2 = await lane(p, 'a').locator('.database-pane-columns').boundingBox()
  check(Math.abs(last.x + last.width - (box2.x + box2.width)) <= 2, 'and the last column ends at its edge', [last.x + last.width, box2.x + box2.width])
  // A key brings a cell into sight.
  await lane(p, 'a').locator('.database-pane-columns .database-pane-cell').first().focus(); await wait(250)
  const first = await lane(p, 'a').locator('.database-pane-columns .database-pane-cell').first().boundingBox(), box3 = await lane(p, 'a').locator('.database-pane-columns').boundingBox()
  check(first.x >= box3.x - 1, 'a cell reached by a key comes into sight', [first.x, box3.x])
  // Editing a scrolled column.
  await p.locator('.database-pane-bar').evaluate(e => { e.scrollLeft = e.scrollWidth }); await wait(250)
  await lane(p, 'a').locator('.database-pane-columns .database-pane-cell').last().click(); await wait(350)
  await p.keyboard.press('Meta+a'); await p.keyboard.type('Edited far along'); await p.keyboard.press('Enter'); await wait(1300)
  check(store().pages.find(x => x.id === 'a').values.seven === 'Edited far along', 'a tap on a scrolled column edits that column', store().pages.find(x => x.id === 'a').values.seven)
  const shown = await lane(p, 'a').locator('.database-pane-columns .database-pane-cell').last().innerText()
  check(shown.trim() === 'Edited far along', 'and it shows there', shown)
  // The handle with the table open is where it was.
  check(await lane(p, 'a').locator('.database-lane-grip').count() === 0 && await lane(p, 'a').locator('.database-pane > .database-pane-handle').count() === 1, 'with the table open, the handle is in the table')
  check(errors.length === 0, 'open: no page errors', errors)
  await c.close() }
{ const { c, p, errors } = await open('sorted')
  await lane(p, 'b').hover(); await p.waitForTimeout(150)
  check(await p.locator('.database-pane-handle').count() === 0, 'a sorted view has no handle, closed or open', await p.locator('.database-pane-handle').count())
  check(errors.length === 0, 'sorted: no page errors', errors)
  await c.close() }
console.log(fails ? `${fails} FAILED` : 'ALL PASS')
await browser.close()
process.exit(fails ? 1 : 0)
