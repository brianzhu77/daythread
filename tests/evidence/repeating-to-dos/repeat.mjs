// Repeating to-dos on the screen, in the built app (repeating-to-dos.md §3, §7): the icon and its height, setting, changing and turning off a repeat, the
// R1: the icon adds no row height, and a long line takes at most one line more than the same words without a repeat (the icon takes width), never fewer.
// Editor by keyboard, the tick's and Cancel's notices, the mark isn't text, the phone's sheet, Tasks and Upcoming, a document page, offline, and dark.
// Usage: node tests/evidence/repeating-to-dos/repeat.mjs <base-url> <store-path> [chromium|webkit] [shots-dir]  (a throwaway store the server at <base-url> uses)
import * as pw from '@playwright/test'
import { execSync } from 'node:child_process'
const [base, S, engine = 'chromium', shots] = process.argv.slice(2)
if (!base || !S) { console.error('Usage: node tests/evidence/repeating-to-dos/repeat.mjs <base-url> <store-path> [chromium|webkit] [shots-dir]'); process.exit(2) }
// The app reads the clock, so `today` is the real day.
const today = new Date().toLocaleDateString('en-CA')
const plusDays = (iso, n) => { const d = new Date(`${iso}T00:00:00Z`); d.setUTCDate(d.getUTCDate() + n); return d.toISOString().slice(0, 10) }
const tomorrow = plusDays(today, 1)
/** A day as the notices and the editor's last line write it; with the year when it isn't this year's. */
const label = iso => new Date(`${iso}T12:00:00`).toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric', ...(iso.slice(0, 4) !== today.slice(0, 4) ? { year: 'numeric' } : {}) })
const store = () => JSON.parse(execSync(`sqlite3 ${S} "select data from workspace"`, { maxBuffer: 1 << 26 }).toString())
const task = title => store().tasks.find(t => t.title.startsWith(title))
const repeatOf = title => (store().todoRepeats ?? []).find(r => r.taskId === task(title)?.id)
const flat = nodes => nodes.flatMap(n => [n, ...flat(n.children ?? [])])
const doc = id => JSON.parse(store().pages.find(p => p.id === id)?.document ?? '[]')
const lines = () => doc(`day:${today}`).map(n => n.content?.[0]?.text ?? '')
const tomorrowDoc = () => JSON.stringify(store().pages.find(p => p.id === `day:${tomorrow}`)?.document ?? null)
const nextRows = () => flat(doc(`day:${tomorrow}`)).filter(n => n.type === 'task' && String(n.props?.taskId ?? '').endsWith(`.${tomorrow}`))
const nextTodos = () => store().tasks.filter(t => t.id.endsWith(`.${tomorrow}`))
const wait = ms => new Promise(r => setTimeout(r, ms))
const browser = await pw[engine].launch({ headless: true })
const wide = { viewport: { width: 1280, height: 900 } }, phone = { viewport: { width: 390, height: 780 }, hasTouch: true }
const end = engine === 'webkit' ? 'Meta+ArrowRight' : 'End'
// Safari's Tab skips buttons unless Option is held; the app is the same for a person who has that setting on.
const tab = engine === 'webkit' ? 'Alt+Tab' : 'Tab'
let failed = 0
const scenario = async (name, act, options = wide, path = '/', seed = '') => {
  if (process.env.ONLY && !name.includes(process.env.ONLY)) return
  execSync(`rm -f ${S} ${S}-wal ${S}-shm && node --no-warnings tests/evidence/repeating-to-dos/seed.ts ${S} ${today} ${seed}`, { stdio: 'ignore' })
  const context = await browser.newContext({ ...options, serviceWorkers: 'block', permissions: engine === 'chromium' ? ['clipboard-read', 'clipboard-write'] : [] }), page = await context.newPage(), errors = []
  page.on('pageerror', e => { if (!/ResizeObserver loop/.test(e.message)) errors.push(e.message) })
  let r
  try { await page.goto(`${base}${path}`); await wait(2400); r = await act(page, context) } catch (e) { r = { ok: false, threw: e.message.split('\n').slice(0, 4).join(' ') } }
  const ok = r.ok && !errors.length
  if (!ok) failed++
  console.log(ok ? 'PASS' : 'FAIL', name, JSON.stringify({ ...r, errors }).slice(0, 900))
  if (shots && /^R12/.test(name)) await page.screenshot({ path: `${shots}/repeat-${name.slice(0, 3).trim()}-${engine}-${options.viewport.width}-closed.png` }).catch(() => {})
  await context.close()
}
const row = (page, title) => page.locator('.editor-task', { has: page.locator('.editor-task-title', { hasText: new RegExp(`^${title}`) }) }).first()
const height = async (page, title) => Math.round((await row(page, title).boundingBox()).height)
const menu = async (page, title, item) => { await row(page, title).hover(); await row(page, title).locator('.editor-row-more').click(); await wait(200); await page.getByRole('menuitem', { name: item }).click(); await wait(300) }
const notices = page => page.locator('[role=alert], [role=status]').allTextContents().then(t => t.join(' | ').replace(/\s+/g, ' '))
const editor = page => page.locator('[role=dialog]').filter({ has: page.locator('.todo-repeat-editor') })
const centre = box => box.y + box.height / 2
/** The long line's title height with no repeat in the store, at a width: what the same words need without the icon. */
const plainTitle = {}
const plainSeed = async (options) => {
  const width = options.viewport.width
  if (plainTitle[width] !== undefined) return plainTitle[width]
  execSync(`rm -f ${S} ${S}-wal ${S}-shm && node --no-warnings tests/evidence/repeating-to-dos/seed.ts ${S} ${today} plain`, { stdio: 'ignore' })
  const context = await browser.newContext({ ...options, serviceWorkers: 'block' }), page = await context.newPage()
  await page.goto(`${base}/`); await wait(2400)
  plainTitle[width] = Math.round((await row(page, 'Send the signed').locator('.editor-task-title').boundingBox()).height)
  await context.close()
  return plainTitle[width]
}

