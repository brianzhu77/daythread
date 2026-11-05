// R4-5's arrows on a Timeline in the built app: from a blocker's bar to the blocked one, doubling back on an overlap, going with a drag, none at 390 or with dependencies off. A drag from a bar's dot links two rows, with one Undo; a loop is refused with its reason.
// Usage: node tests/evidence/timeline/arrows.mjs <base-url> <store-path> [chromium|webkit] [shots-dir]  (a throwaway store the server uses, never his data)
import * as pw from '@playwright/test'
import { execSync } from 'node:child_process'
const [base, S, engine = 'chromium', shots] = process.argv.slice(2)
if (!base || !S) { console.error('Usage: node tests/evidence/timeline/arrows.mjs <base-url> <store-path> [chromium|webkit] [shots-dir]'); process.exit(2) }
const seed = (arg = '') => execSync(`rm -f ${S} ${S}-wal ${S}-shm && node --no-warnings tests/evidence/timeline/seed-arrows.ts ${S} ${arg}`, { stdio: 'ignore' })
const store = () => JSON.parse(execSync(`sqlite3 ${S} "select data from workspace"`, { maxBuffer: 1 << 26 }).toString())
const row = id => store().pages.find(p => p.id === id)
const browser = await pw[engine].launch({ headless: true })
let fails = 0
const check = (ok, what, extra) => { if (!ok) fails++; console.log(ok ? 'PASS' : 'FAIL', what, extra === undefined ? '' : JSON.stringify(extra)) }
const open = async ({ arg = '', width = 1280, scheme = 'light' } = {}) => {
  seed(arg)
  const c = await browser.newContext({ viewport: { width, height: 800 }, colorScheme: scheme, serviceWorkers: 'block', ...(width < 500 ? { hasTouch: true } : {}) }), p = await c.newPage(), errors = []
  p.on('pageerror', e => { if (!/access control checks|ResizeObserver/.test(e.message)) errors.push(e.message) })
  await p.goto(`${base}/pages?page=plan`); await p.waitForTimeout(2500)
  return { c, p, errors, wait: ms => p.waitForTimeout(ms) }
}
const links = p => p.locator('.database-link').evaluateAll(l => l.map(g => `${g.dataset.from}>${g.dataset.to}`).sort())
const bar = (p, id) => p.locator(`.database-bar-lane[data-row="${id}"] .database-bar`)
const notices = p => p.locator('[role=alert], [role=status]').allInnerTexts().then(t => t.join(' | ').replace(/\s+/g, ' '))
// Where an arrow's first and last points are, on screen.
const ends = (p, from, to) => p.evaluate(([from, to]) => {
  const path = document.querySelector(`.database-link[data-from="${from}"][data-to="${to}"] path`)
  const a = path.getPointAtLength(0), b = path.getPointAtLength(path.getTotalLength()), m = path.getScreenCTM()
  return { a: [a.x + m.e, a.y + m.f], b: [b.x + m.e, b.y + m.f] }
}, [from, to])
const middle = box => [box.x + box.width / 2, box.y + box.height / 2]
const close = (a, b, by = 2) => Math.abs(a - b) <= by
const dotOf = async (p, id, side) => { const box = await bar(p, id).boundingBox(); await p.mouse.move(...middle(box)); await p.waitForTimeout(150); return side === 'end' ? [box.x + box.width + 8, box.y + box.height / 2] : [box.x - 8, box.y + box.height / 2] }
const dragTo = async (p, from, to) => { await p.mouse.move(...from); await p.mouse.down(); await p.mouse.move(from[0] + 6, from[1] + 6); await p.waitForTimeout(80); await p.mouse.move(...to, { steps: 6 }); await p.waitForTimeout(150) }

