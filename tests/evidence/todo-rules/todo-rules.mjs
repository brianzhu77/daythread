// To-dos' rules in the built app (automations.md §7, G3-20): made from To-dos' menu, set off by a tick on the day page or a to-do's first words, with one Undo.
// Usage: node tests/evidence/todo-rules/todo-rules.mjs <base-url> <store-path> [chromium|webkit] [shots-dir]  (a throwaway store the server at <base-url> uses)
import * as pw from '@playwright/test'
import { execSync } from 'node:child_process'
const [base, S, engine = 'chromium', shots] = process.argv.slice(2)
if (!base || !S) { console.error('Usage: node tests/evidence/todo-rules/todo-rules.mjs <base-url> <store-path> [chromium|webkit] [shots-dir]'); process.exit(2) }
const today = new Date().toLocaleDateString('en-CA')
const store = () => JSON.parse(execSync(`sqlite3 ${S} "select data from workspace"`, { maxBuffer: 1 << 26 }).toString())
const logged = () => store().pages.filter(p => p.parentId === 'log' && !p.trashedAt).map(p => p.title)
const wait = ms => new Promise(r => setTimeout(r, ms))
const browser = await pw[engine].launch({ headless: true })
const wide = { viewport: { width: 1280, height: 900 } }, phone = { viewport: { width: 390, height: 780 }, hasTouch: true }
let failed = 0
const scenario = async (name, act, options = wide, path = '/pages?page=lists') => {
  if (process.env.ONLY && !name.includes(process.env.ONLY)) return
  execSync(`rm -f ${S} ${S}-wal ${S}-shm && node --no-warnings tests/evidence/todo-rules/seed.ts ${S} ${today}`, { stdio: 'ignore' })
  const context = await browser.newContext({ ...options, serviceWorkers: 'block' }), page = await context.newPage(), errors = []
  page.on('pageerror', e => { if (!/ResizeObserver loop/.test(e.message)) errors.push(e.message) })
  let r
  try { await page.goto(`${base}${path}`); await wait(2200); r = await act(page) } catch (e) { r = { ok: false, threw: e.message.split('\n').slice(0, 4).join(' ') } }
  const ok = r.ok && !errors.length
  if (!ok) failed++
  console.log(ok ? 'PASS' : 'FAIL', name, JSON.stringify({ ...r, errors }).slice(0, 700))
  if (shots) await page.screenshot({ path: `${shots}/rules-${name.replace(/\W+/g, '-').slice(0, 26)}-${engine}-${options.viewport.width}.png` }).catch(() => {})
  await context.close()
}
const sheet = page => page.locator('.automation-sheet')
const tap = async (l, options) => (options === phone ? l.tap() : l.click())
const openSheet = async (page, options = wide) => { await tap(page.locator('.database-more-button').first(), options); await wait(300); await tap(page.locator('.database-menu').getByRole('menuitem', { name: /^Automations/ }), options); await wait(400) }
const notices = page => page.locator('[role=alert], [role=status]').allTextContents().then(t => t.join(' | ').replace(/\s+/g, ' '))
// When Status changes: add a row to Log named after the to-do.
const makeRule = async (page, when, options = wide) => {  // `when`: the trigger's value: '' for a to-do added, or a property's id
  await openSheet(page, options)
  await tap(sheet(page).getByRole('menuitem', { name: '+ New automation' }), options); await wait(200)
  const offered = await sheet(page).getByLabel('When').first().evaluate(n => [...n.options].map(o => o.textContent))
  await sheet(page).getByLabel('When').first().selectOption(when); await wait(150)
  await tap(sheet(page).getByRole('menuitem', { name: '+ Add step' }), options); await wait(150)
  const kinds = await sheet(page).getByRole('menuitem').allTextContents()
  await tap(sheet(page).getByRole('menuitem', { name: 'Add row to' }), options); await wait(200)
  await sheet(page).getByLabel('Database').selectOption('log')
  await sheet(page).getByLabel("How it's named").selectOption('formula'); await wait(100)
  await sheet(page).getByLabel('Row name formula').fill('"Log: " + Name'); await wait(150)
  await tap(sheet(page).getByRole('button', { name: 'Back' }), options); await wait(150)
  await tap(sheet(page).getByRole('button', { name: 'Done' }), options); await wait(900)
  const rules = store().todoAutomations ?? []
  await page.keyboard.press('Escape'); await wait(200)
  return { offered, kinds, rules }
}

await scenario('Made from To-dos\' menu, kept on the workspace; a tick on the day page runs it, and one Undo takes back both', async page => {
  const { offered, kinds, rules } = await makeRule(page, 'status')
  await page.goto(`${base}/`); await wait(2200)
  await page.locator('.editor-task', { hasText: 'Alpha' }).locator('input[type=checkbox]').click(); await wait(1500)
  const after = logged(), said = await notices(page)
  await page.getByRole('button', { name: 'Undo' }).first().click(); await wait(1500)
  const undone = logged(), alpha = store().tasks.find(t => t.title === 'Alpha').status
  return { ok: offered.join() === 'A to-do is added,Every…,Name is edited,Status is edited,Planned is edited,Start is edited,Deadline is edited' && kinds.join().includes('Edit property') && !kinds.join().includes('Insert') && rules.length === 1 && after.join() === 'Log: Alpha' && /Log/.test(said) && undone.length === 0 && alpha === 'open', offered, kinds, rules: rules.length, after, said, undone, alpha }
})

await scenario('When a to-do is added: once, on its first words, typed on the day page', async page => {
  await makeRule(page, '')
  await page.goto(`${base}/`); await wait(2200)
  const last = page.locator('.editor-task', { hasText: 'Charlie' }).locator('.bn-inline-content')
  await last.click(); await page.keyboard.press(engine === 'webkit' ? 'Meta+ArrowRight' : 'End'); await page.keyboard.press('Enter'); await wait(1500)
  const blank = logged().length
  await page.keyboard.type('Delta'); await wait(1800)
  const first = logged()
  await page.keyboard.type(' and more'); await wait(1800)
  return { ok: blank === 0 && first.join() === 'Log: Delta' && logged().join() === 'Log: Delta', blank, first, now: logged() }
})

await scenario('390: To-dos\' Automations opens as a sheet that fits', async page => {
  await openSheet(page, phone)
  const box = await sheet(page).boundingBox(), over = await page.evaluate(() => document.documentElement.scrollWidth > innerWidth)
  return { ok: box.width === 390 && !over, box, over }
}, phone)
await browser.close()
console.log(failed ? `${failed} failed` : 'all passed')
process.exit(failed ? 1 : 0)
