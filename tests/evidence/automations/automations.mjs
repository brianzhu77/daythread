// A database's rules in the built app (automations.md, G3-11 to G3-15): the list, the editor, and a rule running inside his change with one Undo.
// Usage: node tests/evidence/automations/automations.mjs <base-url> <store-path> [chromium|webkit] [shots-dir]  (a throwaway store the server at <base-url> uses)
import * as pw from '@playwright/test'
import { execSync } from 'node:child_process'
const [base, S, engine = 'chromium', shots] = process.argv.slice(2)
if (!base || !S) { console.error('Usage: node tests/evidence/automations/automations.mjs <base-url> <store-path> [chromium|webkit] [shots-dir]'); process.exit(2) }
const store = () => JSON.parse(execSync(`sqlite3 ${S} "select data from workspace"`, { maxBuffer: 1 << 26 }).toString())
const db = () => store().pages.find(p => p.id === 'runs').database
const rows = () => store().pages.filter(p => p.parentId === 'runs' && !p.trashedAt)
const wait = ms => new Promise(r => setTimeout(r, ms))
const browser = await pw[engine].launch({ headless: true })
const wide = { viewport: { width: 1280, height: 900 } }, phone = { viewport: { width: 390, height: 780 }, hasTouch: true }
let failed = 0
const scenario = async (name, seed, act, options = wide) => {
  if (process.env.ONLY && !name.includes(process.env.ONLY)) return
  execSync(`rm -f ${S} ${S}-wal ${S}-shm && node --no-warnings tests/evidence/automations/seed.ts ${S} ${seed}`, { stdio: 'ignore' })
  const context = await browser.newContext({ ...options, serviceWorkers: 'block' }), page = await context.newPage(), errors = []
  page.on('pageerror', e => { if (!/ResizeObserver loop/.test(e.message)) errors.push(e.message) })
  let r
  try { await page.goto(`${base}/pages?page=runs`); await wait(2000); r = await act(page) } catch (e) { r = { ok: false, threw: e.message.split('\n').slice(0, 4).join(' ') } }
  const ok = r.ok && !errors.length
  if (!ok) failed++
  console.log(ok ? 'PASS' : 'FAIL', name, JSON.stringify({ ...r, errors }).slice(0, 700))
  if (shots) await page.screenshot({ path: `${shots}/${name.replace(/\W+/g, '-').slice(0, 26)}-${engine}.png` }).catch(() => {})
  await context.close()
}
const sheet = page => page.locator('.automation-sheet')
const openSheet = async page => { await page.locator('.database-more-button').first().click(); await wait(250); await page.locator('.database-menu').getByRole('menuitem', { name: /^Automations/ }).click(); await wait(350) }
const notices = page => page.locator('[role=alert], [role=status]').allTextContents().then(t => t.join(' | ').replace(/\s+/g, ' '))
const addNew = async page => { await page.locator('.database-table-wrap').getByText('+ New').first().click(); await wait(900) }

