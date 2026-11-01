// B14: drag pages in the sidebar tree (task #138). Mouse in Chromium at 1280; a real touch sequence (CDP) at 1180.
// Usage: node drag.mjs <base> [webkit]   (a blank store, sign-in off; WebKit runs the mouse part only, no CDP touch)
import { chromium, webkit } from '/Users/dogrod/Developer/daythread/node_modules/playwright/index.mjs'
const base = process.argv[2]
let fail = 0; const ok = (v, s) => { console.log(v ? 'PASS' : 'FAIL', s); if (!v) fail++ }
const engine = process.argv[3] === 'webkit' ? webkit : chromium
const b = await engine.launch()
const device = async (extra = {}) => {
  const c = await b.newContext({ serviceWorkers: 'block', viewport: { width: 1280, height: 900 }, timezoneId: 'America/Vancouver', ...extra })
  const p = await c.newPage(); p.errors = []; p.on('pageerror', e => p.errors.push(e.message))
  p.moves = 0; p.on('request', r => { if (r.method() === 'POST' && (r.postData() ?? '').includes('move-page')) p.moves++ })
  return p
}
const open = async (p, path = '/') => { await p.goto(base + path); await p.locator('.sidebar .tree').first().waitFor({ timeout: 30000 }); await p.waitForLoadState('networkidle'); await p.waitForTimeout(500) }
const row = (p, title) => p.locator('.sidebar .tree-row[data-page]').filter({ has: p.locator('.tree-title', { hasText: new RegExp(`^${title}$`) }) })
const roots = p => p.locator('.sidebar [role=tree][aria-label=Pages] > li > .tree-row .tree-title').allTextContents()
const childrenOf = async (p, title) => { const id = await row(p, title).getAttribute('data-page'); return p.locator(`.sidebar li:has(> .tree-row[data-page="${id}"]) > ul > li > .tree-row .tree-title`).allTextContents() }
const toast = p => p.locator('.app-toasts [data-slot="toast"], .app-toasts [role="alert"], .app-toasts li').last()
const toastText = async p => { await p.waitForTimeout(600); const t = p.locator('.app-toasts'); return (await t.count()) ? (await t.first().textContent())?.trim() ?? '' : '' }
const clearToasts = async p => { for (const x of await p.locator('.app-toasts button[aria-label*="lose" i]').all()) await x.click().catch(() => {}); await p.waitForTimeout(300) }
const point = async (p, title, at) => { const r = await row(p, title).boundingBox(); return { x: r.x + r.width * 0.5, y: r.y + r.height * at } }
const mouseDrag = async (p, from, to, { escape = false } = {}) => {
  const a = await point(p, from, 0.5), z = typeof to === 'string' ? null : to
  await p.mouse.move(a.x, a.y); await p.mouse.down()
  const target = z ?? await point(p, to.split('@')[0], Number(to.split('@')[1] ?? 0.5))
  for (let i = 1; i <= 8; i++) { await p.mouse.move(a.x + (target.x - a.x) * i / 8, a.y + (target.y - a.y) * i / 8); await p.waitForTimeout(20) }
  if (escape) await p.keyboard.press('Escape')
  await p.mouse.up(); await p.waitForTimeout(700)
}
const newPage = async (p, title) => {
  await p.locator('.side-label-add').click(); await p.waitForURL(/focus=title|page=/)
  await p.waitForFunction(() => document.activeElement?.closest('.page-head')); await p.waitForTimeout(200)
  await p.keyboard.type(title, { delay: 10 }); await p.keyboard.press('Enter'); await p.waitForTimeout(700)
}

// ---------------------------------------------------------------- mouse
const m = await device()
await open(m)
for (const t of ['Alpha', 'Bravo', 'Charlie', 'Delta']) await newPage(m, t)
await open(m)
ok(JSON.stringify(await roots(m)) === '["Alpha","Bravo","Charlie","Delta"]', `four pages in order ${await roots(m)}`)

// 1. Reorder: Delta onto the top quarter of Bravo; a line, then "Moved" with Undo; kept after a reload.
await clearToasts(m)
const url = m.url()
{ const a = await point(m, 'Delta', 0.5), t = await point(m, 'Bravo', 0.1)
  await m.mouse.move(a.x, a.y); await m.mouse.down(); for (let i = 1; i <= 8; i++) await m.mouse.move(a.x + (t.x - a.x) * i / 8, a.y + (t.y - a.y) * i / 8)
  ok(await row(m, 'Bravo').getAttribute('data-drop-zone') === 'before', 'while dragging: Bravo shows the line before it')
  ok(await row(m, 'Delta').getAttribute('data-dragging') === 'mouse', 'while dragging: Delta is dimmed in place')
  await m.screenshot({ path: new URL('./mouse-line.png', import.meta.url).pathname, clip: { x: 0, y: 0, width: 300, height: 900 } })
  await m.mouse.up(); await m.waitForTimeout(800) }
