// B21 PR 2: the editor and a synced block: typing in one place reaches the others, a new line takes this place's id, the block's
// edges hold, another place's edit follows into an open tab, and both changing it keeps both.
// Usage: node tests/evidence/b21/editor.mjs <base-url> <store-path> [chromium|webkit]  (a throwaway store the server at <base-url> uses)
import * as pw from '@playwright/test'
import { execSync } from 'node:child_process'
const [base, storePath, engine = 'chromium'] = process.argv.slice(2)
if (!base || !storePath) { console.error('Usage: node tests/evidence/b21/editor.mjs <base-url> <store-path> [chromium|webkit]'); process.exit(2) }
const store = () => JSON.parse(execSync(`sqlite3 ${storePath} "select data from workspace"`, { maxBuffer: 1 << 26 }).toString())
const record = () => store().synced?.[0]
const recordText = () => JSON.parse(record().lines).map(n => n.content?.[0]?.text ?? '')
const docOf = id => JSON.parse(store().pages.find(p => p.id === id).document)
const wait = ms => new Promise(r => setTimeout(r, ms))
const browser = await pw[engine].launch({ headless: true })
const notices = page => page.locator('[role=alert], [role=status]').allInnerTexts().then(t => t.join(' | ').replace(/\s+/g, ' '))
let failed = 0
const scenario = async (name, act) => {
  if (process.env.ONLY && !new RegExp(process.env.ONLY).test(name)) return
  execSync(`rm -f ${storePath} ${storePath}-wal ${storePath}-shm && node --no-warnings tests/evidence/b21/seed.ts ${storePath}`, { stdio: 'ignore' })
  const context = await browser.newContext({ viewport: { width: 1280, height: 900 } })
  const page = await context.newPage(), errors = []
  page.on('pageerror', e => { if (!/ResizeObserver loop/.test(e.message)) errors.push(e.message) })
  let r
  try { r = await act(page, context) } catch (e) { r = { ok: false, threw: e.message.split('\n').slice(0, 3).join(' '), url: page.url() } }
  const ok = r.ok && !errors.length
  if (!ok) failed++
  console.log(ok ? 'PASS' : 'FAIL', name, JSON.stringify({ ...r, errors }))
  await context.close()
}
const open = async (page, id) => { await page.goto(`${base}/pages?page=${id}`); await wait(2200) }
const line = (page, words) => page.locator('.bn-inline-content', { hasText: words }).first()
const texts = page => page.locator('.bn-inline-content').allInnerTexts()
const end = async (page, words) => { await line(page, words).click(); await page.keyboard.press('Meta+ArrowRight'); await wait(150) }
const start = async (page, words) => { await line(page, words).click(); await page.keyboard.press('Meta+ArrowLeft'); await wait(150) }

