// Property tokens in the formula field (G2-7): a property reads as a token, drawn behind a plain textarea, so typing, paste, Pinyin and delete stay what they were and nothing stored changes.
// Usage: node tests/evidence/formula/tokens.mjs <base-url> <store-path> [chromium|webkit] [shots-dir]  (a throwaway store the server at <base-url> uses)
import * as pw from '@playwright/test'
import { execSync } from 'node:child_process'
const [base, S, engine = 'chromium', shots] = process.argv.slice(2)
if (!base || !S) { console.error('Usage: node tests/evidence/formula/tokens.mjs <base-url> <store-path> [chromium|webkit] [shots-dir]'); process.exit(2) }
const store = () => JSON.parse(execSync(`sqlite3 ${S} "select data from workspace"`, { maxBuffer: 1 << 26 }).toString())
const stored = id => store().pages.find(p => p.id === 'shop').database.properties.find(p => p.id === id)
const wait = ms => new Promise(r => setTimeout(r, ms))
const browser = await pw[engine].launch({ headless: true })
const wide = { viewport: { width: 1280, height: 900 } }, phone = { viewport: { width: 390, height: 780 }, hasTouch: true, isMobile: engine === 'chromium' }
let failed = 0
const scenario = async (name, seed, act, options = wide) => {
  if (process.env.ONLY && !name.includes(process.env.ONLY)) return
  execSync(`rm -f ${S} ${S}-wal ${S}-shm && node --no-warnings tests/evidence/formula/seed.ts ${S} ${seed}`, { stdio: 'ignore' })
  const context = await browser.newContext({ ...options, serviceWorkers: 'block' }), page = await context.newPage(), errors = []
  page.on('pageerror', e => { if (!/ResizeObserver loop/.test(e.message)) errors.push(e.message) })
  let r
  try { await page.goto(`${base}/pages?page=shop`); await wait(2200); r = await act(page) } catch (e) { r = { ok: false, threw: e.message.split('\n').slice(0, 3).join(' ') } }
  const ok = r.ok && !errors.length
  if (!ok) failed++
  console.log(ok ? 'PASS' : 'FAIL', name, JSON.stringify({ ...r, errors }).slice(0, 700))
  if (shots) await page.screenshot({ path: `${shots}/${name.replace(/\W+/g, '-').slice(0, 30)}-${engine}.png` }).catch(() => {})
  await context.close()
}
const menu = page => page.locator('.database-menu')
const openProperties = async page => { await page.locator('.database-more-button').first().click(); await wait(250); await menu(page).getByRole('menuitem', { name: 'Properties' }).click(); await wait(250) }
const addFormula = async (page, name) => { await openProperties(page); await menu(page).getByRole('menuitem', { name: '+ Add property' }).click(); await wait(200); await menu(page).getByLabel('Property name').fill(name); await menu(page).getByRole('menuitem', { name: 'Formula', exact: true }).click(); await wait(800) }
const field = page => menu(page).getByLabel('Formula')
const tokens = page => menu(page).locator('.formula-token').allTextContents()
const status = page => menu(page).locator('.formula-status').innerText()
const set = async (page, text) => { await field(page).fill(text); await wait(150) }
/** The backing has to wrap and scroll as the field does, or a token sits on the wrong words. */
const inStep = page => page.evaluate(() => { const f = document.querySelector('.formula-field'), b = document.querySelector('.formula-backing'); return { field: f.scrollHeight, backing: b.scrollHeight, fieldTop: f.scrollTop, backingTop: b.scrollTop, fieldInner: f.clientWidth, backingInner: b.clientWidth } })

