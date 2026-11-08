// The day page's touch gestures at 390, after Brian's drag report (B90): each one does what it says and nothing else.
// Chromium with real touch events (CDP), as WebKit headless has taps only. Usage: node tests/evidence/touch-sweep/sweep.mjs <base-url> <store-path>
import * as pw from '@playwright/test'
import { execSync } from 'node:child_process'
const [base, S] = process.argv.slice(2)
if (!base || !S) { console.error('Usage: node tests/evidence/touch-sweep/sweep.mjs <base-url> <store-path>'); process.exit(2) }
const today = new Date().toLocaleDateString('en-CA')
const doc = () => JSON.parse(JSON.parse(execSync(`sqlite3 ${S} "select data from workspace"`, { maxBuffer: 1 << 26 }).toString()).pages.find(p => p.id === `day:${today}`).document)
const tasks = () => JSON.parse(execSync(`sqlite3 ${S} "select data from workspace"`, { maxBuffer: 1 << 26 }).toString()).tasks
const order = () => doc().map(n => n.id).join(',')
const wait = ms => new Promise(r => setTimeout(r, ms))
const browser = await pw.chromium.launch({ headless: true })
const results = []
const check = async (name, act) => {
  execSync(`rm -f ${S} ${S}-wal ${S}-shm && node --no-warnings tests/evidence/touch-sweep/seed.ts ${S} ${today}`, { stdio: 'ignore' })
  const context = await browser.newContext({ viewport: { width: 390, height: 780 }, hasTouch: true, isMobile: true, serviceWorkers: 'block' }), page = await context.newPage(), errors = []
  page.on('pageerror', e => errors.push(e.message))
  const cdp = await context.newCDPSession(page)
  const touch = async (type, x, y) => cdp.send('Input.dispatchTouchEvent', { type, touchPoints: type === 'touchEnd' ? [] : [{ x, y }] })
  const press = async (x, y, ms, path = []) => { await touch('touchStart', x, y); await wait(ms); for (const [px, py] of path) { await touch('touchMove', px, py); await wait(16) } await touch('touchEnd') }
  const centre = async locator => { const b = await locator.boundingBox(); return [b.x + b.width / 2, b.y + b.height / 2] }
  const state = () => page.evaluate(() => ({ editing: Boolean(document.activeElement?.closest('[contenteditable=true]')), scroll: Math.round(scrollY), chip: Boolean(document.querySelector('.line-drag-chip')), selected: getSelection()?.toString() ?? '', url: location.pathname + location.search, menus: document.querySelectorAll('[role=menu], .app-menu, [role=dialog]').length }))
  let r
  try { await page.goto(`${base}/`); await wait(2200); r = await act({ page, press, centre, state, touch }) } catch (e) { r = { ok: false, threw: e.message.split('\n')[0] } }
  results.push({ name, ...r, errors })
  console.log(r.ok && !errors.length ? 'OK  ' : 'LOOK', name, JSON.stringify({ ...r, errors }).slice(0, 500))
  await context.close()
}
const line = (page, id) => page.locator(`.bn-block-outer[data-id="${id}"] .bn-inline-content`).first()

