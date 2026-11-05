// Emoji icons in the built app (icons-covers.md §7, P1-1 to P1-3, P1-9): the picker, where an icon shows, and an icon's change alongside typing.
// Usage: node tests/evidence/page-icons/icons.mjs <base-url> <store-path> [chromium|webkit]  (a throwaway store the server at <base-url> uses)
import * as pw from '@playwright/test'
import { execSync } from 'node:child_process'
const [base, S, engine = 'chromium'] = process.argv.slice(2)
if (!base || !S) { console.error('Usage: node tests/evidence/page-icons/icons.mjs <base-url> <store-path> [chromium|webkit]'); process.exit(2) }
const store = () => JSON.parse(execSync(`sqlite3 ${S} "select data from workspace"`, { maxBuffer: 1 << 26 }).toString())
const iconOf = id => store().pages.find(p => p.id === id)?.icon
const wait = ms => new Promise(r => setTimeout(r, ms))
const browser = await pw[engine].launch({ headless: true })
const wide = { viewport: { width: 1280, height: 800 } }, phone = { viewport: { width: 390, height: 780 }, hasTouch: true }
let failed = 0
const scenario = async (name, act, options = wide, path = '/pages?page=notes') => {
  if (process.env.ONLY && !name.includes(process.env.ONLY)) return
  execSync(`rm -f ${S} ${S}-wal ${S}-shm && node --no-warnings tests/evidence/page-icons/seed.ts ${S}`, { stdio: 'ignore' })
  const context = await browser.newContext({ ...options, serviceWorkers: 'block' }), page = await context.newPage(), errors = []
  page.on('pageerror', e => { if (!/ResizeObserver loop/.test(e.message)) errors.push(e.message) })
  let r
  try { await page.goto(`${base}${path}`); await wait(1800); r = await act(page, context) } catch (e) { r = { ok: false, threw: e.message.split('\n').slice(0, 2).join(' ') } }
  const ok = r.ok && !errors.length
  if (!ok) failed++
  console.log(ok ? 'PASS' : 'FAIL', name, JSON.stringify({ ...r, errors }).slice(0, 620))
  await context.close()
}
const notices = page => page.locator('[role=alert], [role=status]').allInnerTexts().then(t => t.join(' | ').replace(/\s+/g, ' '))
const openPicker = async page => { await page.locator('.page-more').first().click(); await wait(200); await page.getByRole('menuitem', { name: /(Add|Change) icon/ }).click(); await page.locator('.icon-picker-cell').first().waitFor(); await wait(150) }
const setIcon = async (page, words) => { await openPicker(page); await page.locator('.icon-picker-search').fill(words); await wait(150); await page.locator('.icon-picker-cell').first().click(); await wait(1000) }
const isIconCommand = q => q.method() === 'POST' && q.url().includes('_serverFn') && (q.postData() ?? '').includes('set-page-icon')
const line = (page, words) => page.locator('.bn-inline-content', { hasText: words }).first()