for (const [options, plain] of [[wide, 44], [phone, 32]]) {
  const width = options.viewport.width
  const longPlain = await plainSeed(options)
  await scenario(`R1 ${width}: a repeating to-do is as tall as one that isn't, its icon is in line with the box, the long line takes at most one line more than without a repeat, never fewer`, async page => {
    const h = { offsite: await height(page, 'Reply about the offsite'), bins: await height(page, 'Take the bins out'), dentist: await height(page, 'Book the dentist') }
    const marks = await page.locator('.repeat-mark').count()
    const dentistTag = await row(page, 'Book the dentist').locator('.editor-date-tag').count(), dentistMark = await row(page, 'Book the dentist').locator('.repeat-mark').count()
    const long = Math.round((await row(page, 'Send the signed').locator('.editor-task-title').boundingBox()).height)
    const room = { title: Math.round((await row(page, 'Send the signed').locator('.editor-task-title').boundingBox()).width), tag: Math.round((await row(page, 'Send the signed').locator('.editor-date-tag').boundingBox()).width) }
    const off = []
    for (const title of ['Weekly review', 'Water the plants', 'Take the bins out', 'Send the signed']) {
      const box = await row(page, title).locator('input[type=checkbox]').boundingBox(), mark = await row(page, title).locator('.repeat-mark').boundingBox()
      off.push(Math.abs(centre(box) - centre(mark)))
    }
    return { ok: h.offsite === plain && h.bins === plain && marks === 4 && dentistTag >= 1 && dentistMark === 0 && long >= longPlain && long <= longPlain + 24 && off.every(d => d <= 1), h, marks, dentistTag, dentistMark, long, longPlain, room, lines: { with: long / 24, without: longPlain / 24 }, off }
  }, options)
}

await scenario('R2 1280: Repeat… → Weekly sets it, with its notice, its icon and one Undo', async page => {
  await menu(page, 'Reply about the offsite', 'Repeat…')
  await editor(page).locator('select[aria-label="Repeat"]').selectOption({ label: 'Weekly' }); await wait(1500)
  const said = await notices(page), stored = repeatOf('Reply about the offsite'), mark = await row(page, 'Reply about the offsite').getByRole('button', { name: 'Repeats every week' }).count()
  await page.keyboard.press('Escape'); await wait(300)
  await row(page, 'Reply about the offsite').hover(); await row(page, 'Reply about the offsite').locator('.editor-row-more').click(); await wait(200)
  const items = await page.getByRole('menuitem').allTextContents()
  await page.keyboard.press('Escape'); await wait(200)
  await page.getByRole('button', { name: 'Undo' }).first().click(); await wait(1500)
  const after = await row(page, 'Reply about the offsite').locator('.repeat-mark').count()
  return { ok: /Repeats every week/.test(said) && stored?.every === 'week' && stored.interval === 1 && mark === 1 && items.includes('Repeat · Every week…') && !items.includes('Repeat…') && !repeatOf('Reply about the offsite') && after === 0, said, stored, mark, items, after }
})

