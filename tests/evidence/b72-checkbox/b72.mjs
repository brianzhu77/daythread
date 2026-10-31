// B72 slowed-save replay. Usage: node b72.mjs <baseUrl> [label]. Seeds sample data in a fresh SQLite workspace.
import { chromium, webkit } from '/Users/dogrod/Developer/daythread/node_modules/playwright/index.mjs'
const base = process.argv[2], label = process.argv[3] ?? base
const SLOW = 1000
let fail = 0; const ok = (v, s) => { console.log(v ? 'PASS' : 'FAIL', `[${label}]`, s); if (!v) fail++ }

async function open(br, width, height) {
  const b = await br.launch()
  const ctx = await b.newContext({ serviceWorkers: 'block', viewport: { width, height }, ...(width === 390 ? { isMobile: true, hasTouch: true } : {}) })
  const p = await ctx.newPage()
  const writes = []; let mode = 'slow'
  p.on('pageerror', e => { if (!/access control checks/.test(e.message)) console.log('pageerror', e.message) })
  await p.route('**/_serverFn/**', async route => {
    const req = route.request()
    if (req.method() !== 'POST') return route.continue()
    const body = req.postData() ?? ''
    const status = body.match(/"s":"task-status"\},\{"t":1,"s":"[^"]+"\},\{"t":1,"s":"(\w+)"/)?.[1]
    if (status) writes.push(status)
    if (mode !== 'fast') await new Promise(r => setTimeout(r, SLOW))
    if (status && mode === 'fail') return route.fulfill({ status: 503, body: 'down' })
    return route.continue()
  })
  return { b, p, writes, setMode: m => { mode = m } }
}

const tap = async (p, loc, touch) => (touch ? loc.tap() : loc.click())