{ const { c, p, errors, wait } = await open()
  check((await links(p)).join() === 'design>build,build>ship,design>clash,ship>far'.split(',').sort().join(), 'an arrow for each link between rows on the scale; none to a row with no date', await links(p))
  const design = await bar(p, 'design').boundingBox(), build = await bar(p, 'build').boundingBox()
  const e = await ends(p, 'design', 'build')
  check(close(e.a[0], design.x + design.width) && close(e.a[1], design.y + design.height / 2), 'it leaves the end of the blocker', [e.a, design])
  check(close(e.b[0], build.x) && close(e.b[1], build.y + build.height / 2), 'and reaches the start of what it blocks', [e.b, build])
  const clash = await p.locator('.database-link[data-to="clash"] path').first().getAttribute('d'), bendsBack = await p.evaluate(() => { const path = document.querySelector('.database-link[data-to="clash"] path'), l = path.getTotalLength(); let min = Infinity; for (let i = 0; i <= 40; i++) min = Math.min(min, path.getPointAtLength(l * i / 40).x); return min < path.getPointAtLength(l).x })
  check(bendsBack, 'a blocked bar that starts too soon: the arrow doubles back to reach its start', clash)
  const hit = await p.evaluate(() => getComputedStyle(document.querySelector('.database-links')).pointerEvents)
  check(hit === 'none', 'the arrows take no clicks')
  const under = await p.evaluate(() => { const svg = document.querySelector('.database-links'), lane = document.querySelector('.database-bar-lane'); return Boolean(svg.compareDocumentPosition(lane) & Node.DOCUMENT_POSITION_FOLLOWING) })
  check(under, 'they draw under the bars')
  if (shots) await p.screenshot({ path: `${shots}/${engine}-arrows.png` })
  // Hover
  await p.mouse.move(...middle(design)); await wait(150)
  check(await p.locator('.database-link.is-hot').count() === 2, 'a bar under the pointer darkens its own arrows')
  check(await bar(p, 'design').locator('.database-bar-dot.is-end').evaluate(e => getComputedStyle(e).opacity) === '1', 'and shows its dots')
  if (shots) await p.screenshot({ path: `${shots}/${engine}-hover.png` })
  const offLabel = await p.locator('.database-bar-lane[data-row="far"] .database-bar-off').evaluate(e => getComputedStyle(e).backgroundColor)
  check(offLabel !== 'rgba(0, 0, 0, 0)', "a line to a bar off-screen goes behind that row's name", offLabel)
  // Far off: the path stays within what a page can draw.
  const far = await p.locator('.database-link[data-to="far"] path').first().getAttribute('d')
  const biggest = Math.max(...[...far.matchAll(/\d+(?:\.\d+)?/g)].map(m => Number(m[0]))), scrollW = await p.locator('.database-timeline').evaluate(e => e.scrollLeft + e.clientWidth)
  check(biggest <= scrollW + 1000, "a bar far off: the line runs to the edge of what's drawn", [biggest, scrollW])
  check(await p.locator('.database-link[data-to="far"] .database-link-head').count() === 0, 'with no head out there')
  // A click on a dot opens nothing; on a bar it opens the row.
  const dot = await dotOf(p, 'loose', 'end'); await p.mouse.click(...dot); await wait(400)
  check(!p.url().includes('peek') && await p.locator('.peek').count() === 0, 'a click on a dot opens nothing', p.url())
  check(errors.length === 0, 'no page errors', errors)
  await c.close() }

// A drag: the arrow goes with the bar, the chain follows on the drop, and one Undo returns them.
{ const { c, p, errors, wait } = await open()
  const box = await bar(p, 'design').boundingBox(), before = await ends(p, 'design', 'build'), width = (await p.locator('.database-scale-tick').nth(1).boundingBox()).x - (await p.locator('.database-scale-tick').nth(0).boundingBox()).x
  await p.mouse.move(...middle(box)); await p.mouse.down(); await p.mouse.move(box.x + box.width / 2 + 10, box.y + box.height / 2); await p.mouse.move(box.x + box.width / 2 + width * 4, box.y + box.height / 2, { steps: 6 }); await wait(250)
  const during = await ends(p, 'design', 'build')
  check(during.a[0] > before.a[0] + width * 3, 'the arrow goes with a bar while it moves', [before.a[0], during.a[0]])
  check(await p.locator('.database-bar-dot').count() === 0, "no dots while it's moving")
  await p.mouse.up(); await wait(1600)
  check(/moved/.test(await notices(p)), 'the chain follows on the drop, and the notice says so', await notices(p))
  await p.getByRole('button', { name: 'Undo' }).first().click(); await wait(1500)
  const again = await ends(p, 'design', 'build')
  check(close(again.a[0], before.a[0]), 'one Undo puts it back, with its arrow', [again.a[0], before.a[0]])
  check(errors.length === 0, 'no page errors', errors)
  await c.close() }