await scenario('Making one: none yet, When and Do, Done goes to what\'s missing, a blank name takes its step\'s words, and it runs with one Undo', '', async page => {
  await openSheet(page)
  const empty = await sheet(page).getByText('No automations').count()
  await sheet(page).getByRole('menuitem', { name: '+ New automation' }).click(); await wait(200)
  await sheet(page).getByRole('button', { name: 'Done' }).click(); await wait(150)
  const toKinds = await sheet(page).getByRole('menuitem').allTextContents()
  await sheet(page).getByRole('menuitem', { name: 'Edit property' }).click(); await wait(200)
  await sheet(page).getByRole('button', { name: 'Back' }).click(); await wait(150)
  const missing = await sheet(page).locator('.is-incomplete small').textContent()
  await sheet(page).getByRole('button', { name: 'Done' }).click(); await wait(150)
  await sheet(page).getByLabel('Set a property').selectOption('n'); await wait(100); await sheet(page).getByLabel('N', { exact: true }).fill('5'); await wait(100)
  await sheet(page).getByRole('button', { name: 'Back' }).click(); await wait(150)
  await sheet(page).getByRole('button', { name: 'Done' }).click(); await wait(900)
  const made = db().automations?.[0], line = await sheet(page).locator('.automation-open small').first().textContent()
  await page.keyboard.press('Escape'); await wait(200)
  const before = rows().length
  await addNew(page)
  const added = rows().find(r => r.id !== 'r1'), words = await notices(page), ran = db().automations[0].lastRanAt
  const undo = page.getByRole('button', { name: 'Undo' }).first(); await undo.click(); await wait(900)
  return { ok: empty === 1 && toKinds.join().includes('Edit property') && !toKinds.join().includes('Insert') && missing === 'Needs a property to set' && made?.name === 'Set N' && line === 'Not run yet' && added?.values?.n === 5 && Boolean(ran) && /Set N/.test(words) && rows().length === before, empty, toKinds, missing, name: made?.name, line, value: added?.values?.n, words, after: rows().length, before }
})
await scenario('The list: each status line, the menu\'s count, reorder, a switch, and a broken one opens Edit', 'rules', async page => {
  await page.locator('.database-more-button').first().click(); await wait(250)
  const row = await page.locator('.database-menu').getByRole('menuitem', { name: /^Automations/ }).textContent()
  await page.keyboard.press('Escape'); await wait(150)
  await openSheet(page)
  const lines = await sheet(page).locator('.automation-open small').allTextContents(), broken = await sheet(page).locator('small.is-broken').count()
  await sheet(page).getByRole('button', { name: 'Move Switched off up' }).click(); await wait(600)
  const order = db().automations.map(r => r.id)
  await sheet(page).getByRole('switch', { name: 'Mark new on' }).click(); await wait(600)
  const off = db().automations.find(r => r.id === 'works').active
  await sheet(page).getByRole('switch', { name: 'Uses a gone one on' }).click(); await wait(300)
  const editing = await sheet(page).getByText('When', { exact: true }).count()
  const says = await sheet(page).locator('.button-step-problem').textContent(), offDone = await sheet(page).locator('.button-editor-done.is-off').count()
  return { ok: row === 'Automations · 1 paused' && /Soon gone was deleted/.test(says) && offDone === 1 && lines[0] === 'Not run yet' && /Paused · Soon gone was deleted · Edit/.test(lines[1]) && lines[2] === 'Off' && broken === 1 && order.join() === 'works,off,broken' && off === false && editing === 1, row, lines, broken, order, off, editing }
})
await scenario('A broken rule pauses at his edit, which stands, with the name and Edit on the notice, and the menu says so', 'rules', async page => {
  const cell = page.locator('tr', { hasText: 'One' }).first().locator('.database-cell').first()
  await cell.click(); await wait(250); await page.keyboard.type('7', { delay: 10 }); await page.keyboard.press('Enter'); await wait(1000)
  const value = store().pages.find(p => p.id === 'r1').values?.n, words = await notices(page), rule = db().automations.find(r => r.id === 'broken')
  const undo = await page.getByRole('button', { name: 'Undo' }).count()
  await page.getByRole('button', { name: 'Edit', exact: true }).first().click(); await wait(350)
  const opened = await sheet(page).count()
  return { ok: value === 17 && undo >= 1 && rule.active === false && /deleted/.test(rule.paused?.reason ?? '') && /Uses a gone one paused/.test(words) && opened === 1, value, rule, words, opened }
})
await scenario('A broken rule\'s step says so, and a rename reaches the rule\'s words; the sheet opens by the database\'s menu; a rule\'s two lines sit together', 'rules', async page => {
  const more = await page.locator('.database-more-button').first().boundingBox()
  execSync(`node --no-warnings --input-type=module -e "import('${process.cwd()}/src/server/sqlite-repository.ts').then(async ({SqliteWorkspaceRepository:R})=>{const r=new R('${S}',undefined,{allowMissingLegacy:true});const w=await r.load();await r.execute({operationId:crypto.randomUUID(),expectedRevision:w.revision,action:{type:'change-database',pageId:'runs',change:{kind:'updateProperty',propertyId:'n',name:'Count'}}})})"`, { stdio: 'ignore' })
  await page.reload(); await wait(1800)
  await openSheet(page)
  const box = await sheet(page).boundingBox(), first = sheet(page).locator('.automation-row').first()
  const [name, status] = await Promise.all([first.locator('.automation-open > span').boundingBox(), first.locator('.automation-open > small').boundingBox()]), next = await sheet(page).locator('.automation-row').nth(1).locator('.automation-open > span').boundingBox()
  const gapInside = status.y - (name.y + name.height), gapAfter = next.y - (status.y + status.height), switchBox = await first.getByRole('switch').boundingBox()
  await sheet(page).locator('.automation-open').first().click(); await wait(250)
  const renamed = await sheet(page).locator('.button-step-open').first().textContent()
  await sheet(page).getByRole('button', { name: 'Back' }).click(); await wait(200)
  await sheet(page).locator('.automation-open').nth(1).click(); await wait(250)
  const marked = await sheet(page).locator('.button-step-row.is-incomplete small').textContent(), when = await sheet(page).getByLabel('When').first().evaluate(n => n.selectedOptions[0].textContent)
  return { ok: Math.abs(box.x - more.x) <= 1 && gapAfter > gapInside && switchBox.width >= 30 && /Count/.test(renamed) && marked === 'Soon gone was deleted' && /Count/.test(when), box, more, gapInside, gapAfter, switchBox, renamed, marked, when }
})
await scenario('Every…: chosen, on its own, with no Edit property offered, its fields behaving; once due it runs on opening, once, with no notice and its true Last ran', '', async page => {
  await openSheet(page)
  await sheet(page).getByRole('menuitem', { name: '+ New automation' }).click(); await wait(200)
  await sheet(page).getByLabel('When').first().selectOption({ label: 'Every…' }); await wait(150)
  const noMore = await sheet(page).getByRole('menuitem', { name: '+ Add trigger' }).count()
  // The number can be cleared on the way to another; leaving an empty one goes back.
  const howMany = sheet(page).getByLabel('How many')
  await howMany.click(); await page.keyboard.press('Backspace'); await wait(80); const cleared = await howMany.inputValue(); await page.keyboard.type('2'); await wait(80); const typed = await howMany.inputValue()
  await page.keyboard.press('Backspace'); await sheet(page).getByLabel('Period').focus(); await wait(80); const back = await howMany.inputValue()
  // From's weekday shows, and the last can't be turned off.
  const dayOn = () => sheet(page).locator('.automation-weekdays button.is-on').allTextContents(), dayShown = await dayOn()
  await sheet(page).locator('.automation-weekdays button.is-on').click(); await wait(80); const stillOn = await dayOn()
  // An end date is asked for, and one before From says so and holds Done.
  const noUntil = await sheet(page).getByLabel('Until').count()
  await sheet(page).getByRole('button', { name: '+ End date' }).click(); await wait(80); await sheet(page).getByLabel('Until').fill('2020-01-01'); await wait(80)
  const early = await sheet(page).locator('.button-step-problem').textContent()
  await sheet(page).getByRole('button', { name: 'No end date' }).click(); await wait(80)
  await sheet(page).getByRole('menuitem', { name: '+ Add step' }).click(); await wait(150)
  const offered = await sheet(page).getByRole('menuitem').allTextContents()
  await sheet(page).getByRole('menuitem', { name: 'Add row to' }).click(); await wait(200)
  await sheet(page).getByLabel('Database').selectOption('runs'); await sheet(page).getByLabel('Row name').fill('Scheduled'); await wait(100)
  await sheet(page).getByRole('button', { name: 'Back' }).click(); await wait(150)
  await sheet(page).getByLabel('Name').fill('Weekly')
  // From long ago, set up then, so a period is due as soon as it's saved.
  await sheet(page).getByRole('button', { name: 'Done' }).click(); await wait(900)
  const rule = db().automations[0]
  const seed = `node --no-warnings --input-type=module -e "import('${process.cwd()}/src/server/sqlite-repository.ts').then(async ({SqliteWorkspaceRepository:R})=>{const r=new R('${S}',undefined,{allowMissingLegacy:true});const w=await r.load();const a=w.pages.find(p=>p.id==='runs').database.automations[0];await r.execute({operationId:crypto.randomUUID(),expectedRevision:w.revision,action:{type:'change-database',pageId:'runs',change:{kind:'updateAutomation',automation:{...a,triggers:[{kind:'every',repeat:{every:'week',interval:1,start:'2026-01-05',time:'00:00',notBefore:'2026-01-05T00:00'}}]}}}})})"`
  execSync(seed, { stdio: 'ignore' })
  await page.reload(); await wait(2600)
  const one = rows().filter(r => r.title === 'Scheduled').length, words = await notices(page), last = db().automations[0].lastRanAt
  await page.reload(); await wait(2600)
  const still = rows().filter(r => r.title === 'Scheduled').length
  const says = offered.join()
  return { ok: noMore === 0 && cleared === '' && typed === '2' && back === '2' && dayShown.length === 1 && stillOn.join() === dayShown.join() && noUntil === 0 && /never run/.test(early) && !says.includes('Edit property') && rule.name === 'Weekly' && one === 1 && still === 1 && Boolean(last) && !/Weekly/.test(words), noMore, cleared, typed, back, dayShown, stillOn, noUntil, early, says, name: rule.name, one, still, last, words }
})
await scenario('390: a sheet that fits, with 16 px fields', '', async page => {
  await page.locator('.database-more-button').first().tap(); await wait(300); await page.locator('.database-menu').getByRole('menuitem', { name: /^Automations/ }).tap(); await wait(400)
  await sheet(page).getByRole('menuitem', { name: '+ New automation' }).tap(); await wait(250)
  const box = await sheet(page).boundingBox(), size = await sheet(page).getByLabel('Name').evaluate(n => getComputedStyle(n).fontSize), over = await page.evaluate(() => document.documentElement.scrollWidth > innerWidth)
  return { ok: box.width === 390 && Math.round(box.y + box.height) >= 778 && size === '16px' && !over, box, size, over }
}, phone)
await browser.close()
console.log(failed ? `${failed} failed` : 'all passed')
process.exit(failed ? 1 : 0)
