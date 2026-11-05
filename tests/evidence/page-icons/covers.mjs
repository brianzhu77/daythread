// Covers from an image link in the built app (icons-covers.md §7.5 to §7.8, P1-4, P1-9). The pictures are served by the script at made-up addresses, so nothing leaves this machine, and each says who asked.
// Usage: node tests/evidence/page-icons/covers.mjs <base-url> <store-path> [chromium|webkit]  (a throwaway store the server at <base-url> uses)
import * as pw from '@playwright/test'
import { execSync } from 'node:child_process'
import { crc32, deflateSync } from 'node:zlib'
const [base, S, engine = 'chromium'] = process.argv.slice(2)
if (!base || !S) { console.error('Usage: node tests/evidence/page-icons/covers.mjs <base-url> <store-path> [chromium|webkit]'); process.exit(2) }
const store = () => JSON.parse(execSync(`sqlite3 ${S} "select data from workspace"`, { maxBuffer: 1 << 26 }).toString())
const pageOf = id => store().pages.find(p => p.id === id)
const wait = ms => new Promise(r => setTimeout(r, ms))
const pngOf = (w, h) => {
  const chunk = (type, data) => { const body = Buffer.concat([Buffer.from(type), data]), len = Buffer.alloc(4), crc = Buffer.alloc(4); len.writeUInt32BE(data.length); crc.writeUInt32BE(crc32(body)); return Buffer.concat([len, body, crc]) }
  const head = Buffer.alloc(13); head.writeUInt32BE(w, 0); head.writeUInt32BE(h, 4); head[8] = 8; head[9] = 2
  const row = Buffer.alloc(w * 3 + 1, 120); row[0] = 0
  return Buffer.concat([Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), chunk('IHDR', head), chunk('IDAT', deflateSync(Buffer.concat(Array.from({ length: h }, () => row)))), chunk('IEND', Buffer.alloc(0))])
}
const portrait = pngOf(600, 1200), wide = pngOf(2400, 300)
const PORTRAIT = 'https://covers.test/portrait.png', WIDE = 'https://covers.test/wide.png', GONE = 'https://covers.test/gone.png', SLOW = 'https://covers.test/slow.png', OTHER = 'https://covers.test/other.png'
const browser = await pw[engine].launch({ headless: true })
const big = { viewport: { width: 1280, height: 800 } }, phone = { viewport: { width: 390, height: 780 }, hasTouch: true }
let failed = 0
const scenario = async (name, act, options = big, path = '/pages?page=notes') => {
  if (process.env.ONLY && !name.includes(process.env.ONLY)) return
  execSync(`rm -f ${S} ${S}-wal ${S}-shm && node --no-warnings tests/evidence/page-icons/seed.ts ${S}`, { stdio: 'ignore' })
  const context = await browser.newContext({ ...options, serviceWorkers: 'block' }), page = await context.newPage(), errors = [], asked = []
  page.on('pageerror', e => { if (!/ResizeObserver loop/.test(e.message)) errors.push(e.message) })
  const pictures = { hold: null, dead: new Set() }
  await context.route('https://covers.test/**', async route => {
    const url = route.request().url(); asked.push({ url, referer: (await route.request().allHeaders()).referer ?? null })
    if (url === GONE || pictures.dead.has(url)) return route.fulfill({ status: 404, body: '' })
    if (url === SLOW && pictures.hold) await pictures.hold
    return route.fulfill({ status: 200, contentType: 'image/png', body: url === WIDE ? wide : portrait })
  })
  let r
  try { await page.goto(`${base}${path}`); await wait(1800); r = await act(page, { pictures, asked }) } catch (e) { r = { ok: false, threw: e.message.split('\n').slice(0, 2).join(' ') } }
  const ok = r.ok && !errors.length
  if (!ok) failed++
  console.log(ok ? 'PASS' : 'FAIL', name, JSON.stringify({ ...r, errors }).slice(0, 640))
  await context.close()
}
const notices = page => page.locator('[role=alert], [role=status]').allInnerTexts().then(t => t.join(' | ').replace(/\s+/g, ' '))
const menu = async (page, name) => { await page.locator('.page-more').first().click(); await wait(200); await page.getByRole('menuitem', { name }).click(); await wait(250) }
const field = page => page.locator('.cover-panel-field')
const addButton = page => page.locator('.cover-panel-actions').getByRole('button', { name: /^(Add|Change)$/ })
const add = async (page, url) => { await menu(page, /(Add|Change) cover/); await field(page).fill(url); await addButton(page).waitFor(); await addButton(page).click(); await wait(1000) }
const line = (page, words) => page.locator('.bn-inline-content', { hasText: words }).first()
const shownAt = page => page.locator('.page-cover-image').evaluate(i => i.style.objectPosition)
const isCoverCommand = q => q.method() === 'POST' && q.url().includes('_serverFn') && (q.postData() ?? '').includes('set-page-cover')