// Linking by a dot.
{ const { c, p, errors, wait } = await open()
  const from = await dotOf(p, 'loose', 'end'), target = await bar(p, 'ship').boundingBox()
  await dragTo(p, from, middle(target))
  check(await p.locator('.database-link-draft').count() === 1, 'a dashed line follows the pointer')
  check(await bar(p, 'ship').evaluate(e => e.classList.contains('is-link-target')), 'and the bar under it says so')
  if (shots) await p.screenshot({ path: `${shots}/${engine}-linking.png` })
  await p.mouse.up(); await wait(1600)
  check((await links(p)).includes('loose>ship'), "from a bar's end: this blocks that, with an arrow", await links(p))
  check(JSON.stringify(row('ship').values.by) === JSON.stringify(['build', 'loose']) && row('loose').values.blocks?.includes('ship'), 'both sides of the relation are in the store', [row('ship').values.by, row('loose').values.blocks])
  check(/Ship is blocked by On its own/.test(await notices(p)), 'and the notice says who', await notices(p))
  await p.getByRole('button', { name: 'Undo' }).first().click(); await wait(1500)
  check(!(await links(p)).includes('loose>ship') && !row('ship').values.by.includes('loose') && !(row('loose').values.blocks ?? []).includes('ship'), 'one Undo takes it out, both sides', [row('ship').values.by])
  // From a bar's start: that blocks this.
  const start = await dotOf(p, 'loose', 'start'), other = await bar(p, 'design').boundingBox()
  await dragTo(p, start, middle(other)); await p.mouse.up(); await wait(1600)
  check((await links(p)).includes('design>loose') && row('loose').values.by?.includes('design'), "from a bar's start: that blocks this", await links(p))
  // Already linked.
  const again = await dotOf(p, 'design', 'end'), loose = await bar(p, 'loose').boundingBox()
  await dragTo(p, again, middle(loose)); await p.mouse.up(); await wait(600)
  check(/Already linked/.test(await notices(p)) && row('loose').values.by.length === 1, 'the same link again says so and changes nothing', await notices(p))
  // A loop.
  const back = await dotOf(p, 'ship', 'end'), design = await bar(p, 'design').boundingBox()
  await dragTo(p, back, middle(design)); await p.mouse.up(); await wait(1600)
  check(/make a loop/.test(await notices(p)) && !/not saved/.test(await notices(p)), 'a loop is refused, with the reason, and no Retry', await notices(p))
  check(!(row('design').values.by ?? []).includes('ship') && !(await links(p)).includes('ship>design'), 'and nothing changes', row('design').values.by)
  // Esc, and letting go on nothing.
  await p.reload(); await wait(2500)
  const beforeLinks = await links(p), d1 = await dotOf(p, 'loose', 'end'), ship = await bar(p, 'ship').boundingBox()
  await dragTo(p, d1, middle(ship)); await p.keyboard.press('Escape'); await wait(200)
  check(await p.locator('.database-link-draft').count() === 0, 'Esc lets it go'); await p.mouse.up(); await wait(1000)
  check((await links(p)).join() === beforeLinks.join(), 'and nothing changes')
  const d2 = await dotOf(p, 'loose', 'end'); await dragTo(p, d2, [d2[0] + 150, d2[1] + 90]); await p.mouse.up(); await wait(1000)
  check((await links(p)).join() === beforeLinks.join(), 'letting go on nothing changes nothing')
  const self = await dotOf(p, 'loose', 'end'), own = await bar(p, 'loose').boundingBox(); await dragTo(p, self, middle(own)); await p.mouse.up(); await wait(800)
  check((await links(p)).join() === beforeLinks.join() && await p.locator('.peek').count() === 0, 'letting go on its own bar changes nothing, and opens nothing')
  check(errors.length === 0, 'no page errors', errors)
  await c.close() }

