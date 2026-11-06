// Variables and formula values in the built app (buttons.md §2, G3-10): the editor's fields, what stops Done, a tap's result with one Undo, and a rule.
// Usage: node tests/evidence/buttons/variables.mjs <base-url> <store-path> [chromium|webkit] [shots-dir]  (a throwaway store the server at <base-url> uses)
import * as pw from '@playwright/test'
import { execSync } from 'node:child_process'
const [base, S, engine = 'chromium', shots] = process.argv.slice(2)
if (!base || !S) { console.error('Usage: node tests/evidence/buttons/variables.mjs <base-url> <store-path> [chromium|webkit] [shots-dir]'); process.exit(2) }
const store = () => JSON.parse(execSync(`sqlite3 ${S} "select data from workspace"`, { maxBuffer: 1 << 26 }).toString())
const rows = () => store().pages.filter(p => p.parentId === 'runs' && !p.trashedAt)
const doc = id => JSON.parse(store().pages.find(p => p.id === id).document)
const wait = ms => new Promise(r => setTimeout(r, ms))
const browser = await pw[engine].launch({ headless: true })
const wide = { viewport: { width: 1280, height: 900 } }, phone = { viewport: { width: 390, height: 780 }, hasTouch: true }
let failed = 0
const scenario = async (name, act, options = wide, path = '/pages?page=notes', seed = '') => {
  if (process.env.ONLY && !name.includes(process.env.ONLY)) return
  execSync(`rm -f ${S} ${S}-wal ${S}-shm && node --no-warnings tests/evidence/buttons/seed.ts ${S} ${seed}`, { stdio: 'ignore' })
  const context = await browser.newContext({ ...options, serviceWorkers: 'block' }), page = await context.newPage(), errors = []
  page.on('pageerror', e => { if (!/ResizeObserver loop/.test(e.message)) errors.push(e.message) })
  let r
  try { await page.goto(`${base}${path}`); await wait(2000); r = await act(page) } catch (e) { r = { ok: false, threw: e.message.split('\n').slice(0, 5).join(' ') } }
  const ok = r.ok && !errors.length
  if (!ok) failed++
  console.log(ok ? 'PASS' : 'FAIL', name, JSON.stringify({ ...r, errors }).slice(0, 700))
  if (shots) await page.screenshot({ path: `${shots}/vars-${name.replace(/\W+/g, '-').slice(0, 26)}-${engine}.png` }).catch(() => {})
  await context.close()
}
const editor = page => page.locator('.button-editor')
const notices = page => page.locator('[role=alert], [role=status]').allTextContents().then(t => t.join(' | ').replace(/\s+/g, ' '))
const pill = (page, name) => page.locator('.editor-button-pill', { hasText: name }).first()
const slash = async page => { const last = page.locator('.bn-inline-content', { hasText: 'Last line' }), box = await last.boundingBox(); await page.mouse.click(box.x + box.width - 2, box.y + box.height / 2); await page.keyboard.press('Enter'); await page.keyboard.type('/button', { delay: 20 }); await wait(400); await page.getByRole('option', { name: /Button/ }).first().click(); await wait(400) }
const addStep = async (page, name) => { await editor(page).getByRole('menuitem', { name: '+ Add step' }).click(); await wait(120); await editor(page).getByRole('menuitem', { name }).click(); await wait(150) }
const back = async page => { await editor(page).getByRole('button', { name: 'Back' }).click(); await wait(120) }
const statusOf = page => editor(page).locator('.step-formula .formula-status').first().textContent()

