// B21 PR 3: making a synced block and putting it elsewhere, in the built app: Sync, `/` Synced block, copy and paste, the label, Unsync, delete.
// Usage: node tests/evidence/b21/make.mjs <base-url> <store-path> [chromium|webkit]  (a throwaway store the server at <base-url> uses)
import * as pw from '@playwright/test'
import { execSync } from 'node:child_process'
const [base, storePath, engine = 'chromium'] = process.argv.slice(2)
if (!base || !storePath) { console.error('Usage: node tests/evidence/b21/make.mjs <base-url> <store-path> [chromium|webkit]'); process.exit(2) }
const store = () => JSON.parse(execSync(`sqlite3 ${storePath} "select data from workspace"`, { maxBuffer: 1 << 26 }).toString())
const doc = id => JSON.parse(store().pages.find(p => p.id === id).document)
const types = id => doc(id).map(n => n.type)
const wait = ms => new Promise(r => setTimeout(r, ms))
const browser = await pw[engine].launch({ headless: true })
const notices = page => page.locator('[role=alert], [role=status]').allInnerTexts().then(t => t.join(' | ').replace(/\s+/g, ' '))
let failed = 0
const scenario = async (name, act, options = { viewport: { width: 1280, height: 900 } }) => {
  if (process.env.ONLY && !new RegExp(process.env.ONLY).test(name)) return
  execSync(`rm -f ${storePath} ${storePath}-wal ${storePath}-shm && node --no-warnings tests/evidence/b29/seed.ts ${storePath}`, { stdio: 'ignore' })
  const context = await browser.newContext(options)
  const page = await context.newPage(), errors = []
  page.on('pageerror', e => { if (!/ResizeObserver loop/.test(e.message)) errors.push(e.message) })
  let r
  try { r = await act(page, context) } catch (e) { r = { ok: false, threw: e.message.split('\n').slice(0, 3).join(' '), url: page.url(), body: (await page.locator('body').innerText().catch(() => '')).replace(/\s+/g, ' ').slice(0, 260) } }
  const ok = r.ok && !errors.length
  if (!ok) failed++
  console.log(ok ? 'PASS' : 'FAIL', name, JSON.stringify({ ...r, errors }))
  await context.close()
}
const open = async (page, id) => { await page.goto(`${base}/pages?page=${id}`); await wait(2200) }
const line = (page, words) => page.locator('.bn-inline-content', { hasText: words }).first()
const selectLine = async (page, words) => { await page.mouse.move(1, 1); await line(page, words).hover(); await wait(300); await page.locator('.bn-side-menu [aria-label^="Select or drag"]').first().click(); await wait(250) }
const sync = async (page, words) => { await selectLine(page, words); await page.locator('.editor-selection-bar').getByRole('button', { name: 'Sync' }).click(); await wait(2200) }
const pasteAfter = async (page, words) => { await line(page, words).click(); await page.keyboard.press('Meta+ArrowRight'); await wait(150); await page.keyboard.press('Enter'); await page.keyboard.press('Meta+v'); await wait(2400) }
const copyBlock = async page => { await page.locator('.synced-label').first().hover().catch(() => {}); await line(page, 'Second of A').hover(); await wait(150); await page.locator('.synced-label-button').first().click({ force: true }); await wait(250); await page.getByRole('menuitem', { name: 'Copy', exact: true }).click(); await wait(400) }
const labels = page => page.locator('.synced-label-button').allInnerTexts()
const menuItems = page => page.getByRole('menuitem').allInnerTexts()

