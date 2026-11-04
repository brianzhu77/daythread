// R4-3: writing a formula in the menu, what it shows, what's refused, and what happens when what it reads goes away.
// Usage: node tests/evidence/formula/formula.mjs <base-url> <store-path> [chromium|webkit]  (a throwaway store the server at <base-url> uses)
import * as pw from '@playwright/test'
import { execSync } from 'node:child_process'
const [base, storePath, engine = 'chromium'] = process.argv.slice(2)
if (!base || !storePath) { console.error('Usage: node tests/evidence/formula/formula.mjs <base-url> <store-path> [chromium|webkit]'); process.exit(2) }
const store = () => JSON.parse(execSync(`sqlite3 ${storePath} "select data from workspace"`, { maxBuffer: 1 << 26 }).toString())
const stored = id => store().pages.find(p => p.id === 'shop').database.properties.find(p => p.id === id)
const wait = ms => new Promise(r => setTimeout(r, ms))
const browser = await pw[engine].launch({ headless: true })
const wide = { viewport: { width: 1280, height: 900 } }, phone = { viewport: { width: 390, height: 780 }, hasTouch: true, isMobile: engine === 'chromium' }
let failed = 0
const scenario = async (name, seed, act, options = wide) => {
  if (process.env.ONLY && !new RegExp(process.env.ONLY).test(name)) return
  execSync(`rm -f ${storePath} ${storePath}-wal ${storePath}-shm && node --no-warnings tests/evidence/formula/seed.ts ${storePath} ${seed}`, { stdio: 'ignore' })
  const context = await browser.newContext(options)
  const page = await context.newPage(), errors = []
  page.on('pageerror', e => { if (!/ResizeObserver loop/.test(e.message)) errors.push(e.message) })
  let r
  try { await page.goto(`${base}/pages?page=shop`); await wait(2200); r = await act(page) } catch (e) { r = { ok: false, threw: e.message.split('\n').slice(0, 3).join(' ') } }
  const ok = r.ok && !errors.length
  if (!ok) failed++
  console.log(ok ? 'PASS' : 'FAIL', name, JSON.stringify({ ...r, errors }))
  if (process.env.SHOTS) await page.screenshot({ path: `${process.env.SHOTS}/${name.replace(/\W+/g, '-').slice(0, 40)}-${engine}.png` }).catch(() => {})
  await context.close()
}
const menu = page => page.locator('.database-menu')
// Set by the scenario below: the page's clock has to be in place before the app loads.
const r_midnight = async page => {
  const r = {}
  await page.clock.install({ time: new Date('2026-11-03T15:50:00Z') })
  await page.goto(`${base}/pages?page=shop`); await wait(2500)
  r.clockBefore = await page.evaluate(() => new Date().toString())
  r.before = await cells(page, 'pear')
  await page.clock.fastForward(20 * 60_000); await wait(1500)
  r.clockAfter = await page.evaluate(() => new Date().toString())
  r.after = await cells(page, 'pear')
  r.ok = r.before.includes('2026-11-03') && r.after.includes('2026-11-04')
  return r
}
const tap = (page, locator) => (page.context()._options?.hasTouch ? locator.tap() : locator.click())
const openProperties = async page => {
  await page.locator('.database-more-button').first().click(); await wait(250)
  await menu(page).getByRole('menuitem', { name: 'Properties' }).click(); await wait(250)
}
const openProperty = async (page, name) => {
  await openProperties(page)
  await menu(page).locator('.database-property-name', { hasText: name }).click(); await wait(250)
}
const openEditor = async (page, name) => {
  await openProperty(page, name)
  await menu(page).getByRole('menuitem', { name: 'Edit formula' }).click(); await wait(250)
}
const addFormula = async (page, name) => {
  await openProperties(page)
  await menu(page).getByRole('menuitem', { name: '+ Add property' }).click(); await wait(200)
  await menu(page).getByLabel('Property name').fill(name)
  await menu(page).getByRole('menuitem', { name: 'Formula', exact: true }).click(); await wait(800)
}
const field = page => menu(page).getByLabel('Formula')
const status = page => menu(page).locator('.formula-status').innerText()
const done = page => menu(page).getByRole('button', { name: 'Done' }).click()
const cells = async (page, row) => (await page.locator(`.database-row[data-row="${row}"] .database-td:not(.is-title)`).allInnerTexts()).map(t => t.trim())

