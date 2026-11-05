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


await scenario('Independent: invalid edit preserves saved formula; valid repair persists after reload', 'written', async page => {
 await openProperties(page); await menu(page).locator('.database-property-name', {hasText:'Total'}).click(); await menu(page).getByRole('menuitem',{name:'Edit formula'}).click();
 await set(page,'Price * Qtx'); await menu(page).getByRole('button',{name:'Done',exact:true}).click(); await wait(250);
 const refused = await field(page).inputValue(), before=stored('total').formula;
 await set(page,'Price * Qty + 7'); await menu(page).getByRole('button',{name:'Done',exact:true}).click(); await wait(700); await page.reload(); await wait(1000);
 return {ok:refused==='Price * Qtx' && before==='prop("price") * prop("qty")' && stored('total').formula==='prop("price") * prop("qty") + 7',refused,before,after:stored('total').formula};
});
await scenario('Independent: composition committing identical text leaves tokens intact', '', async page => {
 if(engine!=='chromium') return {ok:true,skipped:'CDP only'};
 await addFormula(page,'Sum'); await set(page,'Qty + Price');
 await field(page).evaluate(n=>{n.focus();n.setSelectionRange(6,11)});
 const cdp=await page.context().newCDPSession(page);
 await cdp.send('Input.imeSetComposition',{text:'Price',selectionStart:5,selectionEnd:5}); await wait(100);
 const during=await tokens(page);
 await cdp.send('Input.insertText',{text:'Price'}); await wait(100);
 const after=await tokens(page), text=await field(page).inputValue();
 return {ok:after.join()==='Qty,Price',during,after,text};
});
await browser.close(); process.exit(failed?1:0);
