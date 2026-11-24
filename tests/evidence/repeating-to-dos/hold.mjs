// A tick that writes an open page (repeating-to-dos.md §6) in the built app: the page's editor saves what was typed, holds typing, and shows the
// server's page, so no conflict shows and no word is lost; a to-do with no repeat ticks at once, as it always did.
// Usage: node tests/evidence/repeating-to-dos/hold.mjs <base-url> <store-path> [chromium|webkit]  (a throwaway store the server at <base-url> uses)
import * as pw from '@playwright/test'
import { execSync } from 'node:child_process'
const [base, S, engine = 'chromium'] = process.argv.slice(2)
if (!base || !S) { console.error('Usage: node tests/evidence/repeating-to-dos/hold.mjs <base-url> <store-path> [chromium|webkit]'); process.exit(2) }
const today = new Date().toLocaleDateString('en-CA')
const plusDays = (iso, n) => { const d = new Date(`${iso}T00:00:00Z`); d.setUTCDate(d.getUTCDate() + n); return d.toISOString().slice(0, 10) }
const tomorrow = plusDays(today, 1)
const shortDate = iso => new Date(`${iso}T12:00:00Z`).toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric', timeZone: 'UTC' })
const store = () => JSON.parse(execSync(`sqlite3 ${S} "select data from workspace"`, { maxBuffer: 1 << 26 }).toString())
const task = title => store().tasks.find(t => t.title.startsWith(title))
const flat = nodes => nodes.flatMap(n => [n, ...flat(n.children ?? [])])
const doc = id => JSON.parse(store().pages.find(p => p.id === id)?.document ?? '[]')
const tomorrowDoc = () => doc(`day:${tomorrow}`)
const nextRows = () => flat(tomorrowDoc()).filter(n => n.type === 'task' && String(n.props?.taskId ?? '').endsWith(`.${tomorrow}`))
const nextTodos = () => store().tasks.filter(t => t.id.endsWith(`.${tomorrow}`))
const wait = ms => new Promise(r => setTimeout(r, ms))
const browser = await pw[engine].launch({ headless: true })
const wide = { viewport: { width: 1280, height: 900 } }
let failed = 0
const scenario = async (name, act, options = wide, path = '/', seed = '') => {
  if (process.env.ONLY && !name.includes(process.env.ONLY)) return
  execSync(`rm -f ${S} ${S}-wal ${S}-shm && node --no-warnings tests/evidence/repeating-to-dos/seed.ts ${S} ${today} ${seed}`, { stdio: 'ignore' })
  const context = await browser.newContext({ ...options, serviceWorkers: 'block' }), page = await context.newPage(), errors = [], requests = []
  page.on('pageerror', e => { if (!/ResizeObserver loop/.test(e.message)) errors.push(e.message) })
  page.on('request', r => { if (r.method() === 'POST' && r.url().includes('/_serverFn/')) requests.push({ at: Date.now(), body: r.postData() ?? '' }) })
  let r
  try { await page.goto(`${base}${path}`); await wait(2400); r = await act(page, { context, requests }) } catch (e) { r = { ok: false, threw: e.message.split('\n').slice(0, 4).join(' ') } }
  const ok = r.ok && !errors.length
  if (!ok) failed++
  console.log(ok ? 'PASS' : 'FAIL', name, JSON.stringify({ ...r, errors }).slice(0, 900))
  await context.close()
}
// `has` is relative to the row, so it is built from the page, not the scope (a pane or the peek).
const row = (scope, title) => scope.locator('.editor-task', { has: (scope.page?.() ?? scope).locator('.editor-task-title', { hasText: new RegExp(`^${title}`) }) }).first()
const box = (scope, title) => row(scope, title).locator('input[type=checkbox]')
const notices = page => page.locator('[role=alert], [role=status]').allTextContents().then(t => t.join(' | ').replace(/\s+/g, ' '))
/** Types at the end of a line, by its block id. */
const typeAtEnd = async (scope, page, blockId, words) => {
  await scope.locator(`[data-node-type="blockContainer"][data-id="${blockId}"] .bn-inline-content`).first().click()
  await page.keyboard.press(engine === 'webkit' ? 'Meta+ArrowRight' : 'End')
  await page.keyboard.type(words)
}
/** "No conflict": every 200 ms for 3 s, no conflict line and no words saying the page changed elsewhere. */
const noConflict = async page => {
  const seen = []
  for (let i = 0; i < 15; i++) {
    const s = await page.evaluate(() => ({ line: document.querySelectorAll('.editor-save-line.is-conflict').length, text: /changed elsewhere|draft kept/i.test(document.body.innerText) }))
    if (s.line || s.text) seen.push({ at: i * 200, ...s })
    await wait(200)
  }
  return seen
}
const editable = scope => scope.locator(`[data-node-type="blockContainer"][data-id="tp"]`).first().evaluate(el => el.closest('[contenteditable]')?.getAttribute('contenteditable') === 'true')
const docText = () => JSON.stringify(tomorrowDoc())
const notice = `Task completed · Next ${shortDate(tomorrow)}`
const reopenedAndCurrent = () => { const c = task('Take the bins out'), s = store(); return c.status === 'open' && (s.todoRepeats ?? []).some(r => r.taskId === c.id) }

/** H1's steps on the page in `scope`; returns what H1 must hold. */
const tickTomorrow = async (page, scope, tickScope = scope) => {
  await typeAtEnd(scope, page, 'tp', ' kept')
  await box(tickScope, 'Take the bins out').click()
  const conflicts = await noConflict(page)
  await wait(1200)
  const said = await notices(page), rows = nextRows()
  return { conflicts, kept: docText().includes('kept'), rows: rows.length, said, editable: await editable(scope) }
}

