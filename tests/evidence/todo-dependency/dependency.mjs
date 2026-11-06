// To-do links in the built app (todo-dependency.md §2, §6): the mark and its height, the picker, a tick, the caret and keys, a copy, and Tasks.
// Usage: node tests/evidence/todo-dependency/dependency.mjs <base-url> <store-path> [chromium|webkit] [shots-dir]  (a throwaway store the server at <base-url> uses)
import * as pw from '@playwright/test'
import { execSync } from 'node:child_process'
const [base, S, engine = 'chromium', shots] = process.argv.slice(2)
if (!base || !S) { console.error('Usage: node tests/evidence/todo-dependency/dependency.mjs <base-url> <store-path> [chromium|webkit] [shots-dir]'); process.exit(2) }
const today = new Date().toLocaleDateString('en-CA')
const store = () => JSON.parse(execSync(`sqlite3 ${S} "select data from workspace"`, { maxBuffer: 1 << 26 }).toString())
const task = title => store().tasks.find(t => t.title.startsWith(title))
const links = () => (store().links ?? []).map(l => `${store().tasks.find(t => t.id === l.blockedId)?.title}<${store().tasks.find(t => t.id === l.blockerId)?.title}`)
const lines = () => JSON.parse(store().pages.find(p => p.id === `day:${today}`).document).map(n => n.content?.[0]?.text ?? '')
const wait = ms => new Promise(r => setTimeout(r, ms))
const browser = await pw[engine].launch({ headless: true })
const wide = { viewport: { width: 1280, height: 900 } }, phone = { viewport: { width: 390, height: 780 }, hasTouch: true }
let failed = 0
const scenario = async (name, act, options = wide, path = '/') => {
  if (process.env.ONLY && !name.includes(process.env.ONLY)) return
  execSync(`rm -f ${S} ${S}-wal ${S}-shm && node --no-warnings tests/evidence/todo-dependency/seed.ts ${S} ${today}`, { stdio: 'ignore' })
  const context = await browser.newContext({ ...options, serviceWorkers: 'block', permissions: engine === 'chromium' ? ['clipboard-read', 'clipboard-write'] : [] }), page = await context.newPage(), errors = []
  page.on('pageerror', e => { if (!/ResizeObserver loop/.test(e.message)) errors.push(e.message) })
  let r
  try { await page.goto(`${base}${path}`); await wait(2400); r = await act(page) } catch (e) { r = { ok: false, threw: e.message.split('\n').slice(0, 4).join(' ') } }
  const ok = r.ok && !errors.length
  if (!ok) failed++
  console.log(ok ? 'PASS' : 'FAIL', name, JSON.stringify({ ...r, errors }).slice(0, 700))
  if (shots) await page.screenshot({ path: `${shots}/dep-${name.replace(/\W+/g, '-').slice(0, 26)}-${engine}-${options.viewport.width}.png` }).catch(() => {})
  await context.close()
}
const row = (page, title) => page.locator('.editor-task', { has: page.locator('.editor-task-title', { hasText: new RegExp(`^${title}`) }) }).first()
const height = async (page, title) => Math.round((await row(page, title).boundingBox()).height)
const menu = async (page, title, item) => { await row(page, title).hover(); await row(page, title).locator('.editor-row-more').click(); await wait(200); await page.getByRole('menuitem', { name: item }).click(); await wait(300) }
const notices = page => page.locator('[role=alert], [role=status]').allTextContents().then(t => t.join(' | ').replace(/\s+/g, ' '))

for (const [options, plain, marked] of [[wide, 44, 60], [phone, 32, 48]]) {
  await scenario(`${options.viewport.width}: a to-do with no link is as it was; one with a link grows 16 px, its mark under the words`, async page => {
    const h = { alpha: await height(page, 'Alpha'), bravo: await height(page, 'Bravo'), echo: await height(page, 'Echo') }
    const box = await row(page, 'Alpha').locator('.blocked-mark').boundingBox(), words = await row(page, 'Alpha').locator('.editor-task-title').boundingBox()
    const echo = await row(page, 'Echo').locator('.blocked-mark').boundingBox(), echoRow = await row(page, 'Echo').boundingBox()
    const texts = await page.locator('.blocked-mark').allTextContents()
    return { ok: h.bravo === plain && h.alpha === marked && Math.round(box.x) === Math.round(words.x) && box.y >= words.y + words.height - 8 && echo.x + echo.width <= echoRow.x + echoRow.width + 0.5 && texts.join('|') === 'Blocked by Bravo|Blocked by 2|Blocked by Send the signed lease form back to the landlord before the end of the month', h, texts }
  }, options)
}