await scenario('typing in a copy reaches the record and the original, with no false notice, and more typing keeps saving', async page => {
  await open(page, 'b'); await end(page, 'Shared one'); await page.keyboard.type(' typed'); await wait(2200)
  const first = { record: recordText(), rev: record().rev, notice: await notices(page) }
  await page.keyboard.type(' more'); await wait(2200)
  const second = { record: recordText(), rev: record().rev, notice: await notices(page) }
  await open(page, 'a')
  const onA = await texts(page)
  return { first, second, onA, ok: first.record[0] === 'Shared one typed' && second.record[0] === 'Shared one typed more' && /Saved/.test(second.notice) && !/another|elsewhere/i.test(first.notice + second.notice) && onA.includes('Shared one typed more') }
})
await scenario('a new line in a copy stays in the block, takes this place\'s id, and later saves are quiet', async page => {
  await open(page, 'b'); await end(page, 'Shared two'); await page.keyboard.press('Enter'); await page.keyboard.type('New in B'); await wait(2400)
  const ids = docOf('b').find(n => n.type === 'syncedBlock').children
  await page.keyboard.type(' again'); await wait(2400)
  const r = { record: recordText(), notice: await notices(page), rev: record().rev, stored: ids.length }
  await open(page, 'b')
  r.after = await texts(page)
  return { ...r, ok: r.record.join('|') === 'Shared one|Shared two|New in B again' && !/another|elsewhere/i.test(r.notice) && r.after.includes('New in B again') }
})
await scenario('the block\'s edges hold: Backspace and Delete at each edge move nothing', async page => {
  await open(page, 'b')
  const before = await texts(page)
  await start(page, 'Shared one'); await page.keyboard.press('Backspace'); await page.keyboard.press('Backspace'); await wait(300)
  const a = await texts(page)
  await start(page, 'Below on B'); await page.keyboard.press('Backspace'); await wait(200)
  const b = await texts(page)
  await end(page, 'Above on B'); await page.keyboard.press('Delete'); await wait(300)
  const c = await texts(page)
  await end(page, 'Shared two'); await page.keyboard.press('Delete'); await wait(300)
  const d = await texts(page)
  await wait(2000)
  const same = t => t.join('|') === before.join('|')
  const r = { a: same(a), b: same(b), c: same(c), d: same(d), record: recordText(), page: docOf('b').map(n => n.type) }
  return { ...r, b_lines: b, ok: r.a && r.b && r.c && r.d && r.record.join('|') === 'Shared one|Shared two' && r.page.join() === 'paragraph,syncedBlock,paragraph' }
})
await scenario('Tab and Shift-Tab at its edge move nothing; Enter on its empty last line leaves it', async page => {
  await open(page, 'b')
  await end(page, 'Below on B'); await page.keyboard.press('Tab'); await wait(300)
  await end(page, 'Shared one'); await page.keyboard.press('Shift+Tab'); await wait(1800)
  const held = { record: recordText(), page: docOf('b').map(n => n.type) }
  await end(page, 'Shared two'); await page.keyboard.press('Enter'); await page.keyboard.press('Enter'); await page.keyboard.type('Outside now'); await wait(2400)
  const r = { held, record: recordText(), types: docOf('b').map(n => n.type + ':' + (n.content?.[0]?.text ?? '')) }
  return { ...r, ok: held.record.join('|') === 'Shared one|Shared two' && held.page.join() === 'paragraph,syncedBlock,paragraph' && r.record.join('|') === 'Shared one|Shared two' && r.types.some(t => t.includes('Outside now')) }
})
await scenario('another place\'s edit follows into an open tab when it comes back, with the caret where it was', async (page, context) => {
  await open(page, 'b')
  await end(page, 'Above on B')
  const other = await context.newPage()
  await open(other, 'a'); await end(other, 'Shared one'); await other.keyboard.type(' from A'); await wait(2400)
  await other.close(); await page.bringToFront()
  await page.evaluate(() => { window.dispatchEvent(new Event('focus')) }); await wait(2500)
  const shown = await texts(page)
  await page.keyboard.type('!'); await wait(2400)
  const r = { shown, notice: await notices(page), above: docOf('b')[0].content?.[0]?.text, record: recordText() }
  return { ...r, ok: shown.includes('Shared one from A') && r.above === 'Above on B!' && r.record[0] === 'Shared one from A' && !/another|elsewhere/i.test(r.notice) }
})
await scenario('both changed it: the block has the latest, his version is right below, and nothing is lost', async (page, context) => {
  await open(page, 'b')
  // B goes offline, so its typing can't save until A's has landed.
  await context.setOffline(true); await end(page, 'Shared one'); await page.keyboard.type(' from B'); await wait(1200)
  const a = await context.browser().newContext({ viewport: { width: 1280, height: 900 } }); const pa = await a.newPage()
  await open(pa, 'a'); await end(pa, 'Shared two'); await pa.keyboard.type(' from A'); await wait(2400); await a.close()
  await context.setOffline(false)
  await page.bringToFront(); await page.evaluate(() => { window.dispatchEvent(new Event('online')); window.dispatchEvent(new Event('focus')) }); await wait(6000)
  const r = { record: recordText(), page: docOf('b').map(n => n.type + ':' + (n.content?.[0]?.text ?? '')), shown: await texts(page), notice: await notices(page) }
  return { ...r, ok: r.record.join('|') === 'Shared one|Shared two from A' && r.page.some(t => t.includes('Shared one from B')) && r.shown.includes('Shared one from B') && r.shown.includes('Shared two from A') }
})
await scenario('typed in a block, then the tab reloads: the kept draft saves, with the lines intact', async page => {
  await open(page, 'b'); await end(page, 'Shared two'); await page.keyboard.type(' kept'); await page.reload(); await wait(3500)
  const r = { record: recordText(), shown: await texts(page), notice: await notices(page) }
  return { ...r, ok: r.record[1] === 'Shared two kept' && r.shown.includes('Shared two kept') && !/another|elsewhere/i.test(r.notice) }
})
await scenario('Cmd-Z after typing in a block undoes it everywhere', async page => {
  await open(page, 'b'); await end(page, 'Shared one'); await page.keyboard.type('X'); await wait(2400)
  const typed = recordText()[0]
  await page.keyboard.press('Meta+z'); await wait(2400)
  const r = { typed, undone: recordText()[0], notice: await notices(page) }
  return { ...r, ok: typed === 'Shared oneX' && r.undone === 'Shared one' && !/another|elsewhere/i.test(r.notice) }
})
await browser.close()
console.log(failed ? `FAIL ${failed}` : 'PASS')
if (failed) process.exit(1)