await scenario('With no cover nothing is drawn', async page => {
  const r = { band: await page.locator('.page-cover').count() }
  r.ok = r.band === 0
  return r
})
await scenario('A dead link can\'t be added; a good one previews, then Add; with its notice, no referrer, and one Undo', async (page, { asked }) => {
  await menu(page, 'Add cover')
  const r = { before: await addButton(page).count() }
  await field(page).fill(GONE); await wait(500)
  r.says = await page.locator('.cover-panel-note').innerText(); r.deadAdd = await addButton(page).count()
  await field(page).fill(PORTRAIT); await addButton(page).waitFor()
  r.preview = await page.locator('.cover-panel-preview').count()
  await addButton(page).click(); await wait(1000)
  r.saved = pageOf('notes').cover; r.notice = await notices(page); r.band = (await page.locator('.page-cover').boundingBox()).height
  r.referrers = asked.filter(a => a.referer).length
  await page.getByRole('button', { name: 'Undo' }).first().click(); await wait(1000)
  r.undone = pageOf('notes').cover ?? null; r.gone = await page.locator('.page-cover').count()
  r.ok = r.before === 0 && r.says === "Can't load that image" && r.deadAdd === 0 && r.preview === 1 && r.saved === PORTRAIT && /Cover added/.test(r.notice) && r.band === 200 && r.referrers === 0 && r.undone === null && r.gone === 0
  return r
})
await scenario('Too long and not a link say so; only a link\'s own loaded picture enables Add: a late answer from an earlier link doesn\'t (P1-9)', async (page, { pictures }) => {
  let release; pictures.hold = new Promise(res => { release = res })
  await menu(page, 'Add cover')
  await field(page).fill(`https://covers.test/${'x'.repeat(2100)}`); await wait(100); const r = { long: await page.locator('.cover-panel-note').innerText() }
  await field(page).fill('javascript:alert(1)'); await wait(100); r.notLink = await page.locator('.cover-panel-note').innerText()
  await field(page).fill(SLOW); await wait(200)
  await field(page).fill(GONE); await wait(300)
  release(); await wait(500)
  r.addAfterLateA = await addButton(page).count(); r.note = await page.locator('.cover-panel-note').innerText()
  r.ok = r.long === 'That link is too long' && /isn't an image link/.test(r.notLink) && r.addAfterLateA === 0 && r.note === "Can't load that image"
  return r
})
await scenario('Changing keeps the old cover until the new one\'s committed; Remove takes it, from the same panel', async page => {
  await add(page, PORTRAIT)
  await menu(page, 'Change cover'); await field(page).fill(WIDE); await addButton(page).waitFor()
  const r = { during: pageOf('notes').cover, shownDuring: await page.locator('.page-cover-image').getAttribute('src') }
  await addButton(page).click(); await wait(1000)
  r.after = pageOf('notes').cover
  await menu(page, 'Change cover'); await page.locator('.cover-panel-actions').getByRole('button', { name: 'Remove' }).click(); await wait(1000)
  r.removed = pageOf('notes').cover ?? null
  r.ok = r.during === PORTRAIT && r.shownDuring === PORTRAIT && r.after === WIDE && r.removed === null
  return r
})
await scenario('Reposition: drag and keys move it, Cancel restores exactly and sends nothing, Done is one change with one Undo; a wide picture doesn\'t offer it (P1-9)', async page => {
  await add(page, PORTRAIT)
  let sent = 0
  page.on('request', q => { if (isCoverCommand(q)) sent++ })
  const r = { start: await shownAt(page) }
  await page.locator('.page-cover').hover(); await wait(150); await page.locator('.page-cover-actions').getByRole('button', { name: 'Reposition' }).click(); await wait(200)
  const box = await page.locator('.page-cover').boundingBox()
  await page.mouse.move(box.x + 300, box.y + 100); await page.mouse.down(); await page.mouse.move(box.x + 300, box.y + 40, { steps: 4 }); await page.mouse.up(); await wait(100)
  r.dragged = await shownAt(page)
  await page.keyboard.press('Escape'); await wait(300)
  r.cancelled = await shownAt(page); r.sentCancel = sent; r.storedCancel = pageOf('notes').coverPosition ?? null
  await page.locator('.page-cover').hover(); await wait(150); await page.locator('.page-cover-actions').getByRole('button', { name: 'Reposition' }).click(); await wait(200)
  await page.keyboard.press('ArrowUp'); await page.keyboard.press('ArrowUp'); await wait(100)
  r.keys = await shownAt(page)
  await page.keyboard.press('Enter'); await wait(1000)
  r.done = pageOf('notes').coverPosition; r.sentDone = sent; r.notice = await notices(page)
  await page.getByRole('button', { name: 'Undo' }).first().click(); await wait(1000)
  r.undone = pageOf('notes').coverPosition ?? null; r.undoneShown = await shownAt(page)
  await add(page, WIDE); await page.locator('.page-cover').hover(); await wait(200)
  r.wideOffers = await page.locator('.page-cover-actions').getByRole('button', { name: 'Reposition' }).count()
  r.ok = r.start === '50% 50%' && r.dragged !== r.start && r.cancelled === r.start && r.sentCancel === 0 && r.storedCancel === null && r.keys === '50% 60%' && r.done === 0.6 && r.sentDone === 1 && /Cover moved/.test(r.notice) && r.undone === null && r.undoneShown === '50% 50%' && r.wideOffers === 0
  return r
})
await scenario('The same setting holds in a full page, a center peek and a side peek, each at its own height; a wide picture offers no move in any (P1-9)', async page => {
  await add(page, PORTRAIT)
  await page.locator('.page-cover').hover(); await wait(150); await page.locator('.page-cover-actions').getByRole('button', { name: 'Reposition' }).click(); await wait(200)
  await page.keyboard.press('ArrowUp'); await page.keyboard.press('Enter'); await wait(1000)
  const r = { saved: pageOf('one').coverPosition, full: [(await page.locator('.page-cover').boundingBox()).height, await shownAt(page)] }
  const widthOf = async () => { const c = await page.locator('.peek .page-cover').boundingBox(), p = await page.locator('.peek').boundingBox(); return Math.abs(c.width - p.width) <= 1 }
  const openIn = async mode => {
    await page.goto(`${base}/pages?page=books`); await wait(1800)
    await page.locator('.database-more-button').first().click(); await wait(250); await page.getByRole('menuitem', { name: /Layout/ }).click(); await wait(300)
    await page.getByLabel('Open pages in').selectOption(mode); await wait(800); await page.keyboard.press('Escape'); await page.mouse.click(5, 5); await wait(300)
    await page.locator('.database-row[data-row="one"] .database-title-cell').click(); await wait(1200)
  }
  await openIn('center')
  r.center = [(await page.locator('.peek .page-cover').boundingBox()).height, await shownAt(page), await widthOf()]
  await page.locator('.peek-head').getByRole('button', { name: 'Close' }).click(); await wait(400)
  await openIn('side')
  r.side = [(await page.locator('.peek.is-side .page-cover').boundingBox()).height, await shownAt(page), await widthOf()]
  await page.locator('.peek .page-more').click(); await wait(200)
  r.moves = await page.getByRole('menuitem', { name: 'Reposition' }).count()
  await page.getByRole('menuitem', { name: 'Reposition' }).click(); await wait(250)
  await page.keyboard.press('ArrowDown'); await page.keyboard.press('Escape'); await wait(300)
  r.cancelledInPeek = await shownAt(page)
  await page.locator('.peek .page-more').click(); await wait(200); await page.getByRole('menuitem', { name: 'Change cover' }).click(); await wait(250)
  await field(page).fill(WIDE); await addButton(page).waitFor(); await addButton(page).click(); await wait(1000)
  await page.locator('.peek .page-more').click(); await wait(200)
  r.wideMoves = await page.getByRole('menuitem', { name: 'Reposition' }).count()
  r.ok = r.saved === 0.55 && r.full[0] === 200 && r.full[1] === '50% 55%' && r.center[0] === 160 && r.center[1] === '50% 55%' && r.center[2] && r.side[0] === 120 && r.side[1] === '50% 55%' && r.side[2] && r.moves === 1 && r.cancelledInPeek === '50% 55%' && r.wideMoves === 0
  return r
}, big, '/pages?page=one')
await scenario('A cover that dies later keeps its place, with no broken mark, and the words don\'t move; Change is still there (§7.6)', async (page, { pictures }) => {
  await add(page, PORTRAIT)
  const words = (await line(page, 'A line of notes').boundingBox()).y
  pictures.dead.add(PORTRAIT)
  await page.reload(); await wait(1800)
  const r = { moved: Math.round((await line(page, 'A line of notes').boundingBox()).y - words), says: await page.locator('.page-cover-failed').innerText(), image: await page.locator('.page-cover-image').count(), height: (await page.locator('.page-cover').boundingBox()).height }
  await page.locator('.page-cover').hover(); await wait(150)
  r.change = await page.locator('.page-cover-actions').getByRole('button', { name: 'Change' }).count(); r.reposition = await page.locator('.page-cover-actions').getByRole('button', { name: 'Reposition' }).count()
  r.ok = Math.abs(r.moved) <= 1 && r.says === "Can't load this cover" && r.image === 0 && r.height === 200 && r.change === 1 && r.reposition === 0
  return r
})
await scenario('While loading the band holds its height, so nothing moves when it arrives', async (page, { pictures }) => {
  await add(page, SLOW)
  let release; pictures.hold = new Promise(res => { release = res })
  await page.reload(); await wait(1500)
  const r = { height: (await page.locator('.page-cover').boundingBox()).height, words: (await line(page, 'A line of notes').boundingBox()).y }
  release(); await wait(500)
  r.moved = Math.round((await line(page, 'A line of notes').boundingBox()).y - r.words)
  r.ok = r.height === 200 && r.moved === 0
  return r
})
await scenario('Two choices through two panels, each save held: the first reply doesn\'t take the band back to it (Ratchet)', async page => {
  const holds = []
  await page.route('**/_serverFn/**', async route => { if (isCoverCommand(route.request())) await new Promise(res => holds.push(res)); await route.continue().catch(() => {}) })
  await menu(page, /(Add|Change) cover/); await field(page).fill(PORTRAIT); await addButton(page).waitFor(); await addButton(page).click(); await wait(500)
  const first = await page.locator('.page-cover-image').getAttribute('src')
  await page.keyboard.press('Escape'); await wait(200)
  // Saved only once its reply is in, so the menu may still offer Add.
  await menu(page, /(Add|Change) cover/); await field(page).fill(WIDE); await addButton(page).waitFor(); await addButton(page).click(); await wait(500)
  const second = await page.locator('.page-cover-image').getAttribute('src')
  const r = { first, second, sends: holds.length }
  holds[0](); await wait(900)
  r.afterFirst = await page.locator('.page-cover-image').getAttribute('src')
  holds[1](); await wait(1000)
  r.afterSecond = await page.locator('.page-cover-image').getAttribute('src'); r.saved = pageOf('notes').cover
  r.ok = first === PORTRAIT && second === WIDE && r.afterFirst === WIDE && r.afterSecond === WIDE && r.saved === WIDE
  return r
})
await scenario('A failed save goes back to what\'s saved and says so, and Try again sends it; a cover changed while words save keeps both (P1-9)', async page => {
  await add(page, PORTRAIT)
  await page.route('**/_serverFn/**', route => isCoverCommand(route.request()) ? route.abort() : route.continue())
  await menu(page, 'Change cover'); await field(page).fill(WIDE); await addButton(page).waitFor(); await addButton(page).click(); await wait(1200)
  const r = { shown: await page.locator('.page-cover-image').getAttribute('src'), notice: await notices(page) }
  await page.unroute('**/_serverFn/**')
  await page.getByRole('button', { name: 'Try again' }).click(); await wait(1200)
  r.retried = pageOf('notes').cover
  let release, count = 0
  const held = new Promise(res => { release = res })
  await page.route('**/_serverFn/**', async route => { const q = route.request(); if (q.method() === 'POST' && (q.postData() ?? '').includes('save-editor') && !count++) await held; await route.continue().catch(() => {}) })
  await line(page, 'Another line').click(); await page.keyboard.press('Meta+ArrowRight'); await page.keyboard.type(' typed while it saves', { delay: 10 }); await wait(1500)
  await menu(page, 'Change cover'); await field(page).fill(OTHER); await addButton(page).waitFor(); await addButton(page).click(); await wait(300)
  r.newest = await page.locator('.page-cover-image').getAttribute('src')
  release(); await wait(2600)
  r.words = JSON.stringify(pageOf('notes').document).includes('typed while it saves'); r.cover = pageOf('notes').cover
  r.ok = r.shown === PORTRAIT && /Couldn't change the cover/.test(r.notice) && r.retried === WIDE && r.newest === OTHER && r.words && r.cover === OTHER
  return r
})
await scenario('Gallery: Card image: Cover shows a row\'s cover', async page => {
  await add(page, PORTRAIT)
  await page.goto(`${base}/pages?page=books`); await wait(1800)
  await page.locator('.database-view-name').first().click(); await wait(250); await page.locator('.database-view-pick', { hasText: 'gallery' }).click(); await wait(800)
  const before = await page.locator('.database-gallery-image').count()
  await page.locator('.database-more-button').first().click(); await wait(250); await page.getByRole('menuitem', { name: /Layout/ }).click(); await wait(300)
  await page.getByLabel('Card image').selectOption('cover'); await wait(1000)
  const r = { before, after: await page.locator('.database-gallery-image').count() }
  r.ok = r.before === 0 && r.after === 1
  return r
}, big, '/pages?page=one')
await scenario('On a written day: the band above the head; an empty day offers nothing', async page => {
  // The seed's day, whichever a browser's own time zone data calls today.
  await page.goto(`${base}/day/${store().pages.find(p => p.type === 'daily' && p.document.includes('Written today')).date}`); await wait(1800)
  await add(page, PORTRAIT)
  const band = await page.locator('.page-cover').boundingBox(), head = await page.locator('.day-head').boundingBox()
  const r = { band: band.height, top: band.y, above: band.y + band.height <= head.y + 1, overflow: await page.evaluate(() => document.documentElement.scrollWidth - innerWidth) }
  r.ok = r.band === 200 && r.top === 0 && r.above && r.overflow <= 0
  return r
}, big, '/')
await scenario('390: 120 px, edge to edge; ⋯ has Change, Reposition; the title and first lines stay in view', async page => {
  await page.locator('.page-more').first().tap(); await wait(250); await page.getByRole('menuitem', { name: 'Add cover' }).tap(); await wait(300)
  await field(page).fill(PORTRAIT); await addButton(page).waitFor(); await addButton(page).tap(); await wait(1000)
  const band = await page.locator('.page-cover').boundingBox(), first = await line(page, 'A line of notes').boundingBox()
  await page.locator('.page-more').first().tap(); await wait(250)
  const r = { band: [band.x, band.width, band.height], first: Math.round(first.y), items: await page.getByRole('menuitem').allInnerTexts(), overflow: await page.evaluate(() => document.documentElement.scrollWidth - innerWidth) }
  r.ok = r.band[0] === 0 && r.band[1] === 390 && r.band[2] === 120 && r.first < 420 && r.items.includes('Change cover') && r.items.includes('Reposition') && r.overflow <= 0
  return r
}, phone)
await scenario('390, opened fresh: ⋯ still offers Reposition, as the picture loads after the menu is drawn, and it works from there', async page => {
  await page.locator('.page-more').first().tap(); await wait(250); await page.getByRole('menuitem', { name: 'Add cover' }).tap(); await wait(300)
  await field(page).fill(PORTRAIT); await addButton(page).waitFor(); await addButton(page).tap(); await wait(1000)
  await page.reload(); await page.locator('.page-cover-image').waitFor(); await wait(1500)
  await page.locator('.page-more').first().tap(); await wait(250)
  const r = { items: await page.getByRole('menuitem').allInnerTexts() }
  await page.getByRole('menuitem', { name: 'Reposition' }).tap(); await wait(300)
  r.moving = await page.locator('.page-cover-moving').count()
  r.ok = r.items.includes('Reposition') && r.moving === 1
  return r
}, phone)
await scenario('390, on a written day: the band starts at the top, with the icon below it and the date below that', async page => {
  await page.goto(`${base}/day/${store().pages.find(p => p.type === 'daily' && p.document.includes('Written today')).date}`); await wait(1800)
  await page.locator('.page-more').first().tap(); await wait(250); await page.getByRole('menuitem', { name: 'Add cover' }).tap(); await wait(300)
  await field(page).fill(PORTRAIT); await addButton(page).waitFor(); await addButton(page).tap(); await wait(1000)
  await page.locator('.page-more').first().tap(); await wait(250); await page.getByRole('menuitem', { name: 'Add icon' }).tap(); await wait(900)
  await page.locator('.icon-picker-cell').first().tap(); await wait(1000)
  const box = async s => page.locator(s).first().boundingBox()
  const band = await box('.page-cover'), icon = await box('.page-icon'), title = await box('.day-title')
  const r = { band: [band.y, band.height, band.width], icon: icon.y, title: title.y }
  r.ok = band.y === 0 && band.height === 120 && band.width === 390 && icon.y >= band.y + band.height && title.y >= icon.y + icon.height - 1
  return r
}, phone, '/')
await browser.close()
console.log(failed ? `${failed} FAILED` : 'ALL PASS')
process.exit(failed ? 1 : 0)