ok(JSON.stringify(await roots(m)) === '["Alpha","Delta","Bravo","Charlie"]', `reorder applied ${await roots(m)}`)
ok(/^Moved(?! to)/.test(await toastText(m)), `reorder notice "Moved" (${await toastText(m)})`)
ok(m.url() === url, 'the release did not open the dragged page')
await open(m)
ok(JSON.stringify(await roots(m)) === '["Alpha","Delta","Bravo","Charlie"]', 'reorder kept after a reload')

// 2. Undo puts the order back.
await mouseDrag(m, 'Alpha', 'Charlie@0.9')
ok(JSON.stringify(await roots(m)) === '["Delta","Bravo","Charlie","Alpha"]', `after Charlie ${await roots(m)}`)
await m.locator('.app-toasts button', { hasText: 'Undo' }).last().click(); await m.waitForTimeout(800)
ok(JSON.stringify(await roots(m)) === '["Alpha","Delta","Bravo","Charlie"]', `Undo restored the order ${await roots(m)}`)
await clearToasts(m)

// 3. Inside another page: "Moved to Charlie", Charlie opens to show it.
await mouseDrag(m, 'Alpha', 'Charlie@0.5')
ok(JSON.stringify(await roots(m)) === '["Delta","Bravo","Charlie"]', `nested out of the top level ${await roots(m)}`)
ok(JSON.stringify(await childrenOf(m, 'Charlie')) === '["Alpha"]', `Charlie opened with Alpha inside ${await childrenOf(m, 'Charlie')}`)
ok((await toastText(m)).includes('Moved to Charlie'), `nest notice (${await toastText(m)})`)
await clearToasts(m)

// 4. Below an open page = first among its children; then into a day.
await mouseDrag(m, 'Delta', 'Charlie@0.9')
ok(JSON.stringify(await childrenOf(m, 'Charlie')) === '["Delta","Alpha"]', `below open Charlie = first child ${await childrenOf(m, 'Charlie')}`)
await clearToasts(m)
await mouseDrag(m, 'Bravo', 'Today@0.5')
ok((await toastText(m)).includes('Moved to Today'), `into Today (${await toastText(m)})`)
ok((await m.locator('.sidebar [role=tree][aria-label=Days] .tree-title', { hasText: 'Bravo' }).count()) === 1, 'Bravo listed under Today in Days')
await clearToasts(m)

// 5. Onto the "Pages" label: first at the top level, out of the day.
{ const a = await point(m, 'Bravo', 0.5), l = await m.locator('.side-label-row[data-drop-top]').boundingBox()
  await mouseDrag(m, 'Bravo', { x: l.x + 60, y: l.y + l.height / 2 }) }
ok(JSON.stringify(await roots(m)) === '["Bravo","Charlie"]', `Pages label = first at the top level ${await roots(m)}`)
ok((await toastText(m)).includes('Moved to top level'), `top-level notice (${await toastText(m)})`)
await clearToasts(m)

// 6. Where it already is, onto itself, into its own child, and Escape: no request, no notice, nothing moves.
const before = m.moves
await mouseDrag(m, 'Bravo', 'Charlie@0.1')          // just before its own next sibling
await mouseDrag(m, 'Charlie', 'Charlie@0.5')        // inside itself
await mouseDrag(m, 'Charlie', 'Alpha@0.5')          // inside its own child
ok(await row(m, 'Charlie').getAttribute('data-drop-zone') === null, 'no line left behind')
await mouseDrag(m, 'Bravo', 'Charlie@0.5', { escape: true })
ok(m.moves === before, `no move-page sent for the four (${m.moves - before})`)
ok((await toastText(m)) === '', `no notice (${await toastText(m)})`)
ok(JSON.stringify(await roots(m)) === '["Bravo","Charlie"]' && JSON.stringify(await childrenOf(m, 'Charlie')) === '["Delta","Alpha"]', 'nothing moved')

// 7. A day row can't be dragged.
const dayUrl = m.url()
await mouseDrag(m, 'Today', 'Bravo@0.1')
ok(m.moves === before, 'dragging Today sends nothing')

