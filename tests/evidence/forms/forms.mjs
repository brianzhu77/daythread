// Forms, Only me, in the built app (forms.md, G7-1 to G7-7): building on the form, answering on a page, and what a send holds through failure.
// Usage: node tests/evidence/forms/forms.mjs <base-url> <store-path> [chromium|webkit] [shots-dir]  (a throwaway store the server at <base-url> uses)
import * as pw from '@playwright/test'
import { execSync } from 'node:child_process'
const [base, S, engine = 'chromium', shots] = process.argv.slice(2)
if (!base || !S) { console.error('Usage: node tests/evidence/forms/forms.mjs <base-url> <store-path> [chromium|webkit] [shots-dir]'); process.exit(2) }
const store = () => JSON.parse(execSync(`sqlite3 ${S} "select data from workspace"`, { maxBuffer: 1 << 26 }).toString())
const db = () => store().pages.find(p => p.id === 'runs').database
const form = () => db().views.find(v => v.id === 'f').form
const rows = () => store().pages.filter(p => p.parentId === 'runs' && !p.trashedAt)
const wait = ms => new Promise(r => setTimeout(r, ms))
const browser = await pw[engine].launch({ headless: true })
const wide = { viewport: { width: 1280, height: 900 } }, phone = { viewport: { width: 390, height: 780 }, hasTouch: true }
let failed = 0
const scenario = async (name, act, options = wide, path = '/form?db=runs&view=f') => {
  if (process.env.ONLY && !name.includes(process.env.ONLY)) return
  execSync(`rm -f ${S} ${S}-wal ${S}-shm && node --no-warnings tests/evidence/forms/seed.ts ${S}`, { stdio: 'ignore' })
  const context = await browser.newContext({ ...options, serviceWorkers: 'block' }), page = await context.newPage(), errors = []
  page.on('pageerror', e => { if (!/ResizeObserver loop/.test(e.message)) errors.push(e.message) })
  let r
  try { await page.goto(`${base}${path}`); await wait(2200); r = await act(page, context) } catch (e) { r = { ok: false, threw: e.message.split('\n').slice(0, 4).join(' ') } }
  const ok = r.ok && !errors.length
  if (!ok) failed++
  console.log(ok ? 'PASS' : 'FAIL', name, JSON.stringify({ ...r, errors }).slice(0, 700))
  if (shots) await page.screenshot({ path: `${shots}/form-${name.replace(/\W+/g, '-').slice(0, 26)}-${engine}-${options.viewport.width}.png` }).catch(() => {})
  await context.close()
}
const showForm = async page => { await page.getByRole('button', { name: /^Table/ }).first().click(); await wait(300); await page.locator('.database-menu').getByText('Log a run', { exact: true }).first().click(); await wait(800) }
const isPost = q => q.method() === 'POST' && (q.postData() ?? '').includes('answer-form')

await scenario('Building on the form: a tap opens a question in place; its words don\'t rename the property; Required, ↑ and ×; + Add question asks again', async page => {
  await showForm(page)
  await page.getByRole('button', { name: 'Edit Felt' }).click(); await wait(200)
  await page.getByLabel('Question').fill('How did it feel?'); await page.getByLabel('Description').fill('Be honest'); await page.getByLabel('Description').blur(); await wait(900)
  await page.getByRole('switch', { name: 'Required' }).check(); await wait(800)
  await page.getByRole('button', { name: 'Move up' }).click(); await wait(800)
  const felt = form().questions.find(q => q.propertyId === 'feel'), order = form().questions.map(q => q.propertyId), name = db().properties.find(p => p.id === 'feel').name
  await page.getByRole('button', { name: /^Remove/ }).click(); await wait(800)
  const removed = !form().questions.some(q => q.propertyId === 'feel')
  await page.getByRole('button', { name: '+ Add question' }).click(); await wait(200)
  const offered = await page.locator('.form-add-list [role=menuitem]').allTextContents()
  await page.getByRole('menuitem', { name: 'New property…' }).click(); await wait(150)
  await page.getByLabel('New question').fill('Where did you run?'); await page.getByRole('button', { name: 'Add', exact: true }).click(); await wait(1200)
  const made = db().properties.at(-1), asked = form().questions.at(-1)
  return { ok: felt.wording === 'How did it feel?' && felt.description === 'Be honest' && felt.required === true && name === 'Felt' && order.indexOf('feel') === 1 && removed && offered.join() === 'Felt,New property…' && made.name === 'Where did you run?' && asked.propertyId === made.id && asked.wording === 'Where did you run?', felt, order, name, removed, offered, made: made?.name, asked }
}, wide, '/pages?page=runs')