await scenario('H1: tomorrow\'s page, typed and at once its reference line ticked: saved, held, shown, no conflict', async page => {
  const r = await tickTomorrow(page, page)
  const checks = { noConflict: !r.conflicts.length, kept: r.kept, oneNextRow: r.rows === 1, notice: r.said.includes(notice), editable: r.editable }
  return { ok: Object.values(checks).every(Boolean), checks, ...r }
}, wide, `/day/${tomorrow}`)

await scenario('H2: the same with tomorrow in a side peek and the tick in the main pane', async page => {
  const peek = page.locator('.peek')
  if (!(await peek.locator('[data-id="tp"]').count())) return { ok: false, peekOpened: false, url: page.url() }
  const r = await tickTomorrow(page, peek, page.locator('.app-main'))
  const checks = { noConflict: !r.conflicts.length, kept: r.kept, oneNextRow: r.rows === 1, notice: r.said.includes(notice), editable: r.editable }
  return { ok: Object.values(checks).every(Boolean), checks, ...r }
}, wide, `/day/${today}?peek=day%3A${tomorrow}&side=1`)

await scenario('H3: after the tick, more typed and the notice\'s Undo: the next one goes, both words stay, no conflict', async page => {
  await tickTomorrow(page, page)
  await typeAtEnd(page, page, 'tp', ' more')
  await page.getByRole('button', { name: 'Undo' }).first().click()
  const conflicts = await noConflict(page)
  await wait(1200)
  const text = docText()
  const checks = { noConflict: !conflicts.length, kept: text.includes('kept'), more: text.includes('more'), noNextRow: nextRows().length === 0, reopenedAndCurrent: reopenedAndCurrent() }
  return { ok: Object.values(checks).every(Boolean), checks, conflicts }
}, wide, `/day/${tomorrow}`)

await scenario('H4: after the tick, more typed and the same box tapped again: reopened, the next one goes, no conflict', async page => {
  await tickTomorrow(page, page)
  await typeAtEnd(page, page, 'tp', ' more')
  await box(page, 'Take the bins out').click()
  const conflicts = await noConflict(page)
  await wait(1200)
  const text = docText(), said = await notices(page)
  const checks = { noConflict: !conflicts.length, kept: text.includes('kept'), more: text.includes('more'), noNextRow: nextRows().length === 0, reopenedAndCurrent: reopenedAndCurrent(), notice: said.includes('Task reopened') }
  return { ok: Object.values(checks).every(Boolean), checks, conflicts, said }
}, wide, `/day/${tomorrow}`)

await scenario('H5: a double tap while the page is held sends one tick and makes one next to-do', async (page, { requests }) => {
  await typeAtEnd(page, page, 'tp', ' kept')
  await box(page, 'Take the bins out').dblclick()
  await wait(4500)
  const ticks = requests.filter(q => q.body.includes('task-status') && q.body.includes('done'))
  const checks = { oneTick: ticks.length === 1, oneNextTodo: nextTodos().length === 1 }
  return { ok: Object.values(checks).every(Boolean), checks, ticks: ticks.length, nextTodos: nextTodos().length }
}, wide, `/day/${tomorrow}`)

await scenario('H6: a to-do with no repeat ticks at once, not made to wait for the save', async (page, { requests }) => {
  await typeAtEnd(page, page, 'p', ' kept')
  const tapped = Date.now()
  await box(page, 'Book the dentist').click()
  await wait(2000)
  const tick = requests.find(q => q.body.includes('task-status'))
  const after = tick ? tick.at - tapped : null
  return { ok: after !== null && after <= 300, after, done: task('Book the dentist').status }
}, wide, `/day/${today}`)

await scenario('H7: offline, the tick still goes once and nothing is drawn; no word is lost', async (page, { context }) => {
  const rowsBefore = await page.locator('.editor-task').count()
  await context.setOffline(true)
  await typeAtEnd(page, page, 'tp', ' kept')
  await box(page, 'Take the bins out').click()
  await wait(1500)
  const said = await notices(page), rowsOffline = await page.locator('.editor-task').count()
  await context.setOffline(false)
  await wait(6000)
  const conflict = await page.locator('.editor-save-line.is-conflict').count(), line = (await page.locator('.editor-save-line').first().textContent())?.trim()
  const inEditor = await page.locator('[data-node-type="blockContainer"][data-id="tp"]').first().textContent()
  // "Decisions for Brian" 3: a tick sent later can be held by the outbox's row check, as any change can; say so if it was.
  const banner = (await page.evaluate(() => document.body.innerText.split('\n').find(l => /^Not saved|changed elsewhere/i.test(l)) ?? '')).trim()
  const checks = { noNext: !said.includes('Next'), noNewRow: rowsOffline === rowsBefore, oneNextTodo: nextTodos().length === 1, noLostWord: inEditor.includes('kept') || docText().includes('kept') }
  return { ok: Object.values(checks).every(Boolean), checks, saw: { conflict: conflict > 0, line, banner, tick: task('Take the bins out').status, keptInEditor: inEditor.includes('kept'), keptStored: docText().includes('kept'), nextRowsStored: nextRows().length } }
}, wide, `/day/${tomorrow}`)

await browser.close()
console.log(failed ? `${failed} failed` : 'all passed')
process.exit(failed ? 1 : 0)