await scenario('R3 1280: the editor shows the rule, From and Ends change it, Off leaves only the Repeat field; it keeps its place on Off and on Weekly again, and Esc leaves focus in the line', async page => {
  await row(page, 'Weekly review').locator('.repeat-mark').click(); await wait(500)
  const e = editor(page), selected = name => e.locator(`select[aria-label="${name}"] option:checked`).textContent()
  const weekday = new Date(`${today}T12:00:00`).toLocaleDateString('en-US', { weekday: 'long' })
  const first = { repeat: await selected('Repeat'), every: await e.locator('.database-repeat-every input').inputValue(), unit: (await e.locator('.database-repeat-every').textContent()).trim(), days: await e.locator('.database-repeat-days button').count(), pressed: await e.locator('.database-repeat-days button[aria-pressed=true]').evaluateAll(bs => bs.map(b => [b.getAttribute('aria-label'), b.disabled])), from: await selected('From'), ends: await selected('Ends'), next: (await e.locator('.database-menu-quiet').textContent()).trim() }
  await e.locator('select[aria-label="From"]').selectOption({ label: "When it's done" }); await wait(1200)
  const done = { days: await e.locator('.database-repeat-days button').count(), next: (await e.locator('.database-menu-quiet').textContent()).trim(), stored: repeatOf('Weekly review')?.from }
  await e.locator('select[aria-label="Ends"]').selectOption({ label: 'On a date' }); await wait(1200)
  const date = { value: await e.locator('input[type=date]').inputValue(), stored: repeatOf('Weekly review')?.until }
  // Off takes the icon away: the editor keeps its place (it is placed against the line, not the icon), on Off and on Weekly again.
  const place = async () => { const b = await page.locator('.property-popover').boundingBox(); return b && { x: Math.round(b.x), y: Math.round(b.y) } }
  const at = { before: await place() }
  await e.locator('select[aria-label="Repeat"]').selectOption({ label: 'Off' }); await wait(1200)
  at.off = await place()
  const off = { selects: await e.locator('select').count(), inputs: await e.locator('input').count(), buttons: await e.locator('button').count(), stored: repeatOf('Weekly review') ?? null }
  await e.locator('select[aria-label="Repeat"]').selectOption({ label: 'Weekly' }); await wait(1200)
  at.again = await place()
  const near = p => Boolean(at.before && p && Math.abs(p.x - at.before.x) <= 4 && Math.abs(p.y - at.before.y) <= 4)
  const kept = { off: near(at.off), again: near(at.again) }
  // Esc: the icon that opened it is gone, so focus goes to the line (its caret), never to the page's body.
  await page.keyboard.press('Escape'); await wait(500)
  const focus = await page.evaluate(() => {
    const a = document.activeElement, sel = getSelection()?.anchorNode
    const lineOf = n => (n instanceof Element ? n : n?.parentElement)?.closest('.editor-task')
    const line = lineOf(a) ?? (a?.isContentEditable ? lineOf(sel) : null)
    return { on: a?.tagName ?? null, inRow: Boolean(line?.textContent.startsWith('Weekly review')) }
  })
  const ok = kept.off && kept.again && focus.on !== 'BODY' && focus.inRow
    && first.repeat === 'Weekly' && first.every === '1' && first.unit === 'week' && first.days === 7 && first.pressed.length === 1 && first.pressed[0][0] === weekday && first.pressed[0][1] === true
    && first.from === 'Its day' && first.ends === 'Never' && first.next === `Next ${label(plusDays(today, 7))}`
    && done.days === 0 && done.next.endsWith(' if done today') && done.stored === 'done'
    && date.value === plusDays(today, 28) && date.stored === plusDays(today, 28)
    && off.selects === 1 && off.inputs === 0 && off.buttons === 0 && off.stored === null
  return { ok, first, done, date, off, at, focus }
})