await scenario('Blocked by…: current ones ticked, itself not offered, a loop greyed with why; a pick links it with one Undo', async page => {
  await menu(page, 'Charlie', 'Blocked by 2…')
  const listed = await page.locator('.property-options [role=option]').allTextContents()
  const ticked = await page.locator('.property-options [role=option][aria-selected=true]').allTextContents()
  const greyed = await page.locator('.property-options [role=option][aria-disabled=true]').allTextContents()
  await page.locator('.property-options [role=option]', { hasText: /^Alpha/ }).click(); await wait(100)
  await page.locator('.property-options [role=option]', { hasText: /^Echo/ }).click(); await wait(100)
  await page.keyboard.press('Escape'); await wait(1200)
  const after = links(), said = await notices(page)
  await page.getByRole('button', { name: 'Undo' }).first().click(); await wait(1200)
  const undone = links()
  return { ok: !listed.some(t => t.startsWith('Charlie')) && ticked.length === 2 && greyed.length === 0 && after.includes('Charlie<Echo') && !after.includes('Charlie<Alpha') && /Blockers changed/.test(said) && undone.includes('Charlie<Alpha') && !undone.includes('Charlie<Echo'), listed, ticked, greyed, after, said, undone }
})

await scenario('A loop is greyed and says why, and can\'t be picked', async page => {
  await menu(page, 'Bravo', 'Blocked by…')
  const greyed = await page.locator('.property-options [role=option][aria-disabled=true]').allTextContents()
  await page.locator('.property-options [role=option]', { hasText: /^Charlie/ }).click({ force: true }); await wait(100)
  await page.keyboard.press('Escape'); await wait(1000)
  return { ok: greyed.some(t => /^Alpha.*Waits on this one/.test(t)) && greyed.some(t => /^Charlie.*Waits on this one/.test(t)) && !links().some(l => l.startsWith('Bravo<')), greyed, links: links() }
})

await scenario('Ticking a blocker: the mark goes, its line keeps its height until a scroll, and no date or line moves', async page => {
  const before = JSON.stringify(store().tasks.map(t => [t.id, t.attentionOn, t.deadlineOn])), docs = JSON.stringify(lines())
  await row(page, 'Bravo').locator('input[type=checkbox]').click(); await wait(1500)
  const mark = await row(page, 'Alpha').locator('.blocked-mark:not(.is-held)').count(), kept = await height(page, 'Alpha')
  await page.mouse.wheel(0, 40); await wait(400)
  const after = await height(page, 'Alpha')
  await row(page, 'Bravo').locator('input[type=checkbox]').click(); await wait(1500)
  const back = await row(page, 'Alpha').locator('.blocked-mark').textContent()
  return { ok: mark === 0 && kept === 60 && after === 44 && back === 'Blocked by Bravo' && JSON.stringify(store().tasks.map(t => [t.id, t.attentionOn, t.deadlineOn])) === before && JSON.stringify(lines()) === docs, mark, kept, after, back }
})

await scenario('A tap on the mark opens the blocker\'s line; with two, a menu names them', async page => {
  const went = []; page.on('framenavigated', f => { if (f === page.mainFrame()) went.push(f.url()) })
  await row(page, 'Alpha').locator('.blocked-mark').click(); await wait(800)
  const url = new URL(went.find(u => u.includes('block=')) ?? page.url()), bravoLine = JSON.parse(store().pages.find(p => p.id === `day:${today}`).document).find(n => n.content?.[0]?.text === 'Bravo').id
  await page.goto(`${base}/`); await wait(2200)
  await row(page, 'Charlie').locator('.blocked-mark').click(); await wait(300)
  const named = await page.getByRole('menuitem').allTextContents()
  return { ok: url.searchParams.get('block') === bravoLine && named.join() === 'Alpha,Delta', block: url.searchParams.get('block'), bravoLine, named }
})

