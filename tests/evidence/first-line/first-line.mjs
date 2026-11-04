// Brian, Nov 3: "the first line's bullet or checkbox in a Page can't be deleted". Backspace at the start of the first line, read back from the store.
// Usage: node tests/evidence/first-line/first-line.mjs <base-url> <store-path> [chromium|webkit] [1280|390]  (a throwaway store the server at <base-url> uses)
import * as pw from '@playwright/test'
import { execSync } from 'node:child_process'
const [base, S, engine = 'chromium', width = '1280'] = process.argv.slice(2)
if (!base || !S) { console.error('Usage: node tests/evidence/first-line/first-line.mjs <base-url> <store-path> [chromium|webkit] [1280|390]'); process.exit(2) }
const store = () => JSON.parse(execSync(`sqlite3 ${S} "select data from workspace"`, { maxBuffer: 1 << 26 }).toString())
const wait = ms => new Promise(r => setTimeout(r, ms))
const browser = await pw[engine].launch({ headless: true })
const options = width === '390' ? { viewport: { width: 390, height: 780 }, hasTouch: true } : { viewport: { width: 1280, height: 900 } }
let failed = 0
const firstOf = id => JSON.parse(store().pages.find(p => p.id === id).document).slice(0, 2).map(n => `${n.type}:${n.content?.[0]?.text ?? ''}`)
const focusIsTitle = page => page.evaluate(() => document.activeElement?.classList.contains('page-title-field') ?? false)
const atStart = async page => { await page.locator('.ProseMirror .bn-inline-content').first().click(); await page.keyboard.press('Meta+ArrowLeft'); await page.keyboard.press('Home'); await wait(150) }
const scenario = async (name, act) => {
  execSync(`rm -f ${S} ${S}-wal ${S}-shm && node --no-warnings tests/evidence/first-line/seed.ts ${S}`, { stdio: 'ignore' })
  const context = await browser.newContext(options), page = await context.newPage(), errors = []
  page.on('pageerror', e => { if (!/ResizeObserver loop/.test(e.message)) errors.push(e.message) })
  let r
  try { r = await act(page) } catch (e) { r = { ok: false, threw: e.message.split('\n').slice(0, 3).join(' ') } }
  const ok = r.ok && !errors.length
  if (!ok) failed++
  console.log(ok ? 'PASS' : 'FAIL', `${engine} ${width}`, name, JSON.stringify({ ...r, errors }))
  await context.close()
}
for (const [id, type, words] of [['bw', 'bullet', 'Bullet words'], ['be', 'empty bullet', ''], ['nw', 'number', 'Numbered words'], ['cw', 'checklist', 'Check words'], ['hw', 'heading', 'Heading words']]) await scenario(`A ${type} first on a Page: the first Backspace makes it plain, the next goes to the title`, async page => {
  await page.goto(`${base}/pages?page=${id}`); await wait(1800)
  await atStart(page)
  await page.keyboard.press('Backspace'); await wait(1600)
  const r = { after: firstOf(id), inTitle: await focusIsTitle(page) }
  await page.keyboard.press('Backspace'); await wait(1600)
  r.then = firstOf(id); r.titleNow = await focusIsTitle(page)
  r.ok = r.after[0] === `paragraph:${words}` && r.after[1] === 'paragraph:Second line' && !r.inTitle && r.titleNow && r.then[0] === `paragraph:${words}`
  return r
})
await scenario('A to-do with words first on a Page: a plain line with its words, the task gone with a notice, and Undo brings it back', async page => {
  await page.goto(`${base}/pages?page=tw`); await wait(1800)
  const before = store().tasks.filter(t => t.title === 'Task words').length
  await atStart(page)
  await page.keyboard.press('Backspace'); await wait(1800)
  const r = { before, after: firstOf('tw'), tasks: store().tasks.filter(t => t.title === 'Task words').length, notice: (await page.locator('[role=alert], [role=status]').allInnerTexts()).join(' | ').replace(/\s+/g, ' ').slice(0, 120) }
  const undo = page.getByRole('button', { name: 'Undo' }).first()
  if (await undo.count()) { await undo.click(); await wait(1800); r.undone = firstOf('tw'); r.tasksBack = store().tasks.filter(t => t.title === 'Task words').length }
  r.ok = before === 1 && r.after[0] === 'paragraph:Task words' && r.tasks === 0 && /To-do deleted/.test(r.notice) && r.undone?.[0]?.startsWith('task:') && r.tasksBack === 1
  return r
})
await scenario('A to-do with no words first on a Page: a plain empty line', async page => {
  await page.goto(`${base}/pages?page=te`); await wait(1800)
  await page.locator('.ProseMirror .bn-inline-content').first().click(); await page.keyboard.type('/'); await wait(500); await page.locator('.bn-suggestion-menu-item, [role=option]').filter({ hasText: 'Task' }).first().click(); await wait(1600)
  const made = firstOf('te')
  await page.keyboard.press('Backspace'); await wait(1600)
  const r = { made, after: firstOf('te'), inTitle: await focusIsTitle(page) }
  r.ok = made[0].startsWith('task:') && r.after[0] === 'paragraph:' && !r.inTitle
  return r
})
await scenario('A bullet first on today\'s page: plain, as it was', async page => {
  await page.goto(`${base}/`); await wait(2200)
  const day = store().pages.find(p => p.date && JSON.stringify(p.document).includes('Day bullet')).id
  await atStart(page)
  await page.keyboard.press('Backspace'); await wait(1600)
  const r = { after: firstOf(day) }
  r.ok = r.after[0] === 'paragraph:Day bullet' && r.after[1] === 'paragraph:Day second'
  return r
})
await scenario('Words not at the start of a first line: Backspace only deletes a letter; a plain first line goes to the title', async page => {
  await page.goto(`${base}/pages?page=bw`); await wait(1800)
  await page.locator('.ProseMirror .bn-inline-content').first().click(); await page.keyboard.press('Meta+ArrowRight'); await wait(100)
  await page.keyboard.press('Backspace'); await wait(1600)
  const r = { after: firstOf('bw') }
  r.ok = r.after[0] === 'bulletListItem:Bullet word'
  return r
})
await browser.close()
console.log(failed ? `${failed} FAILED` : 'ALL PASS')
process.exit(failed ? 1 : 0)