await scenario('With no icon nothing is drawn, and the picker\'s data isn\'t fetched until it opens', async page => {
  let fetched = 0
  page.on('request', q => { if (q.url().includes('emoji-v1')) fetched++ })
  await page.reload(); await wait(1500)
  const r = { line: await page.locator('.page-icon-line').count(), emoji: await page.locator('.page-emoji').count(), before: fetched }
  await openPicker(page)
  r.after = fetched
  r.ok = r.line === 0 && r.emoji === 0 && r.before === 0 && r.after === 1
  return r
})
await scenario('Pick, with its notice and one Undo; the title stays words; a tap on the icon opens the picker again, with Remove', async page => {
  await setIcon(page, 'koala')
  const r = { icon: iconOf('notes'), title: store().pages.find(p => p.id === 'notes').title, notice: await notices(page), head: await page.locator('.page-icon').textContent() }
  await page.getByRole('button', { name: 'Undo' }).first().click(); await wait(1000)
  r.undone = iconOf('notes') ?? null; r.line = await page.locator('.page-icon-line').count()
  await setIcon(page, 'koala')
  await page.locator('.page-icon').click(); await wait(300)
  await page.locator('.icon-picker').getByRole('button', { name: 'Remove' }).click(); await wait(1000)
  r.removed = iconOf('notes') ?? null; r.notice2 = await notices(page)
  r.ok = r.icon === '🐨' && r.title === 'Notes' && /Icon added/.test(r.notice) && r.head === '🐨' && r.undone === null && r.line === 0 && r.removed === null && /Icon removed/.test(r.notice2)
  return r
})
await scenario('Search in English and Chinese, nothing found says so, and a typed emoji is the one result', async page => {
  await openPicker(page)
  const search = page.locator('.icon-picker-search'), cells = page.locator('.icon-picker-cell')
  await search.fill('tree'); await wait(150); const r = { en: await cells.count() }
  await search.fill('树'); await wait(150); r.zh = await cells.count()
  await search.fill('zzzqq'); await wait(150); r.none = await page.locator('.icon-picker-note').innerText()
  await search.fill('🦖'); await wait(150); r.typed = await cells.first().innerText()
  r.ok = r.en > 2 && r.zh > 2 && r.none === 'No emoji for zzzqq' && r.typed === '🦖'
  return r
})
await scenario('While Pinyin composes nothing\'s searched; once chosen, results follow', async page => {
  await openPicker(page)
  const search = page.locator('.icon-picker-search'), before = await page.locator('.icon-picker-section').count()
  await search.evaluate(el => { el.dispatchEvent(new CompositionEvent('compositionstart', { bubbles: true })) })
  await search.fill('shu'); await wait(150)
  const r = { during: await page.locator('.icon-picker-section').count() === before }
  await search.fill('树'); await search.evaluate(el => { el.dispatchEvent(new CompositionEvent('compositionend', { bubbles: true, data: '树' })) }); await wait(200)
  r.after = await page.locator('.icon-picker-cell').count(); r.sections = await page.locator('.icon-picker-section').count()
  r.ok = r.during && r.after > 2 && r.sections === 0
  return r
})
await scenario('Random changes at once on each press and stays open; a run of presses is one change, and Undo goes back to before it (P1-9)', async page => {
  await setIcon(page, 'koala')
  let sent = 0
  page.on('request', q => { if (isIconCommand(q)) sent++ })
  await page.locator('.page-icon').click(); await wait(300)
  const seen = new Set()
  for (let i = 0; i < 6; i++) { await page.locator('.icon-picker').getByRole('button', { name: 'Random' }).click(); seen.add(await page.locator('.page-icon').textContent()); await wait(50) }
  const r = { shown: seen.size, open: await page.locator('.icon-picker').count(), sentDuring: sent }
  await wait(1400)
  r.sent = sent; const settled = await page.locator('.page-icon').textContent(); r.same = iconOf('notes') === settled
  await page.keyboard.press('Escape'); await wait(200)
  await page.getByRole('button', { name: 'Undo' }).first().click(); await wait(1000)
  r.back = iconOf('notes')
  r.ok = r.shown >= 4 && r.open === 1 && r.sentDuring === 0 && r.sent === 1 && r.same && r.back === '🐨'
  return r
})
await scenario('A failed save goes back to what\'s saved and says so, and Try again sends it again (P1-9)', async page => {
  await setIcon(page, 'koala')
  await page.route('**/_serverFn/**', route => isIconCommand(route.request()) ? route.abort() : route.continue())
  await page.locator('.page-icon').click(); await wait(300)
  await page.locator('.icon-picker-search').fill('tree'); await wait(150); await page.locator('.icon-picker-cell').first().click(); await wait(1200)
  const r = { shown: await page.locator('.page-icon').textContent(), saved: iconOf('notes'), notice: await notices(page) }
  await page.unroute('**/_serverFn/**')
  await page.getByRole('button', { name: 'Try again' }).click(); await wait(1200)
  r.after = iconOf('notes'); r.shownAfter = await page.locator('.page-icon').textContent()
  r.ok = r.shown === '🐨' && r.saved === '🐨' && /Couldn't change the icon/.test(r.notice) && r.after !== '🐨' && r.after === r.shownAfter
  return r
})
await scenario('Two choices through two pickers, each save held: the first reply doesn\'t take the head back to it (Ratchet)', async page => {
  const holds = []
  await page.route('**/_serverFn/**', async route => { if (isIconCommand(route.request())) await new Promise(res => holds.push(res)); await route.continue().catch(() => {}) })
  await openPicker(page); await page.locator('.icon-picker-search').fill('koala'); await wait(150); await page.locator('.icon-picker-cell').first().click(); await wait(500)
  const first = await page.locator('.page-icon').innerText()
  await page.keyboard.press('Escape'); await wait(200)
  await page.locator('.page-icon').click(); await wait(300); await page.locator('.icon-picker-search').fill('tree'); await wait(150); await page.locator('.icon-picker-cell').first().click(); await wait(500)
  const second = await page.locator('.page-icon').innerText()
  const r = { first, second, sends: holds.length }
  holds[0](); await wait(900)
  r.afterFirst = await page.locator('.page-icon').innerText(); r.sends2 = holds.length
  holds[1](); await wait(1000)
  r.afterSecond = await page.locator('.page-icon').innerText(); r.saved = iconOf('notes')
  r.ok = first === '🐨' && second !== first && r.afterFirst === second && r.afterSecond === second && r.saved === second
  return r
})
await scenario('An icon changed while words are saving, with the save held: both stay, the newest choice shows, and a late Undo takes only what it says (P1-9)', async page => {
  let release, count = 0
  const held = new Promise(res => { release = res })
  await page.route('**/_serverFn/**', async route => { const q = route.request(); if (q.method() === 'POST' && (q.postData() ?? '').includes('save-editor') && !count++) await held; await route.continue().catch(() => {}) })
  await line(page, 'Another line').click(); await page.keyboard.press('Meta+ArrowRight'); await page.keyboard.type(' typed while it saves', { delay: 10 }); await wait(1500)
  await openPicker(page); await page.locator('.icon-picker-search').fill('koala'); await wait(150); await page.locator('.icon-picker-cell').first().click(); await wait(200)
  const r = { during: await page.locator('.page-icon').textContent() }
  await page.locator('.page-icon').click(); await wait(200); await page.locator('.icon-picker-search').fill('tree'); await wait(150); const want = await page.locator('.icon-picker-cell').first().innerText(); await page.locator('.icon-picker-cell').first().click(); await wait(200)
  r.newest = await page.locator('.page-icon').textContent() === want
  release(); await wait(2600)
  const doc = JSON.stringify(store().pages.find(p => p.id === 'notes').document)
  r.words = doc.includes('typed while it saves'); r.icon = iconOf('notes') === want; r.shownStill = await page.locator('.page-icon').textContent() === want
  await line(page, 'Another line').click(); await page.keyboard.press('Meta+ArrowRight'); await page.keyboard.type(' more', { delay: 10 }); await wait(1800)
  const undo = page.getByRole('button', { name: 'Undo' })
  r.undoGone = await undo.count() === 0
  if (!r.undoGone) { await undo.first().click(); await wait(1200) }
  const after = JSON.stringify(store().pages.find(p => p.id === 'notes').document)
  r.wordsAfter = after.includes('typed while it saves')
  r.ok = r.during === '🐨' && r.newest && r.words && r.icon && r.shownStill && r.wordsAfter
  return r
})
await scenario('An icon shows wherever the page\'s name does: sidebar, Pages, a [[ link, a card, search, the crumb and Move to', async page => {
  await setIcon(page, 'koala')
  const r = { sidebar: await page.locator('.tree-title .page-emoji').count() }
  await page.goto(`${base}/pages?page=links`); await wait(1800)
  r.ref = await page.locator('.page-ref .page-emoji, .page-ref-icon .page-emoji').count(); r.card = await page.locator('.editor-page-card-icon .page-emoji').count()
  await page.goto(`${base}/pages`); await wait(1500)
  r.pages = await page.locator('.card-row-icon .page-emoji').count()
  await page.goto(`${base}/pages?page=child`); await wait(1800)
  r.crumb = await page.locator('.crumb .page-emoji').count()
  await page.locator('.page-more').first().click(); await wait(200); await page.getByRole('menuitem', { name: 'Move to…' }).click(); await wait(500)
  r.moveTo = await page.locator('.move-row-icon .page-emoji').count()
  await page.keyboard.press('Escape'); await wait(200)
  await page.keyboard.press('Meta+k'); await wait(400); await page.keyboard.type('Notes'); await wait(600)
  r.search = await page.locator('.search-row-icon .page-emoji').count()
  r.ok = r.sidebar >= 1 && r.ref >= 1 && r.card >= 1 && r.pages >= 1 && r.crumb >= 1 && r.moveTo >= 1 && r.search >= 1
  return r
})
await scenario('A database\'s own icon, and a row\'s before its Name in a table; a tap on the row still opens the row', async page => {
  await openPicker(page); await page.locator('.icon-picker-search').fill('books'); await wait(150); await page.locator('.icon-picker-cell').first().click(); await wait(1000)
  const r = { own: iconOf('books') ?? null, sidebar: await page.locator('.tree-row[data-page="books"] .page-emoji').count() }
  await page.goto(`${base}/pages?page=one`); await wait(1800)
  await openPicker(page); await page.locator('.icon-picker-search').fill('koala'); await wait(150); await page.locator('.icon-picker-cell').first().click(); await wait(1000)
  r.row = iconOf('one')
  await page.goto(`${base}/pages?page=books`); await wait(1800)
  r.name = await page.locator('.database-row[data-row="one"] .database-row-icon').innerText()
  await page.locator('.database-row[data-row="one"] .database-title-cell').click(); await wait(800)
  r.opened = (await page.locator('.peek').count()) + (page.url().includes('page=one') ? 1 : 0); r.picker = await page.locator('.icon-picker').count()
  r.ok = Boolean(r.own) && r.sidebar === 1 && r.row === '🐨' && r.name === '🐨' && r.opened >= 1 && r.picker === 0
  return r
}, wide, '/pages?page=books')
await scenario('A row\'s icon in every other layout, on a Timeline\'s table and bar, and in Trash', async page => {
  await openPicker(page); await page.locator('.icon-picker-search').fill('koala'); await wait(150); await page.locator('.icon-picker-cell').first().click(); await wait(1000)
  const r = {}
  await page.goto(`${base}/pages?page=books`); await wait(1800)
  for (const name of ['list', 'board', 'gallery', 'calendar', 'timeline']) {
    await page.locator('.database-view-name').first().click(); await wait(250); await page.locator('.database-view-pick', { hasText: name }).click(); await wait(800)
    r[name] = await page.locator('.database-row-icon').count()
    if (name === 'timeline') { const box = await page.locator('.database-bar-lane[data-row="one"]').boundingBox(); r.lane = box ? Math.round(box.height) : null }
  }
  await page.goto(`${base}/pages?page=one`); await wait(1800)
  await page.locator('.page-more').first().click(); await wait(200); await page.getByRole('menuitem', { name: /Delete/ }).click(); await wait(1200)
  await page.goto(`${base}/pages?view=trash`); await wait(1500)
  r.trash = await page.locator('.card-row-icon .page-emoji').count()
  r.ok = r.list === 1 && r.board === 1 && r.gallery === 1 && r.calendar >= 1 && r.timeline >= 2 && r.trash >= 1
  return r
}, wide, '/pages?page=one')
await scenario('Keys at 1280: search has the caret, arrows move, Enter picks, Esc closes and picks nothing', async page => {
  await openPicker(page)
  const r = { caret: await page.evaluate(() => document.activeElement?.className) }
  await page.keyboard.press('Escape'); await wait(200)
  r.closed = await page.locator('.icon-picker').count(); r.none = iconOf('notes') ?? null
  await openPicker(page)
  await page.keyboard.press('ArrowDown'); await page.keyboard.press('ArrowRight'); await wait(100)
  const second = await page.evaluate(() => document.activeElement?.textContent)
  await page.keyboard.press('Enter'); await wait(1000)
  r.picked = iconOf('notes') === second
  r.ok = /icon-picker-search/.test(r.caret) && r.closed === 0 && r.none === null && r.picked
  return r
})
await scenario('The data can\'t load: it says so with Try again, and a typed emoji still works', async page => {
  await page.route('**/emoji-v1.json', route => route.abort())
  await page.locator('.page-more').first().click(); await wait(200); await page.getByRole('menuitem', { name: 'Add icon' }).click(); await wait(700)
  const r = { says: await page.locator('.icon-picker-note').innerText() }
  await page.locator('.icon-picker-search').fill('🦖'); await wait(150)
  await page.locator('.icon-picker-cell').first().click(); await wait(1000)
  r.icon = iconOf('notes')
  r.ok = /Can't load emoji/.test(r.says) && /Try again/.test(r.says) && r.icon === '🦖'
  return r
})
await scenario('A written day takes one; an empty day has no ⋯', async page => {
  // The seed's day, whichever a browser's own time zone data calls today.
  await page.goto(`${base}/day/${store().pages.find(p => p.type === 'daily' && p.document.includes('Written today')).date}`); await wait(1800)
  const r = { more: await page.locator('.day-head .page-more').count() }
  await openPicker(page); await page.locator('.icon-picker-search').fill('koala'); await wait(150); await page.locator('.icon-picker-cell').first().click(); await wait(1000)
  r.head = await page.locator('.page-icon').textContent(); r.sidebar = await page.locator('.tree-row[data-kind="day"] .page-emoji').count()
  const future = new Intl.DateTimeFormat('en-CA').format(new Date(Date.now() + 86_400_000))
  await page.goto(`${base}/day/${future}`); await wait(1500)
  r.emptyMore = await page.locator('.day-head .page-more').count()
  r.ok = r.more === 1 && r.head === '🐨' && r.sidebar >= 1 && r.emptyMore === 0
  return r
}, wide, '/')
await scenario('390: a sheet with no toolbar and no keyboard until search is tapped; it fits, and an icon sits on the title\'s edge', async page => {
  await line(page, 'Another line').tap(); await wait(400)
  await page.locator('.page-more').first().tap(); await wait(300); await page.getByRole('menuitem', { name: 'Add icon' }).tap(); await page.locator('.icon-picker-cell').first().waitFor(); await wait(300)
  const box = await page.locator('.icon-picker').boundingBox(), cell = await page.locator('.icon-picker-cell').first().boundingBox()
  const r = { box: [box.x, box.width, Math.round(box.height)], focused: await page.evaluate(() => document.activeElement?.className ?? ''), toolbar: await page.locator('.editor-phone-toolbar').evaluateAll(l => l.filter(n => getComputedStyle(n).display !== 'none').length), cell: Math.round(cell.height), size: await page.locator('.icon-picker-search').evaluate(n => parseFloat(getComputedStyle(n).fontSize)) }
  await page.screenshot({ path: `/tmp/rb-csv/icons-sheet-${engine}.png` })
  await page.locator('.icon-picker-cell').first().tap(); await wait(1000)
  const icon = await page.locator('.page-icon').boundingBox(), title = await page.locator('.page-head input, .page-head textarea, .page-head .large-title').first().boundingBox()
  r.edge = Math.round(icon.x - title.x); r.overflow = await page.evaluate(() => document.documentElement.scrollWidth - innerWidth)
  r.ok = r.box[0] === 0 && r.box[1] === 390 && !/icon-picker-search/.test(r.focused) && r.toolbar === 0 && r.cell === 44 && r.size >= 16 && Math.abs(r.edge) <= 4 && r.overflow <= 0
  return r
}, phone)
await browser.close()
console.log(failed ? `${failed} FAILED` : 'ALL PASS')
process.exit(failed ? 1 : 0)
