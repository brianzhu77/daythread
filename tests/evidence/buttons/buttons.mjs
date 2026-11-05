// A page's button in the built app (buttons.md, G3-2 to G3-8): making one, the pill, one tap with one Undo, retries, words kept, and broken targets.
// Usage: node tests/evidence/buttons/buttons.mjs <base-url> <store-path> [chromium|webkit] [shots-dir]  (a throwaway store the server at <base-url> uses)
import * as pw from '@playwright/test'
import { execSync } from 'node:child_process'
const [base, S, engine = 'chromium', shots] = process.argv.slice(2)
if (!base || !S) { console.error('Usage: node tests/evidence/buttons/buttons.mjs <base-url> <store-path> [chromium|webkit] [shots-dir]'); process.exit(2) }
const store = () => JSON.parse(execSync(`sqlite3 ${S} "select data from workspace"`, { maxBuffer: 1 << 26 }).toString())
const pageOf = id => store().pages.find(p => p.id === id)
const rows = () => store().pages.filter(p => p.parentId === 'runs' && !p.trashedAt)
const doc = id => JSON.parse(pageOf(id).document)
const wait = ms => new Promise(r => setTimeout(r, ms))
const browser = await pw[engine].launch({ headless: true })
const wide = { viewport: { width: 1280, height: 900 } }, phone = { viewport: { width: 390, height: 780 }, hasTouch: true }
let failed = 0
const scenario = async (name, act, options = wide, path = '/pages?page=notes') => {
  if (process.env.ONLY && !name.includes(process.env.ONLY)) return
  execSync(`rm -f ${S} ${S}-wal ${S}-shm && node --no-warnings tests/evidence/buttons/seed.ts ${S}`, { stdio: 'ignore' })
  const context = await browser.newContext({ ...options, serviceWorkers: 'block' }), page = await context.newPage(), errors = []
  page.on('pageerror', e => { if (!/ResizeObserver loop/.test(e.message)) errors.push(e.message) })
  let r
  try { await page.goto(`${base}${path}`); await wait(2000); r = await act(page, context) } catch (e) { r = { ok: false, threw: e.message.split('\n').slice(0, 5).join(' ') } }
  const ok = r.ok && !errors.length
  if (!ok) failed++
  console.log(ok ? 'PASS' : 'FAIL', name, JSON.stringify({ ...r, errors }).slice(0, 640))
  if (shots) await page.screenshot({ path: `${shots}/${name.replace(/\W+/g, '-').slice(0, 30)}-${engine}.png` }).catch(() => {})
  await context.close()
}
const pill = (page, name) => page.locator('.editor-button-pill', { hasText: name }).first()
const isRun = q => q.method() === 'POST' && q.url().includes('_serverFn') && decodeURIComponent(q.postData() ?? '').includes('run-button')
const editor = page => page.locator('.button-editor')
const notices = page => page.locator('[role=alert], [role=status]').allTextContents().then(t => t.join(' | ').replace(/\s+/g, ' '))
const slash = async page => { const last = page.locator('.bn-inline-content', { hasText: 'Last line' }), box = await last.boundingBox(); await page.mouse.click(box.x + box.width - 2, box.y + box.height / 2); await page.keyboard.press('Enter'); await page.keyboard.type('/button', { delay: 20 }); await wait(400); await page.getByRole('option', { name: /Button/ }).first().click(); await wait(400) }