// 8. A stale sibling from a second tab: tab A still shows Delta under Charlie; tab B moves Delta to the top level end.
//    A drops Bravo "before Delta" (inside Charlie on A's screen): the server has moved on, so it is refused once as
//    Saved elsewhere and retried on fresh pages, where Delta is no sibling there: Bravo goes to the end of Charlie.
const other = await device()
await open(other)
if (await row(other, 'Charlie').locator('.disclose').getAttribute('aria-expanded') !== 'true') await row(other, 'Charlie').locator('.disclose').click()
await mouseDrag(other, 'Delta', 'Charlie@0.1')
ok(JSON.stringify(await roots(other)) === '["Bravo","Delta","Charlie"]', `tab B moved Delta out ${await roots(other)}`)
await clearToasts(m)
// Tab A has not refreshed: Delta still shows inside Charlie there.
const stale = JSON.stringify(await childrenOf(m, 'Charlie')) === '["Delta","Alpha"]'
ok(stale, 'tab A has not seen tab B\'s move')
await mouseDrag(m, 'Bravo', 'Delta@0.1')
ok((await toastText(m)).includes('Moved to Charlie'), `stale drop notice (${await toastText(m)})`)
await open(m)
const kids = await childrenOf(m, 'Charlie'), top = await roots(m)
ok(JSON.stringify(kids) === '["Alpha","Bravo"]' && JSON.stringify(top) === '["Delta","Charlie"]', `stale sibling: end of Charlie. Charlie ${JSON.stringify(kids)} top ${JSON.stringify(top)}`)
ok((await m.locator('.save-indicator, [role=status].failed, .save-failed').count()) === 0, 'no save-failed bar')
ok(!m.errors.length && !other.errors.length, `no page errors ${JSON.stringify([...m.errors, ...other.errors])}`)
await m.context().close(); await other.context().close()
if (engine === webkit) { await b.close(); console.log(fail ? `${fail} FAIL` : 'all pass (mouse, WebKit)'); process.exit(fail ? 1 : 0) }

// ---------------------------------------------------------------- touch (iPad-wide, a real touch sequence)
const t = await device({ viewport: { width: 1180, height: 820 }, hasTouch: true })
await open(t)
const cdp = await t.context().newCDPSession(t)
const touch = (type, pts) => cdp.send('Input.dispatchTouchEvent', { type, touchPoints: pts.map(q => ({ x: q.x, y: q.y })) })
const before2 = JSON.stringify(await roots(t))
console.log('     touch start order', before2)
// A quick swipe on a row: no drag, no move.
{ const a = await point(t, 'Charlie', 0.5); await touch('touchStart', [a]); for (let i = 1; i <= 6; i++) { await touch('touchMove', [{ x: a.x, y: a.y - i * 6 }]); await t.waitForTimeout(16) } await touch('touchEnd', []); await t.waitForTimeout(600) }
ok(JSON.stringify(await roots(t)) === before2 && t.moves === 0, 'a swipe moves nothing')
// Hold 500 ms, then drag Charlie above Delta: lifted row, a chip above the finger, then "Moved".
{ const a = await point(t, 'Charlie', 0.5), z = await point(t, 'Delta', 0.1)
  await touch('touchStart', [a]); await t.waitForTimeout(500)
  ok(await row(t, 'Charlie').getAttribute('data-dragging') === 'touch', 'after the hold: the row is lifted')
  for (let i = 1; i <= 8; i++) { await touch('touchMove', [{ x: a.x + (z.x - a.x) * i / 8, y: a.y + (z.y - a.y) * i / 8 }]); await t.waitForTimeout(20) }
  const chip = await t.locator('.tree-drag-chip').boundingBox()
  ok(Boolean(chip) && chip.y + chip.height <= z.y - 20, `title chip rides above the finger (${chip && Math.round(chip.y + chip.height)} vs ${Math.round(z.y)})`)
  ok(await row(t, 'Delta').getAttribute('data-drop-zone') === 'before', 'line before Delta')
  await t.screenshot({ path: new URL('./touch-chip.png', import.meta.url).pathname, clip: { x: 0, y: 0, width: 320, height: 820 } })
  await touch('touchEnd', []); await t.waitForTimeout(800) }
ok(JSON.stringify(await roots(t)) === '["Charlie","Delta"]', `touch reorder: Charlie above the first row ${await roots(t)}`)
ok(/Moved/.test(await toastText(t)), `touch notice (${await toastText(t)})`)
ok((await t.locator('.tree-drag-chip').count()) === 0, 'chip gone after the drop')
ok(!t.errors.length, `no page errors ${JSON.stringify(t.errors)}`)
await b.close(); console.log(fail ? `${fail} FAIL` : 'all pass'); process.exit(fail ? 1 : 0)
