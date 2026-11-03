// B22: a pasted to-do is the same task, in the built app, on a fresh store for each step. The clipboard is driven by real
// copy and paste events carrying a DataTransfer, so both engines run the same path.
// Usage: node tests/evidence/b22/paste.mjs <base-url> <store-path> <today> <1280|390> [chromium|webkit] [shots-dir]  (a throwaway store the server at <base-url> uses)
import * as pw from '@playwright/test'
import { execSync } from 'node:child_process'
const [base, storePath, today, width, engine = 'chromium', shots] = process.argv.slice(2)
if (!base || !storePath || !today || !width) { console.error('Usage: node tests/evidence/b22/paste.mjs <base-url> <store-path> <today> <1280|390> [chromium|webkit] [shots-dir]'); process.exit(2) }
const wide = width === '1280'
const store = () => JSON.parse(execSync(`sqlite3 ${storePath} "select data from workspace"`, { maxBuffer: 1 << 26 }).toString())
const browser = await pw[engine].launch({ headless: true })
const context = await browser.newContext({ viewport: { width: Number(width), height: wide ? 900 : 844 }, hasTouch: !wide, serviceWorkers: 'block' })
const page = await context.newPage()
const errors = []; page.on('pageerror', e => { if (!/access control checks/.test(e.message)) errors.push(e.message) })
let fails = 0
const check = (ok, what, extra) => { if (!ok) fails++; console.log(ok ? 'PASS' : 'FAIL', what, extra === undefined ? '' : JSON.stringify(extra)) }
const wait = ms => page.waitForTimeout(ms)
const shot = async name => { if (shots) await page.screenshot({ path: `${shots}/${engine}-${width}-${name}.png` }) }
const fresh = async () => { execSync(`rm -f ${storePath} ${storePath}-wal ${storePath}-shm && node tests/evidence/b22/seed.ts ${storePath} ${today}`, { stdio: 'ignore' }); await page.goto(`${base}/day/${today}`); await wait(2500) }
const pageOf = id => store().pages.find(p => p.id === id)
const nodes = id => { const flat = l => l.flatMap(n => [n, ...flat(n.children ?? [])]); return flat(JSON.parse(pageOf(id).document)) }
const tasks = () => store().tasks
const task = title => tasks().find(t => t.title === title)
const rowsOf = id => nodes(id).filter(n => n.type === 'task' && n.content?.length)
/** Selects a row by its handle (1280), or opens it by a tap; then Copy from its ⋯, as the phone does. What it copied is read back from what the app kept. */
const copyRow = async title => {
  const row = page.locator('.editor-task', { hasText: title }).first()
  if (wide) { await row.hover(); await row.locator('.editor-row-more').click() }
  else {
    // The phone: a tap on the row, its grip at the right edge, then the bar's ⋯ (A12 §2).
    await row.locator('.editor-task-title').tap(); await wait(500)
    await page.locator('.editor-touch-handle').first().tap(); await wait(500)
    await page.getByRole('button', { name: 'More actions' }).tap()
  }
  await wait(250)
  const item = page.getByRole('menuitem', { name: 'Copy', exact: true }).first()
  if (wide) await item.click(); else await item.tap()
  await wait(400)
  return page.evaluate(() => { const k = JSON.parse(localStorage.getItem('daythread:last-copy')); return JSON.stringify({ blocks: k.blocks, cut: false, token: 'x' }) })
}
const pasteOn = async (url, text, payload) => {
  if (url) { await page.goto(`${base}${url}`); await wait(2500) }
  const el = text === null ? page.locator('.bn-inline-content').last() : page.locator('.bn-inline-content', { hasText: text }).first()
  await (wide ? el.click() : el.tap()); await wait(200)
  await page.evaluate(p => { const data = new DataTransfer(); data.setData('application/x-daythread-blocks', p); data.setData('text/plain', ''); document.activeElement.dispatchEvent(new ClipboardEvent('paste', { clipboardData: data, bubbles: true, cancelable: true })) }, payload)
  await wait(1500)
}
const notice = () => page.locator('[data-slot="toast"]').allInnerTexts()
const tapBtn = name => { const b = page.locator('[data-slot="toast"]').getByRole('button', { name }).first(); return wide ? b.click() : b.tap() }

// 1. Copied to another page: the same task, a reference row, with the notice.
const wordsOf = b => (b.content ?? []).map(c => c.text).join('')
// A fresh store has new task ids, so each step copies again.
let one, payload, taskBlocks, trv
const setup = async () => {
  await fresh()
  one = await copyRow('TRV')
  const two = await copyRow('Book the train')
  taskBlocks = [JSON.parse(one).blocks[0], JSON.parse(two).blocks[0]]
  payload = JSON.stringify({ blocks: taskBlocks, cut: false, token: 'x' })
  trv = task('TRV').id
}
await setup()
check(taskBlocks.every(b => b.type === 'task') && wordsOf(taskBlocks[0]) === 'TRV', 'Copy on a row keeps it a task', taskBlocks.map(wordsOf))
await pasteOn('/pages?page=trips', null, one)
check(tasks().length === 2, 'no new task', tasks().map(t => t.title))
check(rowsOf('trips').some(n => n.props.taskId === trv && n.props.role === 'reference'), 'a reference row to the same task', rowsOf('trips').map(n => n.props))
check(rowsOf(`day:${today}`).some(n => n.props.taskId === trv && n.props.role === 'plan'), 'still planned on its day')
const said = (await notice()).join('|')
check(/Pasted as the same task/.test(said) && /Make a copy/.test(said) && /Undo/.test(said), 'the notice says so, with Make a copy and Undo', said)
await shot('pasted')
// A tick reaches it on its day page.
await page.locator('[data-slot="toast-close"]').first().click({ force: true }).catch(() => {}); await wait(300)
{ const b = page.locator('input[aria-label="Complete TRV"]').first(); await (wide ? b.click() : b.tap()) } await wait(1200)
check(task('TRV')?.status === 'done', 'a tick on the pasted row ticks the one task', task('TRV')?.status)
await page.goto(`${base}/day/${today}`); await wait(2500)
check(await page.locator('.editor-task[data-status="done"]', { hasText: 'TRV' }).count() === 1, 'and it shows ticked on its day page')
// A ticked task pastes as a ticked reference row (B22-6).
await pasteOn('/pages?page=later', null, one)
check(tasks().length === 2 && await page.locator('.editor-task[data-status="done"]', { hasText: 'TRV' }).count() === 1, 'a ticked task pastes ticked')