await scenario('Answering: a missing answer is marked and scrolled to, no asterisks; then one row with each type\'s value, the confirmation, and Send another', async page => {
  const stars = await page.locator('.form-page').evaluate(e => e.textContent.includes('*'))
  await page.getByRole('button', { name: 'Send' }).click(); await wait(400)
  const marked = await page.locator('.form-question.is-missing').count(), says = await page.locator('.form-missing').first().textContent()
  await page.getByLabel('Name').fill('Morning run'); await page.getByLabel('How far did you go?').fill('5.2')
  await page.getByText('Good', { exact: true }).click(); await page.getByText('Hills', { exact: true }).click(); await page.getByText('Rain', { exact: true }).click()
  await page.getByLabel('When').fill('2026-11-05'); await page.getByText('Stretched', { exact: true }).click(); await page.getByLabel('Note').fill('中文 note')
  await page.getByRole('button', { name: 'Send' }).click(); await wait(1500)
  const row = rows()[0], sent = await page.locator('.form-title').textContent()
  await page.getByRole('button', { name: 'Send another' }).click(); await wait(300)
  const fresh = await page.getByLabel('Name').inputValue()
  return { ok: !stars && marked === 1 && says === 'Needs an answer' && rows().length === 1 && row.title === 'Morning run' && row.values.km === 5.2 && row.values.feel === 'good' && row.values.tags.join() === 'hills,rain' && row.values.when.start === '2026-11-05' && row.values.ok === true && row.values.note === '中文 note' && form().responses === 1 && sent === 'Sent' && fresh === '', stars, marked, says, values: row?.values, sent, fresh }
})

await scenario('A send that fails keeps every answer; words typed meanwhile stay for the next send; Try again sends what it held, once', async (page, context) => {
  await page.getByLabel('Name').fill('Held'); await page.getByLabel('How far did you go?').fill('3')
  // The reply is lost after the server has taken it: the retry must find it done, not make a second row.
  let lose = true
  await page.route('**/*', async route => { if (lose && isPost(route.request())) { lose = false; await route.fetch().catch(() => {}); await route.abort(); return } await route.continue() })
  await page.getByRole('button', { name: 'Send' }).click(); await wait(1500)
  const notSent = await page.locator('.form-failed').textContent().catch(() => ''), afterFirst = rows().length
  // Seen, not only there: nothing covers its middle (Jazz).
  const seen = await page.locator('.form-failed').evaluate(e => { const r = e.getBoundingClientRect(); const at = document.elementFromPoint(r.x + r.width / 2, r.y + r.height / 2); return Boolean(at && e.contains(at)) })
  await page.getByLabel('Note').fill('typed while it failed')
  await page.getByRole('button', { name: 'Try again' }).click(); await wait(1500)
  const held = rows().filter(r => r.title === 'Held'), sent = await page.locator('.form-title').textContent()
  await page.getByRole('button', { name: 'Send another' }).click(); await wait(300)
  const kept = await page.getByLabel('Note').inputValue()
  void context
  return { ok: /Not sent · Try again/.test(notSent) && seen && afterFirst === 1 && held.length === 1 && held[0].values.note === undefined && sent === 'Sent' && kept === 'typed while it failed', notSent, seen, afterFirst, held: held.length, note: held[0]?.values?.note, kept }
})