await scenario('/ Button: Done is off with nothing finished and goes to what\'s missing; then a pill that adds a row with one Undo', async page => {
  await slash(page)
  const opened = await editor(page).count(), blocksBefore = doc('notes').length
  await editor(page).getByRole('button', { name: 'Done' }).click(); await wait(150)
  const toKinds = await editor(page).getByRole('menuitem', { name: 'Add row to' }).count()
  await editor(page).getByRole('menuitem', { name: 'Add row to' }).click(); await wait(150)
  await editor(page).getByRole('button', { name: 'Back' }).click(); await wait(100)
  const incomplete = await editor(page).locator('.button-step-row.is-incomplete small').textContent()
  await editor(page).getByRole('button', { name: 'Done' }).click(); await wait(150)
  const wentToStep = await editor(page).getByLabel('Database').count()
  await editor(page).getByLabel('Database').selectOption('runs'); await editor(page).getByLabel('Row name').fill('Made here')
  await editor(page).getByLabel('Set a property').selectOption('when'); await wait(100)
  await editor(page).getByRole('button', { name: 'Back' }).click(); await wait(100)
  await editor(page).getByLabel('Name').fill('New one')
  await editor(page).getByRole('button', { name: 'Done' }).click(); await wait(1600)
  const kept = doc('notes').some(n => n.type === 'button' && n.props.label === 'New one')
  const before = rows().length
  await pill(page, 'New one').click(); await wait(800)
  const added = rows().length, words = await notices(page)
  await page.getByRole('button', { name: 'Undo' }).first().click(); await wait(800)
  return { ok: opened === 1 && toKinds === 1 && incomplete === 'Needs a database' && wentToStep === 1 && kept && added === before + 1 && /Added to Runs/.test(words) && /Open/.test(words) && rows().length === before, opened, blocksBefore, toKinds, incomplete, wentToStep, kept, added, before, words, after: rows().length }
})
await scenario('Leaving: a new button with nothing finished leaves no block; with changes a tap outside does nothing and Esc asks', async page => {
  const start = doc('notes').length
  await slash(page)
  await page.keyboard.press('Escape'); await wait(250)
  const closed = await editor(page).count()
  await wait(1500)
  const noBlock = !doc('notes').some(n => n.type === 'button' && !n.props.label)
  await slash(page)
  await editor(page).getByLabel('Name').fill('Half')
  await page.mouse.click(1200, 600); await wait(200)
  const stayed = await editor(page).count()
  await page.keyboard.press('Escape'); await wait(200)
  const asked = await page.getByText('Discard changes?').count()
  await page.getByRole('button', { name: 'Keep editing' }).click(); await wait(100)
  const still = await editor(page).getByLabel('Name').inputValue()
  await page.keyboard.press('Escape'); await wait(150); await page.getByRole('button', { name: 'Discard' }).click(); await wait(200)
  return { ok: closed === 0 && noBlock && stayed === 1 && asked === 1 && still === 'Half' && await editor(page).count() === 0, closed, noBlock, stayed, asked, still, start }
})
await scenario('A second tap while one runs does nothing; dimmed at once, a spinner after a moment, the width held', async page => {
  let sends = 0, release
  const held = new Promise(r => { release = r })
  await page.route('**/_serverFn/**', async route => { if (isRun(route.request())) { sends++; await held } await route.continue().catch(() => {}) })
  const before = rows().length, width = (await pill(page, 'Log a run').boundingBox()).width
  await pill(page, 'Log a run').click(); await wait(60)
  const dim = await pill(page, 'Log a run').evaluate(n => n.classList.contains('is-waiting'))
  await page.locator('.editor-button-pill.is-waiting').click({ force: true }); await wait(500)
  const spinner = await page.locator('.editor-button-pill .button-spinner').count(), during = (await page.locator('.editor-button-pill.is-waiting').boundingBox()).width
  release(); await wait(900)
  return { ok: dim && spinner === 1 && Math.abs(during - width) <= 1 && sends === 1 && rows().length === before + 1, dim, spinner, width, during, sends, rows: rows().length, before }
})
await scenario('Retry after a lost reply makes one row, past midnight with the tap\'s date; offline says so and sends nothing', async (page, context) => {
  const before = rows().length, sent = []
  await page.route('**/_serverFn/**', async route => { const q = route.request(); if (!isRun(q)) return route.continue(); sent.push(decodeURIComponent(q.postData() ?? '')); await route.fetch(); await route.abort() })
  await pill(page, 'Log a run').click(); await wait(1000)
  const landed = rows().length
  await page.unroute('**/_serverFn/**')
  await page.getByRole('button', { name: 'Retry' }).first().click(); await wait(1000)
  const once = rows().length
  await context.setOffline(true); await wait(150)
  await pill(page, 'Log a run').click(); await wait(400)
  const said = await notices(page)
  await context.setOffline(false)
  return { ok: landed === before + 1 && once === before + 1 && /Not run · offline/.test(said) && rows().length === before + 1, before, landed, once, said }
})
await scenario('Confirmation comes before any write: Cancel writes nothing, Continue does', async page => {
  const before = rows().length
  await pill(page, 'Sure?').click(); await wait(300)
  const asked = await page.getByRole('alertdialog').textContent(), during = rows().length
  await page.getByRole('button', { name: 'Cancel' }).click(); await wait(400)
  const cancelled = rows().length
  await pill(page, 'Sure?').click(); await wait(300); await page.getByRole('button', { name: 'Continue' }).click(); await wait(800)
  return { ok: /Add a run\?/.test(asked) && during === before && cancelled === before && rows().length === before + 1, asked, during, cancelled, after: rows().length }
})
await scenario('Insert: words typed before it are saved first, words typed during it survive, the caret stays, and each tap makes its own to-do', async page => {
  const holds = []
  await page.locator('.bn-inline-content', { hasText: 'First line' }).click(); await page.keyboard.press('Meta+ArrowRight')
  await page.keyboard.type(' typed before', { delay: 10 })
  await page.route('**/_serverFn/**', async route => { if (isRun(route.request())) await new Promise(r => holds.push(r)); await route.continue().catch(() => {}) })
  await pill(page, 'Add lines').click(); await wait(900)
  const savedFirst = JSON.stringify(doc('notes')[0].content).includes('typed before'), focused = await page.evaluate(() => document.activeElement?.closest?.('.ProseMirror') !== null)
  await page.keyboard.type(' during', { delay: 10 }); await wait(100)
  holds[0](); await wait(2800)
  const shown = await page.locator('.bn-inline-content', { hasText: 'First line' }).first().textContent()
  const nodes = doc('notes'), words = JSON.stringify(nodes[0].content), inserted = nodes.some(n => JSON.stringify(n.content ?? '').includes('Inserted line')), conflict = await page.getByText('Page changed elsewhere').count()
  const tasks = store().tasks.filter(t => t.title === 'Inserted to-do').length
  await page.unroute('**/_serverFn/**')
  await pill(page, 'Add lines').click(); await wait(1200)
  const two = store().tasks.filter(t => t.title === 'Inserted to-do').length
  return { ok: savedFirst && focused && /typed before during/.test(shown) && /during/.test(words) && inserted && conflict === 0 && tasks === 1 && two === 2, savedFirst, focused, shown, words, inserted, conflict, tasks, two }
})
await scenario('Notices: rows edited, nothing matched, Undo brings it back', async page => {
  await pill(page, 'None match').click(); await wait(700)
  const none = await notices(page)
  await pill(page, 'Set all').click(); await wait(800)
  const set = await notices(page), value = pageOf('r1').values.n
  await page.getByRole('button', { name: 'Undo' }).first().click(); await wait(800)
  return { ok: /No rows matched/.test(none) && /1 row changed/.test(set) && value === 7 && pageOf('r1').values.n === 1, none, set, value, back: pageOf('r1').values.n }
})
await scenario('Broken targets: Trash with Restore, a deleted property with Edit, and the pill stays', async page => {
  await pill(page, 'Gone prop').click(); await wait(700)
  const gone = await notices(page), editOffered = await page.getByRole('button', { name: 'Edit' }).count()
  await page.getByRole('button', { name: 'Edit' }).first().click(); await wait(300)
  const edits = await editor(page).count()
  await page.keyboard.press('Escape'); await wait(200)
  execSync(`node --no-warnings --input-type=module -e "import('${process.cwd()}/src/server/sqlite-repository.ts').then(async ({SqliteWorkspaceRepository:R})=>{const r=new R('${S}',undefined,{allowMissingLegacy:true});const w=await r.load();await r.execute({operationId:crypto.randomUUID(),expectedRevision:w.revision,action:{type:'delete-page',pageId:'runs',at:new Date().toISOString()}})})"`, { stdio: 'ignore' })
  await page.reload(); await wait(1800)
  const count = store().pages.length
  await pill(page, 'Log a run').click(); await wait(700)
  const trash = await notices(page), pills = await pill(page, 'Log a run').count()
  await page.getByRole('button', { name: 'Restore' }).first().click(); await wait(800)
  return { ok: /Status was deleted/.test(gone) && editOffered >= 1 && edits === 1 && /Runs is in Trash/.test(trash) && pills === 1 && store().pages.length === count && !pageOf('runs').trashedAt, gone, editOffered, edits, trash, pills, restored: !pageOf('runs').trashedAt }
})
await scenario('Open happens after the commit; a blocked link says so and sends nothing again', async page => {
  const before = rows().length
  await pill(page, 'Go to Other').click(); await wait(1200)
  const at = new URL(page.url()).search, one = rows().length
  await page.goto(`${base}/pages?page=notes`); await wait(1800)
  let sends = 0
  page.on('request', q => { if (isRun(q)) sends++ })
  await page.addInitScript(() => {}); await page.evaluate(() => { window.open = () => null })
  await pill(page, 'To a link').click(); await wait(1000)
  const said = await notices(page), two = rows().length
  return { ok: /page=other/.test(at) && one === before + 1 && two === before + 2 && /blocked/.test(said) && sends === 1, at, one, two, said, sends }
})
await scenario('Keys: Enter runs it only when chosen by its handle; a long label ends in an ellipsis on its own line', async page => {
  const before = rows().length, line = page.locator('.bn-block-outer[data-id="b-add"]')
  await line.hover(); await wait(200)
  const pillBox = await pill(page, 'Log a run').boundingBox()
  const handle = page.locator('.bn-side-menu [aria-label^="Select or drag"]').first()
  await handle.click(); await wait(250)
  await page.keyboard.press('Enter'); await wait(900)
  const ran = rows().length
  // Arrowing onto it from the line above isn't choosing it.
  await page.locator('.bn-inline-content', { hasText: 'First line' }).click(); await page.keyboard.press('Meta+ArrowRight'); await page.keyboard.press('ArrowDown'); await wait(150); await page.keyboard.press('Enter'); await wait(800)
  const arrowed = rows().length
  const long = page.locator('.editor-button-pill', { hasText: 'A very long label' }), ell = await long.locator('span').evaluate(n => n.scrollWidth > n.clientWidth), box = await long.boundingBox()
  return { ok: ran === before + 1 && arrowed === ran && ell && box.height === 36 && pillBox.height === 36, ran, arrowed, before, ell, box }
})
await scenario('Insert\'s editor: the whole / menu shows and can be picked, one Esc closes only it, and its words start where the other fields\' do', async page => {
  await page.getByRole('button', { name: 'Add lines actions' }).click({ force: true }); await wait(250); await page.getByRole('menuitem', { name: 'Edit' }).click(); await wait(350)
  await editor(page).locator('.button-step-open').first().click(); await wait(400)
  const words = page.locator('.button-blocks .ProseMirror')
  await words.click(); await page.keyboard.press('Meta+ArrowDown'); await page.keyboard.press('Enter'); await page.keyboard.type('/', { delay: 20 }); await wait(400)
  const menu = page.locator('#bn-suggestion-menu'), box = await menu.boundingBox(), hit = await menu.evaluate(n => { const r = n.getBoundingClientRect(), t = document.elementFromPoint(r.x + r.width / 2, r.y + r.height / 2); return Boolean(t && n.contains(t)) })
  await page.keyboard.press('Escape'); await wait(900)
  const gone = await menu.count(), still = await page.locator('.button-blocks').count()
  await page.keyboard.type('/', { delay: 20 }); await wait(400)
  await page.locator('#bn-suggestion-menu [role=option]').first().click(); await wait(250)
  const picked = await page.locator('#bn-suggestion-menu').count()
  const inset = await page.evaluate(() => { const b = document.querySelector('.button-blocks').getBoundingClientRect(), t = document.querySelector('.button-blocks .bn-block-content, .button-blocks .bn-inline-content').getBoundingClientRect(); return t.x - b.x })
  const done = (await editor(page).getByRole('button', { name: 'Done' }).boundingBox()).height
  return { ok: box.height >= 100 && hit && gone === 0 && still === 1 && picked === 0 && inset <= 12 && done === 28, box, hit, gone, still, picked, inset, done }
})
await scenario('To-dos: Add row is its + New, with Open and one Undo', async page => {
  await pill(page, 'New to-do').click(); await wait(1000)
  const made = store().tasks.filter(t => t.title === 'From a button').length, words = await notices(page)
  await page.getByRole('button', { name: 'Undo' }).first().click(); await wait(900)
  return { ok: made === 1 && /Added to To-dos/.test(words) && store().tasks.filter(t => t.title === 'From a button').length === 0, made, words, after: store().tasks.filter(t => t.title === 'From a button').length }
})
await scenario('390: a sheet with Done in its head; a tap raises no keyboard and takes no caret; ⋯ edits', async page => {
  await pill(page, 'Log a run').tap(); await wait(800)
  const active = await page.evaluate(() => document.activeElement?.tagName), line = await page.locator('.bn-block-outer[data-id="b-add"] .editor-button-line').boundingBox(), drawn = await pill(page, 'Log a run').boundingBox()
  await page.getByRole('button', { name: 'Log a run actions' }).tap(); await wait(250); await page.getByRole('menuitem', { name: 'Edit' }).tap(); await wait(350)
  const sheet = await editor(page).boundingBox(), size = await editor(page).getByLabel('Name').evaluate(n => getComputedStyle(n).fontSize)
  return { ok: active !== 'INPUT' && !/TEXTAREA/.test(active) && line.height >= 44 && drawn.height === 36 && sheet.width === 390 && Math.round(sheet.y + sheet.height) >= 778 && size === '16px', active, line, drawn, sheet, size }
}, phone)
await browser.close()
console.log(failed ? `${failed} failed` : 'all passed')
process.exit(failed ? 1 : 0)