// ONLY=webkit|chromium runs one pass. A production build has no Add sample data: seed a copy on a dev build first, then
// run each pass with SKIP_SEED=1 against its own fresh copy.
const passes = [['webkit', webkit, 390, 844], ['chromium', chromium, 1280, 900]].filter(([n]) => !process.env.ONLY || n === process.env.ONLY)
for (const [name, br, width, height] of passes) {
  const touch = width === 390
  const { b, p, writes, setMode } = await open(br, width, height)
  await p.goto(`${base}/`)
  if (!process.env.SKIP_SEED) {
    setMode('fast')
    await p.locator('details.banner summary').click(); await p.getByRole('button', { name: 'Add sample data' }).click()
    await p.getByText('Sample data added').waitFor()
    setMode('slow')
  }
  // 1. Day page: double tap = one Done write, ticked at once.
  // Let the page settle first: once in 3 dev-server runs WebKit logged 'Importing a module script failed' right after
  // this navigation and the first tap was lost. With networkidle, 3 of 3 reruns passed.
  await p.goto(`${base}/`); await p.waitForSelector('.editor-task[data-status=open] input'); await p.waitForLoadState('networkidle')
  const blockId = await p.locator('.editor-task[data-status=open]').first().evaluate(el => el.closest('[data-id]').dataset.id)
  const box = p.locator(`[data-id="${blockId}"] .editor-task input`).first()
  writes.length = 0
  await tap(p, box, touch); await p.waitForTimeout(150)
  ok(await box.isChecked(), `${name} ${width} day page: ticked at once, before the save answers`)
  const title = p.locator(`[data-id="${blockId}"] .editor-task-title`).first()
  ok(/task-done/.test(await title.getAttribute('class')), `${name} ${width} day page: struck through at once`)
  await tap(p, box, touch); await p.waitForTimeout(SLOW + 800)
  ok(writes.length === 1 && writes[0] === 'done', `${name} ${width} day page double tap: one Done write (${JSON.stringify(writes)})`)
  ok(await box.isChecked(), `${name} ${width} day page double tap: box ticked after the save`)
  // 2. Deliberate untick after the answer still works.
  writes.length = 0
  await tap(p, box, touch); await p.waitForTimeout(SLOW + 800)
  ok(writes.length === 1 && writes[0] === 'open' && !(await box.isChecked()), `${name} ${width} day page: a tap after the answer reopens on purpose (${JSON.stringify(writes)})`)
  // 3. Forced failure reverts.
  setMode('fail'); writes.length = 0
  await tap(p, box, touch); await p.waitForTimeout(100)
  const tickedDuring = await box.isChecked()
  await p.waitForTimeout(SLOW + 1500)
  ok(tickedDuring && !(await box.isChecked()), `${name} ${width} failed save: ticked at once, then reverted (${JSON.stringify(writes)})`)
  ok(await p.getByRole('button', { name: 'Retry' }).first().isVisible(), `${name} ${width} failed save: the usual error with Retry shows`)
  setMode('slow')
  // 4. Tasks screen (Today): a double tap across the save boundary ticks only that row; the neighbour stays open.
  await p.goto(`${base}/tasks?view=today`); await p.waitForSelector('.task-row.list input.check')
  const rows = p.locator('.task-row.list')
  const before = await rows.evaluateAll(rs => rs.map(r => ({ id: r.dataset.taskId, title: r.querySelector('.task-title')?.textContent })))
  ok(before.length >= 2, `${name} ${width} tasks: ${before.length} rows to start`)
  const first = rows.first().locator('input.check'); const bb = await first.boundingBox()
  const at = async () => (touch ? p.touchscreen.tap(bb.x + bb.width / 2, bb.y + bb.height / 2) : p.mouse.click(bb.x + bb.width / 2, bb.y + bb.height / 2))
  writes.length = 0
  await at(); await p.waitForTimeout(150)
  ok(await first.isChecked() && /is-done/.test(await rows.first().getAttribute('class')), `${name} ${width} tasks: first row ticked and greyed at once`)
  await at() // fast second tap, ignored
  await p.waitForTimeout(SLOW + 100) // the save has just answered
  await at() // a third tap at the same spot, just after the answer
  await p.waitForTimeout(SLOW + 2200)
  const after = await rows.evaluateAll(rs => rs.map(r => r.dataset.taskId))
  ok(after.includes(before[1].id), `${name} ${width} tasks: the neighbour "${before[1].title}" is still open (writes ${JSON.stringify(writes)})`)
  ok(writes[0] === 'done' && writes.filter(w => w === 'done').length === 1, `${name} ${width} tasks: one Done write; a tap in the hold toggles as normal (writes ${JSON.stringify(writes)})`)
  // 5. Retry (Ratchet 4bae2184): a retried tick gets the same at-once tick, guard and hold as a tap.
  await p.goto(`${base}/tasks?view=today`); await p.waitForSelector('.task-row.list input.check'); await p.waitForLoadState('networkidle')
  const start = await rows.evaluateAll(rs => rs.map(r => ({ id: r.dataset.taskId, title: r.querySelector('.task-title')?.textContent })))
  const target = p.locator(`.task-row.list[data-task-id="${start[0].id}"] input.check`)
  const tb = await target.boundingBox()
  const atTarget = async () => (touch ? p.touchscreen.tap(tb.x + tb.width / 2, tb.y + tb.height / 2) : p.mouse.click(tb.x + tb.width / 2, tb.y + tb.height / 2))
  setMode('fail'); writes.length = 0
  await atTarget(); await p.waitForTimeout(SLOW + 1500)
  ok(!(await target.isChecked()), `${name} ${width} retry: the failed tick reverted first`)
  setMode('slow')
  await p.getByRole('button', { name: 'Retry' }).first().click(); await p.waitForTimeout(150)
  ok(await target.isChecked(), `${name} ${width} retry: ticked at once while the retry saves`)
  await atTarget(); await p.waitForTimeout(SLOW + 300)
  ok(await target.count() === 1 && await target.isChecked(), `${name} ${width} retry: the row holds, ticked, after the answer`)
  await p.waitForTimeout(1500)
  const end = await rows.evaluateAll(rs => rs.map(r => r.dataset.taskId))
  ok(!end.includes(start[0].id) && end.includes(start[1].id), `${name} ${width} retry: the row leaves after the hold; the neighbour "${start[1].title}" stays`)
  ok(JSON.stringify(writes) === '["done","done"]', `${name} ${width} retry: the failed write, then one retry; the tap during it is ignored (${JSON.stringify(writes)})`)
  await b.close()
}
process.exitCode = fail ? 1 : 0