await scenario('Write one: live preview, error while typing, Done refused with the reason, then saved; read-only in the table', '', async page => {
  await addFormula(page, 'Total')
  const r = {}
  await field(page).fill('Price *'); await wait(150)
  r.unfinished = await status(page)
  await done(page); await wait(300)
  r.stillOpen = await field(page).isVisible()
  r.storedAfterRefusal = stored(store().pages.find(p => p.id === 'shop').database.properties.at(-1).id).formula
  await field(page).fill('abs("x")'); await wait(150)
  r.typeError = await status(page)
  await field(page).fill('Price * Qty'); await wait(150)
  r.preview = await status(page)
  await done(page); await wait(1000)
  const made = store().pages.find(p => p.id === 'shop').database.properties.at(-1)
  r.stored = made.formula
  await page.keyboard.press('Escape'); await wait(300)
  r.pear = await cells(page, 'pear')
  r.plum = await cells(page, 'plum')
  await page.locator('.database-row[data-row="pear"] .database-td:not(.is-title)').last().click(); await wait(250)
  r.noEditorOnClick = await page.locator('.property-editor, .property-search').count()
  r.rowValues = store().pages.find(p => p.id === 'pear').values
  r.ok = /stops before/.test(r.unfinished) && r.stillOpen && r.storedAfterRefusal === '' && /expects a number/.test(r.typeError) && /Pear 6/.test(r.preview) && r.stored === 'prop("price") * prop("qty")' && r.pear.includes('6') && r.plum.includes('5') && !r.noEditorOnClick && !('total' in r.rowValues) && Object.keys(r.rowValues).length === 2
  return r
})

await scenario('Pasted forms: bare names and full-width punctuation; the list inserts and explains on selection', '', async page => {
  await addFormula(page, 'Note')
  const r = {}
  await field(page).fill('if（Price > 3，“dear”，“cheap”）'); await wait(150)
  r.preview = await status(page)
  r.docBefore = await menu(page).locator('.formula-doc').count()
  await field(page).fill('')
  await menu(page).locator('.formula-item.is-function', { hasText: /^round$/ }).click(); await wait(150)
  r.inserted = await field(page).inputValue()
  r.doc = await menu(page).locator('.formula-doc').innerText()
  await menu(page).locator('.formula-item', { hasText: /^Price$/ }).click(); await wait(150)
  r.caretKept = await field(page).inputValue()
  r.preview2 = await status(page)
  const box = await menu(page).boundingBox()
  r.onScreen = box.x >= 8 && box.x + box.width <= 1272
  r.ok = r.onScreen && /Pear cheap/.test(r.preview) && r.docBefore === 0 && r.inserted === 'round()' && /nearest whole/.test(r.doc) && r.caretKept === 'round(prop("Price"))' && /Pear 2/.test(r.preview2)
  return r
})