await scenario('Define a variable, use it in a later step and a row\'s name, and a tap makes the row with one Undo', async page => {
  await slash(page)
  await addStep(page, 'Define variables')
  await back(page)
  const blank = await editor(page).locator('.button-step-row.is-incomplete small').textContent()
  await editor(page).locator('.button-step-open').first().click(); await wait(150)
  await editor(page).getByLabel('Variable name').fill('bump')
  await editor(page).getByLabel('bump is').fill('1 + 1'); await wait(100)
  const gives = await statusOf(page)
  await back(page)
  const title = await editor(page).locator('.button-step-open span').first().textContent()
  await addStep(page, 'Add row to')
  await editor(page).getByLabel('Database').selectOption('runs')
  await editor(page).getByLabel("How it's named").selectOption('formula'); await wait(100)
  await editor(page).getByLabel('Row name formula').fill('"Run " + bump'); await wait(80)
  await editor(page).getByLabel('Set a property').selectOption('n'); await wait(100)
  await editor(page).getByLabel('N from').selectOption('formula'); await wait(100)
  await editor(page).getByLabel('N formula').fill('bump * 3'); await wait(100)
  const fine = await editor(page).locator('.step-formula .formula-status.is-error').count()
  await back(page)
  await editor(page).getByLabel('Name', { exact: true }).fill('With a variable')
  await editor(page).getByRole('button', { name: 'Done' }).click(); await wait(1600)
  const kept = doc('notes').find(n => n.type === 'button' && n.props.label === 'With a variable'), version = JSON.parse(kept.props.steps).v
  const before = rows().length
  await pill(page, 'With a variable').click(); await wait(900)
  const made = rows().find(r => r.title === 'Run 2'), after = rows().length
  await page.getByRole('button', { name: 'Undo' }).click(); await wait(900)
  const undone = rows().length
  return { ok: blank === 'Needs a name' && gives === 'Gives a number' && title === 'Define bump' && fine === 0 && version === 2 && after === before + 1 && made?.values?.n === 6 && undone === before, blank, gives, title, fine, version, before, after, n: made?.values?.n, undone }
})