await scenario('R4 1280: by keyboard, Enter opens the editor, Tab reaches every control in order, Esc closes it onto the icon', async page => {
  await row(page, 'Weekly review').locator('input[type=checkbox]').focus()
  const onMark = () => page.evaluate(() => document.activeElement?.classList.contains('repeat-mark') && document.activeElement.closest('.editor-task')?.textContent.startsWith('Weekly review'))
  let tabs = 0
  while (!(await onMark()) && tabs < 8) { await page.keyboard.press(tab); tabs++ }
  if (!(await onMark())) return { ok: false, why: 'Tab never reached the icon', tabs }
  await page.keyboard.press('Enter'); await wait(500)
  // The controls in the order they are on screen, from the editor itself.
  const expected = await editor(page).evaluate(el => [...el.querySelectorAll('select, input, button:not([disabled])')].map(c => `${c.tagName.toLowerCase()}:${c.getAttribute('aria-label') ?? c.textContent}`))
  const seen = [], where = () => page.evaluate(() => { const a = document.activeElement; return { inside: Boolean(a?.closest('.todo-repeat-editor')), name: a ? `${a.tagName.toLowerCase()}:${a.getAttribute('aria-label') ?? a.textContent}` : '' } })
  const start = await where()
  if (start.inside) seen.push(start.name)
  for (let i = 0; i < expected.length + 2 && seen.length < expected.length; i++) { await page.keyboard.press(tab); const w = await where(); if (w.inside && !seen.includes(w.name)) seen.push(w.name) }
  const inOrder = JSON.stringify(seen) === JSON.stringify(expected)
  await page.keyboard.press('Escape'); await wait(500)
  const closed = (await editor(page).count()) === 0, back = await onMark()
  return { ok: tabs <= 8 && inOrder && expected.length >= 5 && closed && Boolean(back), tabs, expected, seen, closed, back }
})

await scenario('R5 1280: ticking Take the bins out names tomorrow, plans one next to-do on its page, and Undo takes both back', async page => {
  const before = tomorrowDoc()
  await row(page, 'Take the bins out').locator('input[type=checkbox]').click(); await wait(2000)
  const said = await notices(page), made = nextTodos(), rows = nextRows()
  await page.getByRole('button', { name: 'Undo' }).first().click(); await wait(2000)
  return { ok: said.includes(`Task completed · Next ${label(tomorrow)}`) && made.length === 1 && rows.length === 1 && nextTodos().length === 0 && nextRows().length === 0 && tomorrowDoc() === before && task('Take the bins out').status === 'open', said, made: made.map(t => t.id), rows: rows.length, after: nextTodos().length, same: tomorrowDoc() === before }
})

await scenario('R6 1280: Cancel task on Take the bins out names tomorrow and makes one next to-do', async page => {
  await menu(page, 'Take the bins out', 'Cancel task'); await wait(1800)
  const said = await notices(page)
  return { ok: said.includes(`Cancelled · Next ${label(tomorrow)}`) && nextTodos().length === 1 && task('Take the bins out').status === 'cancelled', said, made: nextTodos().length }
})

await scenario('R7 1280: the icon isn\'t text: End then ArrowDown types on the next line, a copy of the line leaves it out', async page => {
  const words = row(page, 'Weekly review').locator('.bn-inline-content')
  await words.click(); await page.keyboard.press(end); await page.keyboard.press('ArrowDown'); await page.keyboard.type('X'); await wait(1600)
  const typed = lines()
  await words.click({ clickCount: 3 }); await page.keyboard.press(process.platform === 'darwin' ? 'Meta+c' : 'Control+c'); await wait(250)
  const copied = engine === 'chromium' ? await page.evaluate(() => navigator.clipboard.readText()) : await page.evaluate(() => getSelection()?.toString() ?? '')
  // ArrowDown keeps the caret's place across, so the letter lands inside the next line's words, as it does on a line with no icon.
  return { ok: typed[0] === 'Weekly review' && typed[1]?.replace('X', '') === 'Water the plants' && typed[1].includes('X') && !/Repeat/.test(copied) && copied.trim() === 'Weekly review', typed: typed.slice(0, 3), copied }
})

await scenario('R8 390: a tap on the icon raises no keyboard and opens a sheet; the bar\'s More actions offers Repeat under Blocked by…', async page => {
  await row(page, 'Weekly review').locator('.repeat-mark').tap(); await wait(600)
  const focused = await page.evaluate(() => Boolean(document.activeElement?.closest('[contenteditable=true]')))
  const sheet = page.locator('[role=dialog]').filter({ has: page.locator('.todo-repeat-editor') })
  const text = (await sheet.textContent()) ?? '', hasDone = await sheet.getByRole('button', { name: 'Done', exact: true }).count()
  const sheetOk = text.includes('Repeat') && text.includes('Weekly review') && hasDone === 1
  await page.goto(`${base}/`); await wait(2200)
  await row(page, 'Weekly review').locator('.bn-inline-content').tap(); await wait(150)
  await page.locator('.editor-touch-handle').tap(); await wait(300)
  await page.locator('.editor-selection-bar [aria-label="More actions"]').tap(); await wait(300)
  const items = await page.getByRole('menuitem').allTextContents(), at = items.indexOf('Blocked by…')
  return { ok: !focused && sheetOk && at >= 0 && items[at + 1] === 'Repeat · Every week…', focused, sheetOk, hasDone, items }
}, phone)