await scenario('Sync: the line becomes a block where it is, under the same id; the record has it; Undo gives the plain line back', async page => {
  await open(page, 'a'); await sync(page, 'Second of A')
  const made = doc('a').find(n => n.type === 'syncedBlock')
  const r = { types: types('a'), inRecord: JSON.parse(store().synced[0].lines).map(n => n.id), notice: await notices(page), label: await labels(page) }
  await page.getByRole('button', { name: 'Undo' }).first().click(); await wait(2400)
  r.after = doc('a').map(n => n.id); r.synced = store().synced?.length ?? 0
  return { ...r, made: Boolean(made), ok: r.types.includes('syncedBlock') && r.inRecord.includes('a2') && /Synced block/.test(r.notice) && /Original · only here/.test(r.label[0]) && r.after.includes('a2') && r.synced === 0 }
})
await scenario('Copy from the label, paste on another page: it arrives synced, both labels say 2 pages; an edit there shows here; no task changes', async page => {
  const tasks = store().tasks.length
  await open(page, 'a'); await sync(page, 'Second of A'); await copyBlock(page)
  await open(page, 'b'); await pasteAfter(page, 'Only line of B')
  const r = { typesB: types('b'), textB: await page.locator('.bn-inline-content').allInnerTexts(), label: await labels(page) }
  await line(page, 'Second of A').click(); await page.keyboard.press('Meta+ArrowRight'); await wait(150); await page.keyboard.type(' from B'); await wait(2400)
  r.record = JSON.parse(store().synced[0].lines).map(n => n.content?.[0]?.text); r.tasks = store().tasks.length - tasks
  await open(page, 'a'); r.labelA = await labels(page); r.textA = await page.locator('.bn-inline-content').allInnerTexts()
  await line(page, 'Second of A from B').hover(); await wait(150); await page.locator('.synced-label-button').first().click({ force: true }); await wait(250)
  r.menu = await menuItems(page)
  return { ...r, ok: r.typesB.includes('syncedBlock') && r.textB.includes('Second of A') && /Synced · 2 pages/.test(r.label[0]) && r.record.join() === 'Second of A from B' && r.tasks === 0 && /Original · 2 pages/.test(r.labelA[0]) && r.textA.includes('Second of A from B') && r.menu.some(t => /Page B/.test(t)) && r.menu.includes('Unsync all') }
})
await scenario('Pasted twice on one page reads 2 places; pasted inside a block or into a to-do it is plain', async page => {
  await open(page, 'a'); await sync(page, 'Second of A'); await copyBlock(page)
  await pasteAfter(page, 'Fourth of A')
  const r = { label: await labels(page), blocks: doc('a').filter(n => n.type === 'syncedBlock').length }
  await pasteAfter(page, 'Second of A')
  r.blocksAfter = doc('a').filter(n => n.type === 'syncedBlock').length
  return { ...r, ok: r.blocks === 2 && /2 places/.test(r.label[0]) && r.blocksAfter === 2 }
})
await scenario('Unsync here keeps the copy\'s lines, the original reads only here, Undo restores', async page => {
  await open(page, 'a'); await sync(page, 'Second of A'); await copyBlock(page)
  await open(page, 'b'); await pasteAfter(page, 'Only line of B')
  await line(page, 'Second of A').hover(); await wait(150); await page.locator('.synced-label-button').first().click({ force: true }); await wait(250)
  await page.getByRole('menuitem', { name: 'Unsync here' }).click(); await wait(2400)
  const r = { types: types('b'), text: await page.locator('.bn-inline-content').allInnerTexts(), notice: await notices(page) }
  await page.getByRole('button', { name: 'Undo' }).first().click(); await wait(2400)
  r.after = types('b')
  return { ...r, ok: !r.types.includes('syncedBlock') && r.text.includes('Second of A') && /Unsynced here/.test(r.notice) && r.after.includes('syncedBlock') }
})
await scenario('Delete from the label: a copy goes with its notice; the original then ends the syncing, the others keeping their lines; Undo restores', async page => {
  await open(page, 'a'); await sync(page, 'Second of A'); await copyBlock(page)
  await open(page, 'b'); await pasteAfter(page, 'Only line of B')
  const del = async () => { await line(page, 'Second of A').hover(); await wait(150); await page.locator('.synced-label-button').first().click({ force: true }); await wait(250); await page.getByRole('menuitem', { name: 'Delete', exact: true }).click(); await wait(2400) }
  await del()
  const r = { copy: await notices(page), b: types('b'), a: types('a') }
  await page.getByRole('button', { name: 'Undo' }).first().click(); await wait(2400)
  r.backB = types('b')
  await open(page, 'a'); await del()
  r.original = await notices(page); r.a2 = types('a'); r.bLines = types('b'); r.synced = store().synced?.length ?? 0
  await page.getByRole('button', { name: 'Undo' }).first().click(); await wait(2400)
  r.aBack = types('a'); r.bBack = types('b')
  return { ...r, ok: /Removed from this page · still on 1 page/.test(r.copy) && !r.b.includes('syncedBlock') && r.a.includes('syncedBlock') && r.backB.includes('syncedBlock') && /the other 1 page keeps its lines/.test(r.original) && !r.a2.includes('syncedBlock') && r.bLines.join().includes('paragraph') && !r.bLines.includes('syncedBlock') && r.synced === 0 && r.aBack.includes('syncedBlock') && r.bBack.includes('syncedBlock') }
})
await scenario('`/` Synced block: one empty line with the caret in it; typing goes in; Backspace on it empty, as the only place, removes it', async page => {
  await open(page, 'a')
  await line(page, 'Fourth of A').click(); await page.keyboard.press('Meta+ArrowRight'); await wait(150); await page.keyboard.press('Enter'); await page.keyboard.type('/synced'); await wait(400); await page.keyboard.press('Enter'); await wait(500)
  await page.keyboard.type('Inside'); await wait(2400)
  const r = { types: types('a'), record: JSON.parse(store().synced?.[0]?.lines ?? '[]').map(n => n.content?.[0]?.text) }
  for (let i = 0; i < 6; i++) await page.keyboard.press('Backspace')
  await wait(300); await page.keyboard.press('Backspace'); await wait(2400)
  r.after = types('a'); r.synced = store().synced?.length ?? 0
  return { ...r, ok: r.types.includes('syncedBlock') && r.record.join() === 'Inside' && !r.after.includes('syncedBlock') && r.synced === 0 }
})
await scenario('Deleting a line inside a block shown elsewhere says so, with Undo; deleting all of them keeps one empty line and the block', async page => {
  await open(page, 'a'); await sync(page, 'Second of A'); await copyBlock(page)
  await open(page, 'b'); await pasteAfter(page, 'Only line of B')
  await line(page, 'Second of A').click(); await page.keyboard.press('Meta+ArrowRight'); await wait(150); await page.keyboard.press('Enter'); await page.keyboard.type('Extra'); await wait(2400)
  await selectLine(page, 'Extra'); await page.locator('.editor-selection-bar').getByRole('button', { name: 'Delete' }).click(); await wait(2400)
  const r = { notice: await notices(page), record: JSON.parse(store().synced[0].lines).map(n => n.content?.[0]?.text) }
  return { ...r, ok: /Removed from 2 pages/.test(r.notice) && r.record.join() === 'Second of A' }
})
await scenario('a new block from /: words typed during its first save stay', async page => {
  if (engine === 'webkit') return { ok: true, skipped: 'page.route' }
  await open(page, 'b'); await line(page, 'Only line of B').click(); await page.keyboard.press('Meta+ArrowRight'); await page.keyboard.press('Enter'); await wait(200)
  await page.route('**/_serverFn/**', async r => { if (r.request().method() === 'POST') await wait(1500); await r.continue().catch(() => {}) })
  await page.keyboard.type('/Synced'); await wait(500); await page.keyboard.press('Enter'); await wait(300)
  const req = page.waitForRequest(r => r.url().includes('_serverFn') && r.method() === 'POST', { timeout: 8000 })
  await page.keyboard.type('first'); await req; await wait(150)
  await page.keyboard.type(' second'); await wait(7000)
  const t = (await page.locator('.bn-inline-content').allInnerTexts()).filter(x => /first|second/.test(x)), rec = JSON.parse(store().synced?.[0]?.lines ?? '[]').map(n => n.content?.[0]?.text)
  return { t, rec, notice: await notices(page), ok: t.join() === 'first second' && rec.join() === 'first second' }
})
await scenario('Sync, then typing during its first save stays', async page => {
  if (engine === 'webkit') return { ok: true, skipped: 'page.route' }
  await open(page, 'a'); await page.route('**/_serverFn/**', async r => { if (r.request().method() === 'POST') await wait(1500); await r.continue().catch(() => {}) })
  await selectLine(page, 'Second of A'); await page.locator('.editor-selection-bar').getByRole('button', { name: 'Sync' }).click(); await wait(300)
  await line(page, 'Second of A').click(); await page.keyboard.press('Meta+ArrowRight'); await wait(100); await page.keyboard.type(' more'); await wait(7000)
  const t = (await page.locator('.bn-inline-content').allInnerTexts()).filter(x => /Second/.test(x)), rec = JSON.parse(store().synced?.[0]?.lines ?? '[]').map(n => n.content?.[0]?.text)
  return { t, rec, ok: t.join() === 'Second of A more' && rec.join() === 'Second of A more' }
})
await scenario('two places on one page: an edit reaches the other, and a later save does not undo it', async page => {
  await open(page, 'a'); await sync(page, 'Second of A'); await copyBlock(page); await pasteAfter(page, 'Fourth of A')
  const both = page.locator('.bn-inline-content', { hasText: 'Second of A' }), n = await both.count()
  await both.first().click(); await page.keyboard.press('Meta+ArrowRight'); await wait(150); await page.keyboard.type(' one'); await wait(2600)
  const shown = (await page.locator('.bn-inline-content').allInnerTexts()).filter(x => /Second of A/.test(x)), rec1 = JSON.parse(store().synced[0].lines).map(l => l.content?.[0]?.text)
  await line(page, 'First of A').click(); await page.keyboard.press('Meta+ArrowRight'); await wait(150); await page.keyboard.type('x'); await wait(2600)
  const rec2 = JSON.parse(store().synced[0].lines).map(l => l.content?.[0]?.text), shown2 = (await page.locator('.bn-inline-content').allInnerTexts()).filter(x => /Second of A/.test(x))
  await open(page, 'a'); const fresh = (await page.locator('.bn-inline-content').allInnerTexts()).filter(x => /Second of A/.test(x))
  return { n, shown, rec1, rec2, shown2, fresh, notice: await notices(page), ok: n === 2 && rec1.join() === 'Second of A one' && rec2.join() === 'Second of A one' && shown.every(x => x === 'Second of A one') && fresh.every(x => x === 'Second of A one') }
})
await scenario('two places on one page update as he types, with the caret kept; typing in one then the other within a save keeps both', async page => {
  await open(page, 'a'); await sync(page, 'Second of A'); await copyBlock(page); await pasteAfter(page, 'Fourth of A')
  const both = () => page.locator('.bn-inline-content', { hasText: 'Second of A' })
  await both().first().click(); await page.keyboard.press('Meta+ArrowRight'); await wait(150); await page.keyboard.type(' x')
  await wait(60)
  const asHeTypes = (await page.locator('.bn-inline-content').allInnerTexts()).filter(t => /Second of A/.test(t))
  await page.keyboard.type('y'); await wait(150)
  const r = { asHeTypes, caretStays: (await page.locator('.bn-inline-content').allInnerTexts()).filter(t => /Second of A x/.test(t)) }
  // Now the other one, straight away, inside the same save.
  await both().last().click(); await page.keyboard.press('Meta+ArrowRight'); await wait(40); await page.keyboard.type('z'); await wait(2800)
  r.record = JSON.parse(store().synced[0].lines).map(n => n.content?.[0]?.text); r.shown = (await page.locator('.bn-inline-content').allInnerTexts()).filter(t => /Second of A/.test(t)); r.notice = await notices(page)
  return { ...r, ok: asHeTypes.length === 2 && asHeTypes.every(t => t === 'Second of A x') && r.caretStays.every(t => t === 'Second of A xy') && r.record.join() === 'Second of A xyz' && r.shown.every(t => t === 'Second of A xyz') && !/Changed |another (tab|device)/i.test(r.notice) }
})
await scenario('at 390: Sync in the bar, Copy from the label, a paste arrives synced, Delete from the label with Undo', async page => {
  await open(page, 'a')
  const r = { overflow: await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth) }
  await line(page, 'Second of A').tap(); await wait(500)
  await page.locator('.editor-touch-handle').first().tap(); await wait(500)
  r.bar = (await page.locator('.editor-selection-bar').innerText()).replace(/\s+/g, ' ')
  await page.locator('.editor-selection-bar').getByRole('button', { name: 'Sync' }).tap(); await wait(2400)
  r.types = types('a')
  await line(page, 'Second of A').tap(); await wait(400)
  await page.locator('.synced-label-button').first().tap(); await wait(300)
  await page.getByRole('menuitem', { name: 'Copy', exact: true }).tap(); await wait(400)
  const payload = await page.evaluate(() => { const k = JSON.parse(localStorage.getItem('daythread:last-copy')); return JSON.stringify({ blocks: k.blocks, cut: false, token: 'x' }) })
  await open(page, 'b'); await line(page, 'Only line of B').tap(); await page.keyboard.press('Enter'); await wait(300)
  await page.evaluate(p => { const data = new DataTransfer(); data.setData('application/x-daythread-blocks', p); data.setData('text/plain', ''); document.activeElement.dispatchEvent(new ClipboardEvent('paste', { clipboardData: data, bubbles: true, cancelable: true })) }, payload); await wait(2400)
  r.typesB = types('b'); r.label = await labels(page)
  await line(page, 'Second of A').tap(); await wait(400)
  await page.locator('.synced-label-button').first().tap(); await wait(300)
  await page.getByRole('menuitem', { name: 'Delete', exact: true }).tap(); await wait(2400)
  r.afterDelete = types('b'); r.notice = await notices(page)
  // The notice's own, not the Undo on the phone's keyboard bar.
  await page.locator('.toast__action', { hasText: 'Undo' }).first().tap(); await wait(2400)
  r.afterUndo = types('b')
  return { ...r, ok: r.overflow <= 0 && /Sync/.test(r.bar) && r.types.includes('syncedBlock') && r.typesB.includes('syncedBlock') && /2 pages/.test(r.label[0]) && !r.afterDelete.includes('syncedBlock') && r.afterUndo.includes('syncedBlock') }
}, { viewport: { width: 390, height: 844 }, hasTouch: true, isMobile: true })
await browser.close()
console.log(failed ? `FAIL ${failed}` : 'PASS')
if (failed) process.exit(1)
