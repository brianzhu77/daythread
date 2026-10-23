// B33 browser check: a to-do born on today's page goes with its line (block selection delete, Backspace on an empty
// row), ⌘Z brings back the same task, and a cut-and-paste to a document page keeps the same task. Built server,
// sign-in off, fresh SQLite:   DB=<sqlite> node tests/evidence/b33/ui-check.mjs <base> [width]
import { chromium } from '@playwright/test'
import { DatabaseSync } from 'node:sqlite'
const [BASE, W] = process.argv.slice(2), width = Number(W ?? 1280), DB = process.env.DB
const mod = process.platform === 'darwin' ? 'Meta' : 'Control'
const b = await chromium.launch(), ctx = await b.newContext({ viewport: { width, height: 900 } })
await ctx.grantPermissions(['clipboard-read', 'clipboard-write'], { origin: BASE })
const p = await ctx.newPage(), errors = []; p.on('pageerror', e => errors.push(e.message))
let failed = 0
const log = (ok, what, d = '') => { if (!ok) failed++; console.log(`${ok ? 'ok  ' : 'FAIL'} ${width}: ${what}${d ? ` (${d})` : ''}`) }
const tasks = () => { const db = new DatabaseSync(DB, { readOnly: true }); try { return db.prepare("SELECT id, title, status FROM tasks WHERE snapshot='current'").all() } finally { db.close() } }
const task = title => tasks().find(t => t.title === title)
const wait = ms => p.waitForTimeout(ms)
const typeTask = async title => {
  const h = await p.locator('h2', { hasText: 'TODO - Other' }).first().boundingBox()
  await p.mouse.click(h.x + 60, h.y + h.height + 18); await wait(200); await p.keyboard.press(`${mod}+ArrowRight`); await wait(100)
  // A row that already has words: start a new to-do under it.
  if (await p.evaluate(() => (window.getSelection()?.anchorNode?.parentElement?.closest('.editor-task-title')?.textContent ?? '').trim().length > 0)) { await p.keyboard.press('Enter'); await wait(200) }
  await p.keyboard.type(title); await wait(1500)
}
const rowOf = title => p.locator('[data-node-type="blockContainer"]', { has: p.locator('.editor-task-title', { hasText: title }) }).first()
const selectRow = async title => { await p.mouse.move(1, 1); await rowOf(title).locator('.editor-task-title').hover(); await wait(300); await p.locator('.bn-side-menu [aria-label^="Select or drag"]').first().click(); await wait(300) }

await p.goto(BASE + '/', { waitUntil: 'networkidle' }); await wait(700)
await typeTask('Born here one')
const one = task('Born here one')
log(Boolean(one), 'a typed to-do is a task')
await selectRow('Born here one'); await p.keyboard.press('Delete'); await wait(1800)
log(!task('Born here one'), 'deleted with its line (block selection)')
log(await p.locator('text="To-do deleted"').count() > 0 && await p.locator('text=/Content removed · tasks unchanged/').count() === 0, 'the notice says "To-do deleted" (Jazz 416bbf34)')
log(!(await p.locator('text=/Not today/').count()), 'no "Not today" left behind')
await p.locator('.bn-editor').first().click({ position: { x: 5, y: 5 } }).catch(() => {}); await p.keyboard.press(`${mod}+z`); await wait(2200)
log(task('Born here one')?.id === one?.id, '⌘Z brings back the same task', task('Born here one')?.id)

await typeTask('zz'); await wait(300)
const zz = task('zz')
for (let i = 0; i < 3; i++) await p.keyboard.press('Backspace'); await wait(1800)
log(Boolean(zz) && !tasks().some(t => t.id === zz.id), 'Backspace through an empty to-do deletes its task', JSON.stringify(zz))
log(await p.locator('text="To-do deleted"').count() > 0, 'and says "To-do deleted" with its Undo (Bumblebee e7026847)')
await p.getByRole('button', { name: 'Undo' }).first().click(); await wait(2200)
log(tasks().some(t => t.id === zz.id), 'the notice\'s Undo brings back the same task')

await typeTask('Cut and moved'); const moved = task('Cut and moved')
await selectRow('Cut and moved'); await p.keyboard.press(`${mod}+x`); await wait(1800)
log(tasks().some(t => t.id === moved.id), 'a cut keeps the task (the move is pending)')
await p.goto(BASE + '/pages', { waitUntil: 'networkidle' }); await wait(500)
await p.locator('[aria-label="New page"]').first().click(); await wait(400); await p.keyboard.type('Moved here'); await p.keyboard.press('Enter'); await wait(800)
await p.keyboard.press(`${mod}+v`); await wait(2000)
log(tasks().filter(t => t.title === 'Cut and moved').length === 1 && task('Cut and moved').id === moved.id, 'pasted on a page: the same task, once')
console.log(errors.length ? `page errors: ${errors.join(' | ')}` : 'no page errors'); console.log(failed ? `${failed} FAILED` : 'all passed')
await b.close(); process.exit(failed ? 1 : 0)