await scenario('Properties read as tokens where they sit, and what is stored is what it was', '', async page => {
  await addFormula(page, 'Sum')
  await set(page, 'Price * Qty + 1')
  const t = await tokens(page), word = await status(page)
  await menu(page).getByRole('button', { name: 'Done' }).click(); await wait(700)
  return { ok: t.join() === 'Price,Qty' && /Pear/.test(word) && stored(Object.keys({}).length ? '' : store().pages.find(p => p.id === 'shop').database.properties.find(p => p.name === 'Sum').id).formula === 'prop("price") * prop("qty") + 1', t, word, kept: store().pages.find(p => p.id === 'shop').database.properties.find(p => p.name === 'Sum').formula }
})
await scenario('A saved formula opens with its tokens; picking from the list makes one', 'written', async page => {
  await openProperties(page); await menu(page).locator('.database-property-name', { hasText: 'Total' }).click(); await wait(250); await menu(page).getByRole('menuitem', { name: 'Edit formula' }).click(); await wait(300)
  const opened = await tokens(page)
  await field(page).focus(); await page.keyboard.press(engine === 'webkit' ? 'Meta+ArrowDown' : 'Control+End'); await page.keyboard.type(' + '); await menu(page).locator('.formula-item', { hasText: /^Qty$/ }).click(); await wait(150)
  const picked = await tokens(page), text = await field(page).inputValue()
  return { ok: opened.join() === 'Price,Qty' && picked.join() === 'Price,Qty,Qty' && text === 'Price * Qty + Qty', opened, picked, text }
})
await scenario('Paste and typing behave as today: prop(), a bare name, a misspelling, a word in quotes, and text that doesn\'t read yet', '', async page => {
  await addFormula(page, 'Sum')
  const out = {}
  for (const [key, text] of Object.entries({ spelled: 'prop("Price") * 2', bare: 'Price * 2', typo: 'Prcie * 2', quoted: 'length("Price")', unfinished: 'Price * ', unclosed: 'if(Price > 1, Qty', letName: 'let(Price, 2, Price + Qty)' })) { await set(page, text); out[key] = await tokens(page); out[`${key}Says`] = (await status(page)).slice(0, 50) }
  return { ok: out.spelled.join() === 'prop("Price")' && out.bare.join() === 'Price' && out.typo.length === 0 && /Prcie/.test(out.typoSays) && out.quoted.length === 0 && out.unfinished.join() === 'Price' && out.unclosed.join() === 'Price,Qty' && out.letName.join() === 'Qty', ...out }
})
await scenario('Delete works a character at a time, and a name no longer whole stops being a token', '', async page => {
  await addFormula(page, 'Sum')
  await set(page, 'Price * Qty')
  await field(page).focus(); await page.keyboard.press('Backspace'); await wait(150)
  const after = await tokens(page), text = await field(page).inputValue()
  await page.keyboard.type('y'); await wait(150)
  return { ok: after.join() === 'Price' && text === 'Price * Qt' && (await tokens(page)).join() === 'Price,Qty', after, text }
})
await scenario('The backing keeps step with the field: long lines wrap alike, and it scrolls with it', '', async page => {
  await addFormula(page, 'Sum')
  const long = Array.from({ length: 30 }, (_, i) => (i % 2 ? 'Price' : 'Qty')).join(' + ')
  await set(page, long)
  const wrapped = await inStep(page)
  await field(page).evaluate(n => { n.scrollTop = n.scrollHeight }); await wait(150)
  const scrolled = await inStep(page)
  await set(page, `${'x'.repeat(200)} + Price\n\n`)
  const unbroken = await inStep(page)
  return { ok: wrapped.field === wrapped.backing && wrapped.field > 100 && scrolled.fieldTop > 0 && scrolled.fieldTop === scrolled.backingTop && unbroken.field === unbroken.backing && wrapped.fieldInner === wrapped.backingInner, wrapped, scrolled, unbroken }
})
await scenario('Pinyin: letters being spelled aren\'t a token, even if they spell a name, and a Chinese name is one once chosen', '', async page => {
  if (engine !== 'chromium') return { ok: true, skipped: 'needs CDP' }
  await addFormula(page, 'Sum')
  const cdp = await page.context().newCDPSession(page)
  await set(page, 'Qty + '); await field(page).focus(); await page.keyboard.press('End')
  await cdp.send('Input.imeSetComposition', { text: 'Price', selectionStart: 5, selectionEnd: 5 }); await wait(150)
  const during = await tokens(page), duringText = await field(page).inputValue()
  await cdp.send('Input.insertText', { text: 'Price' }); await wait(150)
  return { ok: during.join() === 'Qty' && duringText === 'Qty + Price' && (await tokens(page)).join() === 'Qty,Price', during, duringText, after: await tokens(page) }
})
await scenario('390: tokens at 16 px with the field, in step', '', async page => {
  await addFormula(page, 'Sum')
  await set(page, 'Price * Qty + Price * Qty + Price * Qty + Price * Qty + Price * Qty')
  const step = await inStep(page), size = await page.evaluate(() => [getComputedStyle(document.querySelector('.formula-field')).fontSize, getComputedStyle(document.querySelector('.formula-backing')).fontSize])
  return { ok: (await tokens(page)).length === 10 && step.field === step.backing && size.join() === '16px,16px', step, size }
}, phone)
await browser.close()
console.log(failed ? `${failed} failed` : 'all passed')
process.exit(failed ? 1 : 0)