await scenario('Offline: answers stay on the screen and through a reload, and go once it\'s back', async (page, context) => {
  await page.getByLabel('Name').fill('Offline run'); await page.getByLabel('How far did you go?').fill('7'); await wait(300)
  await context.setOffline(true)
  await page.getByRole('button', { name: 'Send' }).click(); await wait(2500)
  const notSent = await page.locator('.form-failed').textContent().catch(() => '')
  await context.setOffline(false)
  await page.reload(); await wait(2200)
  const kept = await page.getByLabel('Name').inputValue()
  await page.getByRole('button', { name: 'Send' }).click(); await wait(1500)
  return { ok: /Not sent/.test(notSent) && kept === 'Offline run' && rows().filter(r => r.title === 'Offline run').length === 1, notSent, kept, rows: rows().length }
})

await scenario('Preview sends nothing; Closed, an unknown form and a form in Trash read the same', async page => {
  await page.goto(`${base}/form?db=runs&view=f&preview=1`); await wait(2000)
  const mark = await page.locator('.form-preview-mark').textContent()
  await page.getByLabel('How far did you go?').fill('1'); await page.getByRole('button', { name: 'Send' }).click(); await wait(800)
  const none = rows().length
  const form0 = form()
  execSync(`node --no-warnings --input-type=module -e "import('${process.cwd()}/src/server/sqlite-repository.ts').then(async ({SqliteWorkspaceRepository:R})=>{const r=new R('${S}',undefined,{allowMissingLegacy:true});const w=await r.load();await r.execute({operationId:crypto.randomUUID(),expectedRevision:w.revision,action:{type:'change-database',pageId:'runs',change:{kind:'updateView',viewId:'f',form:{...JSON.parse(process.argv[1]),closed:true}}}})})" '${JSON.stringify(form0)}'`, { stdio: 'ignore' })
  const read = async path => { await page.goto(`${base}${path}`); await wait(1800); return page.locator('.form-page').textContent() }
  const closed = await read('/form?db=runs&view=f'), unknown = await read('/form?db=runs&view=nope'), nowhere = await read('/form?db=gone&view=f')
  return { ok: /nothing is sent/.test(mark) && none === 0 && closed === 'This form is closed' && unknown === closed && nowhere === closed, mark, none, closed, unknown, nowhere }
})

await scenario('390: one column, 16 px fields 44 px tall, a number keyboard, Send above the tab bar, Return goes to the next field, and an empty date reads as empty', async page => {
  const name = page.getByLabel('Name'), size = await name.evaluate(n => [getComputedStyle(n).fontSize, n.getBoundingClientRect().height])
  const km = await page.getByLabel('How far did you go?').getAttribute('inputmode')
  const send = await page.locator('.form-send').boundingBox(), bar = await page.locator('.tab-bar').boundingBox().catch(() => null)
  await name.tap(); await page.keyboard.type('Phone run'); await page.keyboard.press('Enter'); await wait(150)
  const next = await page.evaluate(() => document.activeElement?.getAttribute('aria-label'))
  const over = await page.evaluate(() => document.documentElement.scrollWidth > innerWidth)
  // An empty date reads as empty, not as today; a set one clears with × (Bumblebee).
  const when = page.locator('[data-question="when"]'), empty = await when.locator('.form-date-empty').textContent()
  await page.getByLabel('When').fill('2026-11-05'); await wait(150)
  const set = await when.locator('.form-date-empty').count()
  await page.getByRole('button', { name: 'Clear When' }).tap(); await wait(150)
  const cleared = await page.getByLabel('When').inputValue()
  return { ok: size[0] === '16px' && size[1] >= 44 && km === 'decimal' && (!bar || send.y + send.height <= bar.y) && next === 'How far did you go?' && !over && empty === 'Pick a date' && set === 0 && cleared === '', size, km, send, bar, next, over, empty, set, cleared }
}, phone)
await browser.close()
console.log(failed ? `${failed} failed` : 'all passed')
process.exit(failed ? 1 : 0)
