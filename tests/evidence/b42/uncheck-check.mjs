// B42 (Lead, Brian): removing a to-do's checkbox counts as deleting the line. Backspace at the start of a to-do (how he
// did it: the line becomes text, its block stays), ⌘Z, a nested child, a task with history, and "[] " to make it a
// to-do again. Built server, sign-in off, a store from seed.ts:
//   DB=<store> node tests/evidence/b42/uncheck-check.mjs <base> [width]
import { chromium, webkit } from '@playwright/test'
import { DatabaseSync } from 'node:sqlite'
const [base, width = '1280'] = process.argv.slice(2), DB = process.env.DB
if (!base || !['127.0.0.1', 'localhost'].includes(new URL(base).hostname) || new URL(base).port === '3000' || !DB?.startsWith('/tmp/rb-b42-')) throw Error('Use a disposable loopback server and a seeded /tmp/rb-b42-* store')
const phone = Number(width) < 600, mod = process.platform === 'darwin' ? 'Meta' : 'Control'
const browser = await (phone ? webkit : chromium).launch()
const ctx = await browser.newContext({ viewport: { width: Number(width), height: 1000 }, ...(phone ? { hasTouch: true, isMobile: true } : {}) })
const p = await ctx.newPage(), errors = []
p.on('pageerror', e => errors.push(e.message))
let failed = 0
const log = (ok, what, detail = '') => { if (!ok) failed++; console.log(`${ok ? 'ok  ' : 'FAIL'} ${width}: ${what}${detail ? ` (${detail})` : ''}`) }
const task = title => { const d = new DatabaseSync(DB, { readOnly: true }); try { return d.prepare("SELECT id, title, status, paused, plannedOn FROM tasks WHERE snapshot='current' AND title = ?").all(title) } finally { d.close() } }
const kind = text => p.locator('.continuous-editor .bn-block-content', { hasText: text }).first().getAttribute('data-content-type')
const saveLine = () => p.locator('.editor-save-line').innerText().catch(() => '')
const noticeText = () => p.locator('[role="status"], .app-toasts, .editor-notice').allInnerTexts().then(t => t.join(' | '))
// Backspace with the caret at the very start of that line's words. The caret is placed directly: Home or ⌘← go to the
// start of the visual row, which on a wrapped line (390) is mid-line.
const caretAtStart = async text => {
  const line = p.locator('.continuous-editor .bn-inline-content', { hasText: text }).first()
  const box = await line.boundingBox(); await p.mouse.click(box.x + 2, box.y + 6)
  await line.evaluate(el => { const w = document.createTreeWalker(el, NodeFilter.SHOW_TEXT); const t = w.nextNode(); if (t) getSelection().collapse(t, 0) })
}
const backspaceAtStart = async text => { await caretAtStart(text); await p.keyboard.press('Backspace'); await p.waitForTimeout(1800) }
await p.goto(base + '/', { waitUntil: 'networkidle' }); await p.waitForTimeout(1200)

// 1. A to-do born here: Backspace at its start turns it into text and deletes its task, with the B33 notice.
await backspaceAtStart('Delete task when')
const notice1 = await noticeText()
log(await kind('Delete task when') !== 'task' && task('Delete task when I delete the checkbox').length === 0, 'born here: the checkbox goes, the line stays as text, the task is deleted', JSON.stringify({ kind: await kind('Delete task when'), tasks: task('Delete task when I delete the checkbox') }))
log(/To-do deleted/.test(notice1), 'it says "To-do deleted"', notice1.slice(0, 120))

// 2. ⌘Z: the same task comes back, as a to-do again.
await p.keyboard.press(`${mod}+z`); await p.waitForTimeout(2200)
const back = task('Delete task when I delete the checkbox')
log(await kind('Delete task when') === 'task' && back.length === 1, '⌘Z: the to-do and its task come back', JSON.stringify({ kind: await kind('Delete task when'), back }))

// 3. A nested to-do (under "#daythread bug"): its task goes, the parent's stays.
await backspaceAtStart('read SEO information')
log(task('read SEO information').length === 0 && task('#daythread bug').length === 1, 'nested: the child\'s task goes, the parent\'s stays', JSON.stringify({ child: task('read SEO information').length, parent: task('#daythread bug').length }))

// 4. A to-do with history (carried from yesterday): it goes to Not today, its task stays.
await backspaceAtStart('Carried from yesterday')
const carried = task('Carried from yesterday')[0]
log(carried && carried.paused === 1 && carried.plannedOn === null, 'with history: Not today, the task kept', JSON.stringify(carried))

// 5. "[] " at the start of a text line makes it a to-do, and a new task (it used to fail to save).
await caretAtStart('read SEO information'); await p.keyboard.type('[] '); await p.waitForTimeout(2200)
const fresh = task('read SEO information')
log(await kind('read SEO information') === 'task' && fresh.length === 1 && fresh[0].id.startsWith('editor-task:') && !/Couldn|Unknown/.test(await saveLine()), 'a text line made a to-do again: a new task, saved', JSON.stringify({ fresh, line: await saveLine() }))
log(errors.length === 0, 'no page errors', errors.slice(0, 2).join(' / '))
await p.screenshot({ path: `/tmp/rb-b42-${width}.png` })
await browser.close()
console.log(failed ? `${failed} FAILED` : 'all passed')
process.exitCode = failed ? 1 : 0