await check('Tap a to-do\'s box: it ticks, the keyboard stays down, the page stays put', async ({ page, centre, press, state }) => {
  const before = await state(), [x, y] = await centre(page.locator('.bn-block-outer[data-id="td1"] input[type=checkbox]'))
  await press(x, y, 60); await wait(1200)
  const after = await state(), done = tasks().find(t => t.title === 'Call the bank')?.status
  return { ok: done === 'done' && !after.editing && after.scroll === before.scroll, done, after }
})
await check('Tap the date chip: opens its day, no keyboard', async ({ page, centre, press, state }) => {
  const [x, y] = await centre(page.locator('.bn-block-outer[data-id="chips"] [data-inline-content-type="dateMention"], .bn-block-outer[data-id="chips"] .date-chip, .bn-block-outer[data-id="chips"] .editor-date-chip').first())
  await press(x, y, 60); await wait(600)
  const after = await state()
  return { ok: !after.editing && after.url.startsWith(`/day/${today}`), after }
})
await check('Tap the page reference: opens the page', async ({ page, centre, press, state }) => {
  const [x, y] = await centre(page.locator('.bn-block-outer[data-id="chips"] [data-inline-content-type="pageRef"]').first())
  await press(x, y, 60); await wait(1200)
  const after = await state()
  return { ok: /notes/.test(after.url), after }
})
await check('Tap the link: it opens, and the caret and keyboard stay as they were (B91)', async ({ page, centre, press, state }) => {
  const [x, y] = await centre(page.locator('.bn-block-outer[data-id="chips"] a[href^="https://example.com"]').first())
  await press(x, y, 60); await wait(800)
  const after = await state(), pages = page.context().pages().length
  return { ok: !after.editing && pages === 2 && after.url === '/', after, pages }
})
for (const id of ['url1', 'url2']) await check(`A line that's only a link (${id}): a tap in the space after its last row puts the caret at its end, and opens nothing`, async ({ page, press, state }) => {
  const rects = await page.locator(`.bn-block-outer[data-id="${id}"] a`).first().evaluate(a => [...a.getClientRects()].map(r => ({ right: r.right, top: r.top, bottom: r.bottom })))
  const last = rects.at(-1), column = await page.locator(`.bn-block-outer[data-id="${id}"] .bn-inline-content`).first().boundingBox()
  const room = Math.round(column.x + column.width - last.right)
  await press(Math.min(last.right + 12, column.x + column.width - 2), (last.top + last.bottom) / 2, 60); await wait(600)
  const after = await state(), pages = page.context().pages().length
  const at = await page.evaluate(() => { const s = getSelection(); const node = s?.anchorNode; return { id: node?.parentElement?.closest('.bn-block-outer')?.getAttribute('data-id'), end: node ? s.anchorOffset === (node.textContent ?? '').length : false } })
  return { ok: pages === 1 && after.editing && at.id === id && at.end, rows: rects.length, room, pages, at, after }
})
await check('A line that\'s only a link, its last row full: a tap in the margin past the text puts the caret at its end, and opens nothing', async ({ page, press, state }) => {
  const column = await page.locator('.bn-block-outer[data-id="url2"] .bn-inline-content').first().boundingBox(), editor = await page.locator('.bn-editor').boundingBox()
  const rects = await page.locator('.bn-block-outer[data-id="url2"] a').first().evaluate(a => [...a.getClientRects()].map(r => ({ top: r.top, bottom: r.bottom })))
  const last = rects.at(-1), margin = Math.round(editor.x + editor.width - (column.x + column.width))
  await press(column.x + column.width + Math.max(2, margin / 2), (last.top + last.bottom) / 2, 60); await wait(600)
  const after = await state(), pages = page.context().pages().length
  const at = await page.evaluate(() => { const s = getSelection(); const node = s?.anchorNode; return { id: node?.parentElement?.closest('.bn-block-outer')?.getAttribute('data-id'), end: node ? s.anchorOffset === (node.textContent ?? '').length : false } })
  return { ok: pages === 1 && after.editing && at.id === 'url2' && at.end, margin, pages, at }
})
await check('Tap a line\'s words: caret there, keyboard up, nothing else', async ({ page, centre, press, state }) => {
  const [x, y] = await centre(line(page, 'p1'))
  await press(x, y, 60); await wait(500)
  const after = await state()
  return { ok: after.editing && !after.chip && !after.selected && after.menus === 0, after }
})
await check('Tap below the last line: caret at the end', async ({ page, press, state }) => {
  const b = await line(page, 'last').boundingBox()
  await page.evaluate(() => scrollTo(0, document.body.scrollHeight)); await wait(300)
  const nb = await line(page, 'last').boundingBox()
  await press(nb.x + 40, nb.y + nb.height + 40, 60); await wait(500)
  const after = await state(), where = await page.evaluate(() => getSelection()?.anchorNode?.parentElement?.closest('.bn-block-outer')?.getAttribute('data-id'))
  void b
  return { ok: after.editing && (where === 'last' || where !== 'z0'), after, where }
})
await check('A swipe up from a line scrolls the page: no drag, no selection, nothing moved', async ({ page, centre, press, state }) => {
  const before = order(), [x, y] = await centre(line(page, 'z3'))
  await press(x, y, 40, Array.from({ length: 12 }, (_, i) => [x, y - 25 * (i + 1)])); await wait(800)
  const after = await state()
  return { ok: after.scroll > 0 && !after.chip && !after.selected && order() === before, after }
})
await check('A slow swipe (finger held 300 ms, then moving) still scrolls rather than dragging', async ({ page, centre, press, state }) => {
  const before = order(), [x, y] = await centre(line(page, 'z3'))
  await press(x, y, 300, Array.from({ length: 12 }, (_, i) => [x, y - 25 * (i + 1)])); await wait(800)
  const after = await state()
  return { ok: !after.chip && order() === before, after }
})
await check('Long press on the date chip: picks the line up (B90), the chip\'s menu doesn\'t open on release', async ({ page, centre, press, state }) => {
  const before = order(), [x, y] = await centre(page.locator('.bn-block-outer[data-id="chips"] [data-inline-content-type="dateMention"]').first())
  const target = await line(page, 'z2').boundingBox()
  await press(x, y, 700, Array.from({ length: 10 }, (_, i) => [x, y + ((target.y + target.height * 0.8 - y) * (i + 1)) / 10])); await wait(1200)
  const after = await state(), moved = order() !== before
  return { ok: moved && after.menus === 0 && !after.editing, moved, order: order().split(',').slice(0, 10).join(','), after }
})
await check('Long press on a to-do\'s box: no tick; held and moved, the line goes with it', async ({ page, centre, press, state }) => {
  const [x, y] = await centre(page.locator('.bn-block-outer[data-id="td2"] input[type=checkbox]'))
  await press(x, y, 700); await wait(1200)
  const still = tasks().find(t => t.title === 'Water the plants')?.status, before = order(), t = await line(page, 'z2').boundingBox()
  const [x2, y2] = await centre(page.locator('.bn-block-outer[data-id="td2"] input[type=checkbox]'))
  await press(x2, y2, 700, Array.from({ length: 10 }, (_, i) => [x2 + 40, y2 + ((t.y + t.height * 0.8 - y2) * (i + 1)) / 10])); await wait(1200)
  const status = tasks().find(t => t.title === 'Water the plants')?.status, moved = order() !== before
  return { ok: still === 'open' && status === 'open' && moved, still, status, moved, after: await state() }
})
await check('Right after a drag, the next tap on a box still ticks it', async ({ page, centre, press, state }) => {
  const [x, y] = await centre(line(page, 'z5')), t = await line(page, 'z8').boundingBox()
  await press(x, y, 700, Array.from({ length: 8 }, (_, i) => [x, y + ((t.y + t.height - y) * (i + 1)) / 8])); await wait(150)
  const [bx, by] = await centre(page.locator('.bn-block-outer[data-id="td1"] input[type=checkbox]'))
  await press(bx, by, 60); await wait(1200)
  const done = tasks().find(t => t.title === 'Call the bank')?.status
  return { ok: done === 'done', done, after: await state() }
})
await check('Tap the heading: caret in it, no drag', async ({ page, centre, press, state }) => {
  const [x, y] = await centre(line(page, 'h1'))
  await press(x, y, 60); await wait(500)
  const after = await state()
  return { ok: after.editing && !after.chip, after }
})
await check('Tap the nested line: caret in it, not its parent', async ({ page, centre, press }) => {
  await line(page, 'p1a').evaluate(e => e.scrollIntoView({ block: 'center' })); await wait(300)
  const [x, y] = await centre(line(page, 'p1a'))
  await press(x, y, 60); await wait(500)
  const where = await page.evaluate(() => getSelection()?.anchorNode?.parentElement?.closest('.bn-block-outer')?.getAttribute('data-id'))
  return { ok: where === 'p1a', where }
})
await browser.close()
console.log(results.filter(r => !r.ok || r.errors.length).length, 'to look at of', results.length)