await scenario('Rename: same result. Delete: Error in red with the reason in its menu; Undo brings it back', 'written', async page => {
  const r = {}
  r.before = (await cells(page, 'pear'))
  await openProperty(page, 'Qty')
  await menu(page).getByLabel('Name').fill('Count'); await page.keyboard.press('Enter'); await wait(800)
  await page.keyboard.press('Escape'); await wait(300)
  r.renamed = await cells(page, 'pear')
  await openEditor(page, 'Total')
  r.shown = await field(page).inputValue()
  await page.keyboard.press('Escape'); await wait(300)
  await openProperty(page, 'Count')
  await menu(page).getByRole('menuitem', { name: 'Delete property' }).click(); await wait(800)
  await page.keyboard.press('Escape'); await wait(300)
  const totalCell = page.locator('.database-row[data-row="pear"] .cell-error').first()
  r.errorText = await totalCell.innerText()
  r.colour = await totalCell.evaluate(e => getComputedStyle(e).color)
  r.red = await page.evaluate(() => { const s = document.createElement('span'); s.style.color = 'var(--red)'; document.body.append(s); const c = getComputedStyle(s).color; s.remove(); return c })
  await openProperty(page, 'Total')
  r.reason = await menu(page).locator('.is-error').innerText()
  await page.keyboard.press('Escape'); await wait(300)
  await page.locator('.toast__action').first().click(); await wait(1200)
  r.undone = await cells(page, 'pear')
  r.ok = r.before.includes('6') && r.renamed.includes('6') && r.shown === 'prop("Price") * prop("Count")' && r.errorText === 'Error' && r.colour === r.red && /deleted/.test(r.reason) && r.undone.includes('6') && !(await page.locator('.database-row[data-row="pear"] .cell-error', { hasText: /^Error$/ }).count())
  return r
})

await scenario('A slow formula reads Error · too long, the rest of the table works, and a checkbox formula can\'t be ticked', 'written', async page => {
  const r = {}
  r.pear = await cells(page, 'pear')
  const check = page.locator('.database-row[data-row="pear"] .property-checkbox').first()
  r.checked = await check.getAttribute('aria-checked')
  r.disabled = await check.isDisabled()
  r.ok = r.pear.includes('Error · too long') && r.pear.includes('6') && r.pear.includes('Overdue') && r.checked === 'true' && r.disabled
  return r
})

await scenario('The Group menu offers it (a filter, a sort and the foot are in tests/formula-database.test.ts)', 'written', async page => {
  const r = {}
  await page.locator('.database-more-button').first().click(); await wait(250)
  await menu(page).getByRole('button', { name: 'Group', exact: true }).click(); await wait(250)
  r.group = (await menu(page).locator('option').allTextContents()).join(' ')
  await page.keyboard.press('Escape'); await wait(200)
  r.ok = /Total/.test(r.group) && /Late/.test(r.group)
  return r
})

await scenario('A loop is refused at Done, and Cancel leaves the old text', 'written', async page => {
  const r = {}
  await openEditor(page, 'Total')
  await field(page).fill('Dear'); await wait(150)
  r.status = await status(page)
  await done(page); await wait(300)
  r.stillOpen = await field(page).isVisible()
  await menu(page).getByRole('button', { name: 'Cancel' }).click(); await wait(300)
  r.after = stored('total').formula
  r.ok = /Cycle detected/.test(r.status) && r.stillOpen && r.after === 'prop("price") * prop("qty")'
  return r
})

await scenario('390: the sheet, the list one tap away, nothing past the edge, 44 px targets', '', async page => {
  const r = {}
  await addFormula(page, 'Total')
  await field(page).fill('Price * Qty'); await wait(150)
  r.preview = await status(page)
  r.listHidden = await menu(page).locator('.formula-list').count()
  const box = await menu(page).boundingBox()
  r.sheet = box && { x: box.x, right: box.x + box.width, bottom: box.y + box.height }
  await menu(page).getByRole('button', { name: 'Properties and functions' }).click(); await wait(250)
  r.listShown = await menu(page).locator('.formula-list').count()
  r.itemHeight = (await menu(page).locator('.formula-item').first().boundingBox())?.height
  await menu(page).locator('.formula-item', { hasText: /^Name$/ }).click(); await wait(250)
  r.afterInsert = await field(page).inputValue()
  r.listClosed = await menu(page).locator('.formula-list').count()
  r.overflow = await page.evaluate(() => document.documentElement.scrollWidth - innerWidth)
  await field(page).fill('Price * Qty'); await wait(150)
  await done(page); await wait(1000)
  r.stored = store().pages.find(p => p.id === 'shop').database.properties.at(-1).formula
  r.ok = /Pear 6/.test(r.preview) && r.listHidden === 0 && r.sheet.x === 0 && r.sheet.right === 390 && r.listShown === 1 && r.itemHeight >= 44 && /prop\("Name"\)/.test(r.afterInsert) && r.listClosed === 0 && r.overflow <= 0 && r.stored === 'prop("price") * prop("qty")'
  return r
}, phone)