// 2. Undo from the notice takes the row away and nothing else.
await setup(); await pasteOn('/pages?page=trips', null, one)
await tapBtn('Undo'); await wait(1500)
check(rowsOf('trips').length === 0 && tasks().length === 2 && rowsOf(`day:${today}`).length === 2, "Undo takes the pasted row away, and the task stays")

// 3. Make a copy: its own task; Undo goes back to the same task.
await setup(); await pasteOn('/pages?page=trips', null, one)
await tapBtn('Make a copy'); await wait(1500)
check(tasks().length === 3 && rowsOf('trips').some(n => n.props.taskId !== trv), 'Make a copy makes its own task', tasks().map(t => t.title))
check(rowsOf(`day:${today}`).some(n => n.props.taskId === trv), 'and the first keeps its row')
check(/Made a copy/.test((await notice()).join('|')), 'and says so')

// 4. Two rows.
await setup(); await pasteOn('/pages?page=trips', null, payload)
check(/Pasted as the same tasks/.test((await notice()).join('|')) && tasks().length === 2, 'two rows: the plural notice, and no new tasks', await notice())
await tapBtn('Make copies'); await wait(1500)
check(tasks().length === 4, 'Make copies makes both', tasks().length)

// 5. On a page already showing it: a new task, and no notice.
await setup(); await pasteOn(null, null, one)
check(tasks().length === 3 && !/same task/.test((await notice()).join('|')), 'pasted on its own page: a separate task, as before', tasks().map(t => t.title))

// 6. A copy with old words doesn't rename the task.
await setup()
const stale = JSON.parse(one); stale.blocks[0].content = [{ type: 'text', text: 'An old title', styles: {} }]
await pasteOn('/pages?page=trips', null, JSON.stringify(stale))
check(task('TRV')?.id === trv && JSON.stringify(rowsOf('trips')[0]?.content).includes('TRV'), "old words don't rename the task", rowsOf('trips')[0]?.content)

// 7. A task that's gone, or a row from elsewhere: a new task, as before.
await setup()
const unknown = JSON.parse(one); unknown.blocks[0].props.taskId = 'gone'; unknown.blocks[0].content = [{ type: 'text', text: 'From elsewhere', styles: {} }]
await pasteOn('/pages?page=trips', null, JSON.stringify(unknown))
check(tasks().length === 3 && Boolean(task('From elsewhere')), "a task that isn't here becomes a new one", tasks().map(t => t.title))

// 9. Nesting and mixed lines (B22-4): a parent and child each stay their own task, under each other; a text line stays text.
await setup()
const mixed = JSON.parse(one)
const child = taskBlocks.find(b => wordsOf(b) === 'Book the train')
mixed.blocks = [{ ...mixed.blocks[0], children: [child] }, { id: 'plain', type: 'paragraph', props: {}, content: [{ type: 'text', text: 'A plain line', styles: {} }], children: [] }]
await pasteOn('/pages?page=trips', null, JSON.stringify(mixed))
const pastedDoc = JSON.parse(pageOf('trips').document), parent = pastedDoc.find(n => n.props?.taskId === trv)
check(tasks().length === 2 && parent?.children?.[0]?.props?.taskId === child.props.taskId && parent?.children?.[0]?.props?.role === 'reference', 'a parent and child stay linked to their own tasks, nested', parent?.children)
check(pastedDoc.some(n => n.type === 'paragraph' && JSON.stringify(n.content).includes('A plain line')), 'a text line pastes as text')

// 10. Into a task row with words (B22-9): nothing new is made as a reference there.
await setup()
const beforeRows = rowsOf(`day:${today}`).length
await pasteOn(null, 'Book the train', one)
check(tasks().length === 2 && rowsOf(`day:${today}`).length === beforeRows && Boolean(tasks().find(t => t.title.includes('Book the train') && t.title.includes('TRV'))), "into a to-do with words: its words only", tasks().map(t => t.title))
// A template stays a template row with no task (B22-9), and a parent's own page is covered by step 5.

// 11. If the phone drops our type: the same words alone are still this copy (B22-10).
await fresh()
await copyRow('TRV')
const trvNow = task('TRV').id
await page.goto(`${base}/pages?page=trips`); await wait(2500)
{ const l = page.locator('.bn-inline-content').last(); await (wide ? l.click() : l.tap()) } await wait(200)
await page.evaluate(() => { const data = new DataTransfer(); data.setData('text/plain', 'TRV'); document.activeElement.dispatchEvent(new ClipboardEvent('paste', { clipboardData: data, bubbles: true, cancelable: true })) }); await wait(1500)
check(rowsOf('trips').some(n => n.props.taskId === trvNow) && tasks().length === 2, 'plain words from a row\'s Copy still paste as the same task', rowsOf('trips').map(n => n.props))
check(errors.length === 0, 'no page errors', errors)
console.log(fails ? `${fails} FAILED` : 'ALL PASS')
await browser.close()
process.exit(fails ? 1 : 0)