await scenario('R9 1280, Tasks: the icon on the four repeating rows, Repeat in the menu under Blocked by…, a tick says Done · Next, Upcoming shows the next one with its icon', async page => {
  const marks = await page.locator('.task-row .repeat-mark').evaluateAll(bs => bs.map(b => b.closest('.task-row').querySelector('.task-title').textContent.slice(0, 18)))
  const bins = page.locator('.task-row', { hasText: /^Take the bins out/ }).first()
  await bins.hover(); await bins.locator('.row-menu .icon').click(); await wait(250)
  const items = await page.getByRole('menuitem').allTextContents(), at = items.findIndex(t => t.startsWith('Blocked by'))
  await page.keyboard.press('Escape'); await wait(200)
  await bins.locator('input[type=checkbox]').click(); await wait(1800)
  const said = await notices(page)
  await page.goto(`${base}/tasks?view=upcoming`); await wait(2200)
  const next = page.locator('.task-row', { hasText: /^Take the bins out/ })
  const upcoming = await page.locator('main').innerText().catch(() => '')
  const shown = await next.count(), mark = await next.locator('.repeat-mark').count()
  const group = upcoming.indexOf(label(tomorrow).split(',')[0]) >= 0 || /Tomorrow/.test(upcoming)
  return { ok: marks.length === 4 && at >= 0 && items[at + 1].startsWith('Repeat') && said.includes(`Done · Next ${label(tomorrow)}`) && shown === 1 && mark === 1 && group, marks, items, said, shown, mark, group, upcoming: upcoming.replace(/\s+/g, ' ').slice(0, 300) }
}, wide, '/tasks')

await scenario('R10 1280, Notes: a reference line has the icon and no ⋯; the icon opens the editor', async page => {
  const r = row(page, 'Weekly review')
  const marks = await r.locator('.repeat-mark').count(), more = await r.locator('.editor-row-more').count()
  await r.locator('.repeat-mark').click(); await wait(500)
  return { ok: marks === 1 && more === 0 && (await editor(page).count()) === 1, marks, more }
}, wide, '/pages?page=notes')

await scenario('R11 1280: offline, a tick makes no next to-do and no notice about one; back online it makes exactly one, quietly', async page => {
  const context = page.context()
  await context.setOffline(true); await wait(300)
  await row(page, 'Take the bins out').locator('input[type=checkbox]').click(); await wait(800)
  // Client-side, so the page is not reloaded (offline it could not be): the router follows the address, as it does for a link inside the app.
  await page.evaluate(day => { window.__stayed = true; history.pushState({}, '', `/day/${day}`); dispatchEvent(new PopStateEvent('popstate')) }, tomorrow); await wait(1500)
  const offline = { said: await notices(page), rows: await page.locator('.editor-task').count(), stayed: await page.evaluate(() => window.__stayed === true), onTomorrow: (await page.locator('h1').first().innerText()).includes('Tomorrow') || page.url().includes(tomorrow) }
  await context.setOffline(false); await wait(6000)
  const said = await notices(page)
  return { ok: !/Next/.test(offline.said) && offline.rows === 1 && offline.stayed && offline.onTomorrow && nextTodos().length === 1 && !/Next/.test(said) && task('Take the bins out').status === 'done', offline, said, made: nextTodos().length, url: page.url() }
})

for (const options of [wide, phone]) {
  await scenario(`R12 ${options.viewport.width}, dark: the icon's colour is the ink-3 colour; the editor opens`, async page => {
    const colours = await page.locator('.repeat-mark').first().evaluate(el => {
      const probe = document.createElement('span'); probe.style.color = 'var(--ink-3)'; el.parentElement.append(probe)
      const ink = getComputedStyle(probe).color; probe.remove()
      return { mark: getComputedStyle(el).color, ink }
    })
    const dark = await page.evaluate(() => matchMedia('(prefers-color-scheme: dark)').matches)
    await row(page, 'Weekly review').locator('.repeat-mark').click(); await wait(600)
    if (shots) await page.screenshot({ path: `${shots}/repeat-R12-${engine}-${options.viewport.width}-editor.png` }).catch(() => {})
    return { ok: dark && colours.mark === colours.ink && (await editor(page).count()) === 1, dark, colours }
  }, { ...options, colorScheme: 'dark' })
}
await browser.close()
console.log(failed ? `${failed} failed` : 'all passed')
process.exit(failed ? 1 : 0)