await scenario('Through a relation: the value, page refs that open their row, and a rollup that reads a formula, made in the menu', 'linked', async page => {
  const r = {}
  r.pear = await cells(page, 'pear')
  const refs = page.locator('.database-row[data-row="pear"] .relation-ref, .database-row[data-row="pear"] .cell-relation a, .database-row[data-row="pear"] .cell-relation button')
  r.refs = await refs.allInnerTexts()
  await openProperties(page)
  await menu(page).getByRole('menuitem', { name: '+ Add property' }).click(); await wait(200)
  await menu(page).getByLabel('Property name').fill('Sum double')
  await menu(page).getByRole('menuitem', { name: 'Rollup', exact: true }).click(); await wait(900)
  const selects = menu(page).locator('select')
  await selects.nth(2).selectOption({ label: 'Double' }); await wait(800)
  await menu(page).locator('select').nth(3).selectOption({ label: 'Sum' }); await wait(1000)
  await page.keyboard.press('Escape'); await wait(300)
  r.after = await cells(page, 'pear')
  r.ok = r.pear.includes('Bob') && r.pear.includes('100') && r.pear.includes('200') && r.refs.join() === 'Ann,Bob,Bob' && r.after.filter(c => c === '200').length === 2
  return r
})

await scenario('A loop through two databases is refused in the field', 'linked', async page => {
  const r = {}
  await page.goto(`${base}/pages?page=makers`); await wait(1800)
  await openEditor(page, 'Double')
  await field(page).fill('Shops.first().Doubled'); await wait(150)
  r.status = await status(page)
  await done(page); await wait(300)
  r.stillOpen = await field(page).isVisible()
  await field(page).fill('Shops.first().Price'); await wait(150)
  r.fine = await status(page)
  r.ok = /Cycle detected/.test(r.status) && r.stillOpen && /Ann/.test(r.fine)
  return r
})

await scenario('Pinyin: nothing reacts mid-composition, and the word lands', '', async page => {
  if (engine !== 'chromium') return { ok: true, skipped: 'needs CDP' }
  await addFormula(page, 'Note')
  const cdp = await page.context().newCDPSession(page)
  await field(page).fill('"'); await wait(120)
  const before = await status(page)
  await field(page).focus()
  await cdp.send('Input.imeSetComposition', { text: 'jia', selectionStart: 3, selectionEnd: 3 }); await wait(120)
  const during = await status(page), duringText = await field(page).inputValue()
  await cdp.send('Input.insertText', { text: '价' }); await wait(120)
  await page.keyboard.type('"'); await wait(150)
  const after = await status(page)
  return { before, during, duringText, after, ok: /closing/.test(before) && during === before && /jia/.test(duringText) && /Pear 价/.test(after) }
})

await scenario('A pathological pattern and repeat don\'t hang the tab, at 390', '', async page => {
  await addFormula(page, 'Bad')
  const r = {}
  const started = Date.now()
  await field(page).fill('test(repeat("a", 5000) + "b", "^(a+)+$")'); await wait(200)
  r.regex = await status(page)
  await field(page).fill('repeat("x", 1000000)'); await wait(200)
  r.repeat = await status(page)
  await field(page).fill('split(repeat("x", 800), "").map(split(repeat("y", 800), "").map(current + "z")).length()'); await wait(200)
  r.nested = await status(page)
  r.ms = Date.now() - started
  r.ok = /Too long|false/.test(r.regex) && /Too long/.test(r.repeat) && /Too long/.test(r.nested) && r.ms < 4000
  return r
}, phone)

// Shanghai has no change of clocks, and Playwright's WebKit and Node disagree about this week's in Vancouver.
await scenario('today() turns over at local midnight with no reload', 'clock', async page => r_midnight(page), { ...wide, timezoneId: 'Asia/Shanghai' })

await browser.close()
console.log(failed ? `${failed} FAILED` : 'ALL PASS')
process.exit(failed ? 1 : 0)