// A dependency mode, table open, group, filter, dark, off, 390.
{ const { c, p, errors, wait } = await open()
  await p.locator('.database-timeline-toggle').click(); await wait(600)
  const pane = await p.locator('.database-pane').first().boundingBox(), e = await ends(p, 'design', 'build'), design = await bar(p, 'design').boundingBox()
  check(close(e.a[0], design.x + design.width), 'with the table open, an arrow still meets its bar', [e.a[0], design])
  const z = await p.evaluate(() => { const pane = document.querySelector('.database-bar-lane .database-pane'); return Number(getComputedStyle(pane).zIndex) })
  check(z >= 1, 'and the table sits over any line that runs under it', z)
  if (shots) await p.screenshot({ path: `${shots}/${engine}-table.png` })
  await p.locator('.database-timeline-toggle').click(); await wait(400)
  check(errors.length === 0 && pane.width > 0, 'no page errors', errors)
  await c.close() }
// Groups: arrows cross them, each meets its bar, and folding one takes its arrows away.
{ const { c, p, errors, wait } = await open({ arg: 'group' })
  check((await links(p)).includes('build>ship') && (await links(p)).includes('design>build'), 'in groups, an arrow crosses from one to another', await links(p))
  const e = await ends(p, 'build', 'ship'), ship = await bar(p, 'ship').boundingBox()
  check(close(e.b[0], ship.x) && close(e.b[1], ship.y + ship.height / 2), 'and meets its bar on the right line', [e.b, ship])
  if (shots) await p.screenshot({ path: `${shots}/${engine}-groups.png` })
  await p.locator('.database-group-fold').first().click(); await wait(500)
  const after = await links(p)
  check(!after.some(l => l.includes('design') || l.includes('build')), 'a folded group has no arrows, and nothing else breaks', after)
  check(errors.length === 0, 'groups: no page errors', errors)
  await c.close() }
// A filter hides a row: no arrow to or from it.
{ const { c, p, errors } = await open({ arg: 'filter' })
  check((await links(p)).join() === 'design>build', "a row a filter hides has no arrow", await links(p))
  check(errors.length === 0, 'filter: no page errors', errors)
  await c.close() }
{ const { c, p } = await open({ scheme: 'dark' })
  const colour = await p.locator('.database-link path').first().evaluate(e => getComputedStyle(e).stroke)
  check(/rgb/.test(colour), 'dark: arrows take the theme', colour)
  if (shots) await p.screenshot({ path: `${shots}/${engine}-dark.png` })
  await c.close() }
{ const { c, p } = await open({ arg: 'off' })
  check(await p.locator('.database-links').count() === 0 && await p.locator('.database-bar').count() > 0, 'dependencies off: no arrows')
  const box = await bar(p, 'design').boundingBox(); await p.mouse.move(...middle(box)); await p.waitForTimeout(150)
  check(await p.locator('.database-bar-dot').count() === 0, 'and no dots')
  await c.close() }
{ const { c, p, errors } = await open({ width: 390 })
  check(await p.locator('.database-links').count() === 0 && await p.locator('.database-week-row').count() > 0, '390: a list by week, with no arrows', await p.locator('.database-week-row').count())
  check(errors.length === 0, '390: no page errors', errors)
  await c.close() }
console.log(fails ? `${fails} FAILED` : 'ALL PASS')
await browser.close()
process.exit(fails ? 1 : 0)