await scenario('The mark isn\'t text: the caret steps over it, a copy of the line leaves it out, and keys beside it act as on any line', async page => {
  const words = row(page, 'Alpha').locator('.bn-inline-content')
  await words.click(); await page.keyboard.press(engine === 'webkit' ? 'Meta+ArrowRight' : 'End'); await page.keyboard.press('ArrowDown'); await page.keyboard.type('X'); await wait(1400)
  const typed = lines()
  await page.keyboard.press('Backspace'); await wait(1200)
  // Backspace at the start of a line after an unmarked one, for what that does today.
  const caretAt = async title => { await row(page, title).locator('.bn-inline-content').click(); await page.keyboard.press(engine === 'webkit' ? 'Meta+ArrowLeft' : 'Home') }
  const beforeKeys = lines()
  await caretAt('Charlie'); await page.keyboard.press('Backspace'); await wait(1400)
  const afterPlain = lines()
  // Copy Alpha's words and its mark's place.
  await words.click({ clickCount: 3 }); await page.keyboard.press(process.platform === 'darwin' ? 'Meta+c' : 'Control+c'); await wait(200)
  const copied = engine === 'chromium' ? await page.evaluate(() => navigator.clipboard.readText()) : await page.evaluate(() => getSelection()?.toString() ?? '')
  // Backspace at the start of the line after a marked one, as on a line after an unmarked one: the line before stays.
  await caretAt('Bravo'); await page.keyboard.press('Backspace'); await wait(1400)
  const afterMarked = lines()
  // The same thing happens on both: whatever Backspace does at a to-do's start, the mark above changes nothing.
  const same = (JSON.stringify(beforeKeys) === JSON.stringify(afterPlain)) === (JSON.stringify(afterPlain) === JSON.stringify(afterMarked))
  return { ok: typed[1] === 'BravoX' && !copied.includes('Blocked') && same && afterMarked.some(l => l.startsWith('Alpha')) && task('Alpha') !== undefined, typed: typed.slice(0, 3), copied, beforeKeys: beforeKeys.slice(0, 4), afterPlain: afterPlain.slice(0, 4), afterMarked: afterMarked.slice(0, 4) }
})

await scenario('390: a tap on the mark raises no keyboard and opens the line; the picker is a sheet', async page => {
  const went = []; page.on('framenavigated', f => { if (f === page.mainFrame()) went.push(f.url()) })
  await row(page, 'Alpha').locator('.blocked-mark').tap(); await wait(800)
  const focused = await page.evaluate(() => Boolean(document.activeElement?.closest('[contenteditable=true]')))
  await page.goto(`${base}/`); await wait(2200)
  // A line chosen by its handle shows its actions in the bar.
  await row(page, 'Delta').locator('.bn-inline-content').tap(); await wait(150)
  await page.locator('.editor-touch-handle').tap(); await wait(300)
  await page.locator('.editor-selection-bar [aria-label="More actions"]').tap(); await wait(300)
  const offered = await page.getByRole('menuitem', { name: 'Blocked by…' }).count()
  await page.getByRole('menuitem', { name: 'Blocked by…' }).tap(); await wait(400)
  const sheet = await page.locator('.property-options [role=option]').count()
  return { ok: !focused && went.some(u => u.includes('block=')) && offered === 1 && sheet === 5, focused, went, offered, sheet }
}, phone)

await scenario('Tasks: the mark under its words, and Blocked by… in its menu', async page => {
  const texts = await page.locator('.task-row .blocked-mark').allTextContents()
  const r = page.locator('.task-row', { hasText: /^Alpha/ }).first()
  await r.hover(); await r.locator('.row-menu .icon').click(); await wait(200)
  const offered = await page.getByRole('menuitem', { name: 'Blocked by 1…' }).count()
  return { ok: texts.includes('Blocked by Bravo') && texts.includes('Blocked by 2') && offered === 1, texts, offered }
}, wide, '/tasks')
await scenario('To-dos: Blocked by and Blocking shown under Properties, read both sides, and the cell sets one, greying a loop', async page => {
  const headsBefore = await page.locator('.database-table th, [role=columnheader]').allTextContents()
  await page.locator('.database-more-button').first().click(); await wait(250)
  await page.locator('.database-menu').getByRole('menuitem', { name: /^Properties/ }).click(); await wait(250)
  await page.getByLabel('Show Blocked by').check(); await page.getByLabel('Show Blocking').check(); await wait(800)
  await page.keyboard.press('Escape'); await wait(300)
  const cell = (title, column) => page.locator(`tr[data-row="todo:${task(title).id}"] [data-cell*="${column}"]`).first()
  const alpha = (await cell('Alpha', 'blockedBy').textContent())?.trim(), bravo = (await page.locator(`tr[data-row="todo:${task('Bravo').id}"]`).textContent())?.replace(/\s+/g, ' ').trim()
  await cell('Delta', 'blockedBy').click(); await wait(400)
  const greyed = await page.locator('.property-options [role=option][aria-disabled=true]').allTextContents(), offered = await page.locator('.property-options [role=option]').allTextContents()
  await page.locator('.property-options [role=option]', { hasText: /^Echo/ }).click(); await wait(100)
  await page.keyboard.press('Escape'); await wait(1200)
  return { ok: !headsBefore.some(t => /Blocked by|Blocking/.test(t)) && alpha === 'Bravo' && /^Bravo.*Alpha/.test(bravo) && greyed.some(t => t.startsWith('Charlie')) && !offered.some(t => t.startsWith('Delta')) && links().includes('Delta<Echo'), headsBefore, offered, alpha, bravo, greyed, links: links() }
}, wide, '/pages?page=lists')
await browser.close()
console.log(failed ? `${failed} failed` : 'all passed')
process.exit(failed ? 1 : 0)