await scenario('What stops Done: an error says why, a type that doesn\'t fit says so, a step above its variable breaks when moved, and each goes back to the step', async page => {
  await slash(page)
  await addStep(page, 'Define variables')
  await editor(page).getByLabel('Variable name').fill('two words')
  await editor(page).getByLabel('two words is').fill('1'); await wait(80)
  await back(page)
  const badName = await editor(page).locator('.button-step-row.is-incomplete small').textContent()
  await editor(page).locator('.button-step-open').first().click(); await wait(120)
  await editor(page).getByLabel('Variable name').fill('x'); await wait(80)
  await back(page)
  await addStep(page, 'Edit rows in')
  await editor(page).getByLabel('Database').selectOption('runs')
  await editor(page).getByLabel('Set a property').selectOption('n'); await wait(100)
  await editor(page).getByLabel('N from').selectOption('formula'); await wait(100)
  await editor(page).getByLabel('N formula').fill('"words"'); await wait(100)
  const wrong = await statusOf(page)
  await editor(page).getByLabel('N formula').fill('N +'); await wait(100)
  const syntax = await statusOf(page)
  await editor(page).getByLabel('N formula').fill('N + x'); await wait(100)
  const right = await statusOf(page), stored = await editor(page).getByLabel('N formula').inputValue()
  await back(page)
  const clean = await editor(page).locator('.button-step-row.is-incomplete').count()
  await editor(page).getByRole('button', { name: 'Move down' }).first().click(); await wait(120)
  const moved = await editor(page).locator('.button-step-row.is-incomplete small').textContent()
  const off = await editor(page).locator('.button-editor-done.is-off').count()
  await editor(page).getByRole('button', { name: 'Done' }).click(); await wait(200)
  const went = await editor(page).getByLabel('N formula').count(), reads = await editor(page).getByLabel('N formula').inputValue()
  return { ok: /can't be a name/.test(badName) && /needs a number, and this gives text/.test(wrong) && /stops before it finishes/.test(syntax) && right === 'Gives a number' && stored === 'N + x' && clean === 0 && /no property or function called "x"/.test(moved) && off === 1 && went === 1 && reads === 'N + x', badName, wrong, syntax, right, stored, clean, moved, off, went, reads }
})

await scenario('On a property: a formula reads its row, each picked row its own, and the words come back as typed', async page => {
  await page.locator('th', { hasText: 'Go' }).first().click().catch(() => {}); await wait(250)
  const menu = page.locator('.database-menu')
  await menu.getByRole('menuitem', { name: 'Edit button' }).click(); await wait(400)
  await editor(page).locator('.button-step-open').first().click(); await wait(150)
  await editor(page).getByLabel('N from').selectOption('formula'); await wait(100)
  await editor(page).getByLabel('N formula').fill('N * 10'); await wait(100)
  await back(page)
  await editor(page).getByRole('button', { name: 'Done' }).click(); await wait(1200)
  await page.locator('.editor-button-pill.is-cell').nth(1).click(); await wait(900)
  const values = rows().map(r => [r.id, r.values?.n])
  await page.locator('.editor-button-pill.is-cell').first().click(); await wait(900)
  const both = Object.fromEntries(rows().map(r => [r.id, r.values?.n]))
  await page.locator('th', { hasText: 'Go' }).first().click().catch(() => {}); await wait(250)
  await menu.getByRole('menuitem', { name: 'Edit button' }).click(); await wait(400)
  await editor(page).locator('.button-step-open').first().click(); await wait(150)
  const shown = await editor(page).getByLabel('N formula').inputValue()
  return { ok: both.r1 === 10 && both.r2 === 20 && shown === 'N * 10', values, both, shown }
}, wide, '/pages?page=runs', 'property')

await scenario('On a rule: a variable and a formula set a new row\'s date from the time it ran', async page => {
  await page.locator('.database-more-button').first().click(); await wait(250); await page.locator('.database-menu').getByRole('menuitem', { name: /^Automations/ }).click(); await wait(400)
  const sheet = page.locator('.automation-sheet')
  await sheet.getByRole('menuitem', { name: '+ New automation' }).click(); await wait(200)
  await sheet.getByRole('menuitem', { name: '+ Add step' }).click(); await wait(150)
  const offered = await sheet.getByRole('menuitem').allTextContents()
  await sheet.getByRole('menuitem', { name: 'Define variables' }).click(); await wait(150)
  await sheet.getByLabel('Variable name').fill('next')
  await sheet.getByLabel('next is').fill('dateAdd(now(), 1, "days")'); await wait(100)
  await sheet.getByRole('button', { name: 'Back' }).click(); await wait(120)
  await sheet.getByRole('menuitem', { name: '+ Add step' }).click(); await wait(150)
  await sheet.getByRole('menuitem', { name: 'Edit property' }).click(); await wait(150)
  await sheet.getByLabel('Set a property').selectOption('when'); await wait(100)
  await sheet.getByLabel('When from').selectOption('formula'); await wait(100)
  await sheet.getByLabel('When formula').fill('next'); await wait(100)
  const gives = await sheet.locator('.step-formula .formula-status').first().textContent()
  await sheet.getByRole('button', { name: 'Back' }).click(); await wait(120)
  await sheet.getByLabel('Name').fill('Tomorrow')
  await sheet.getByRole('button', { name: 'Done' }).click(); await wait(800)
  await page.keyboard.press('Escape'); await wait(150); await page.keyboard.press('Escape'); await wait(150)
  await page.locator('.database-table-wrap').getByText('+ New').first().click(); await wait(1000)
  const row = rows().at(-1), when = row.values?.when?.start ?? ''
  const tomorrow = new Date(Date.now() + 86_400_000).toLocaleDateString('en-CA')
  return { ok: offered.join().includes('Define variables') && gives === 'Gives a date' && when.slice(0, 10) === tomorrow, gives, when, tomorrow }
}, wide, '/pages?page=runs')

await scenario('390: the field is 16 px and fits, and the list offers the variable and inserts it', async page => {
  await page.locator('.database-more-button').first().tap(); await wait(300); await page.locator('.database-menu').getByRole('menuitem', { name: /^Automations/ }).tap(); await wait(400)
  const sheet = page.locator('.automation-sheet')
  await sheet.getByRole('menuitem', { name: '+ New automation' }).tap(); await wait(200)
  await sheet.getByRole('menuitem', { name: '+ Add step' }).tap(); await wait(150)
  await sheet.getByRole('menuitem', { name: 'Define variables' }).tap(); await wait(150)
  await sheet.getByLabel('Variable name').fill('bump')
  await sheet.getByLabel('bump is').fill('1'); await wait(80)
  await sheet.getByRole('button', { name: 'Back' }).tap(); await wait(120)
  await sheet.getByRole('menuitem', { name: '+ Add step' }).tap(); await wait(150)
  await sheet.getByRole('menuitem', { name: 'Edit property' }).tap(); await wait(150)
  await sheet.getByLabel('Set a property').selectOption('n'); await wait(100)
  await sheet.getByLabel('N from').selectOption('formula'); await wait(100)
  const field = sheet.getByLabel('N formula')
  const size = await field.evaluate(n => getComputedStyle(n).fontSize), box = await field.boundingBox()
  await sheet.getByRole('button', { name: 'Properties and functions' }).tap(); await wait(150)
  const offers = await sheet.locator('.formula-group').first().textContent()
  await sheet.locator('.formula-item', { hasText: /^bump$/ }).tap(); await wait(150)
  const typed = await field.inputValue(), over = await page.evaluate(() => document.documentElement.scrollWidth > innerWidth)
  return { ok: size === '16px' && box.x >= 0 && box.x + box.width <= 390 && offers === 'Variables' && typed === 'bump' && !over, size, box, offers, typed, over }
}, phone, '/pages?page=runs')
await browser.close()
console.log(failed ? `${failed} failed` : 'all passed')
process.exit(failed ? 1 : 0)
