// B29: a link to a line follows it when it's cut and pasted (A11 plan §3, §4), in the built app, with the browser's own cut and paste.
// Usage: node tests/evidence/b29/move.mjs <base-url> <store-path> [chromium|webkit]  (a throwaway store the server at <base-url> uses)
import * as pw from '@playwright/test'
import { execSync } from 'node:child_process'
const [base, storePath, engine = 'chromium'] = process.argv.slice(2)
if (!base || !storePath) { console.error('Usage: node tests/evidence/b29/move.mjs <base-url> <store-path> [chromium|webkit]'); process.exit(2) }
const store = () => JSON.parse(execSync(`sqlite3 ${storePath} "select data from workspace"`, { maxBuffer: 1 << 26 }).toString())
const doc = id => JSON.parse(store().pages.find(p => p.id === id).document)
const ids = id => doc(id).map(n => n.id)
const wait = ms => new Promise(r => setTimeout(r, ms))
const browser = await pw[engine].launch({ headless: true })
let failed = 0
const scenario = async (name, act) => {
  if (process.env.ONLY && !new RegExp(process.env.ONLY).test(name)) return
  execSync(`rm -f ${storePath} ${storePath}-wal ${storePath}-shm && node --no-warnings tests/evidence/b29/seed.ts ${storePath}`, { stdio: 'ignore' })
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
const go = async (page, title) => { await page.locator('nav, aside').getByText(title, { exact: true }).first().click(); await wait(1500) }
const line = (page, words) => page.locator('.bn-inline-content', { hasText: words }).first()
// A whole line: its handle selects it. (A text selection across lines leaves its first line behind, emptied, so that one stays.)
const selectWhole = async (page, words) => {
  await page.mouse.move(1, 1); await line(page, words).hover(); await wait(300)
  await page.locator('.bn-side-menu [aria-label^="Select or drag"]').first().click(); await wait(200)
}
const pasteAfter = async (page, words) => { await line(page, words).click(); await page.keyboard.press('Meta+ArrowRight'); await wait(150); await page.keyboard.press('Enter'); await page.keyboard.press('Meta+v'); await wait(2200) }

await scenario('whole lines cut and pasted on another page keep their ids, and the link follows', async page => {
  await open(page, 'a'); await selectWhole(page, 'Second of A')
  await page.keyboard.press('Meta+x'); await wait(1500)
  const left = ids('a')
  await go(page, 'Page B'); await pasteAfter(page, 'Only line of B')
  const r = { left, b: ids('b') }
  await go(page, 'Page C')
  r.chip = (await page.locator('.bn-inline-content', { hasText: 'See' }).first().innerText()).replace(/\s+/g, ' ')
  await page.locator('.bn-inline-content', { hasText: 'See' }).locator('a, [role=link], button').first().click(); await wait(2000)
  r.url = page.url(); r.shown = await line(page, 'Second of A').isVisible()
  return { ...r, ok: !left.includes('a2') && r.b.includes('a2') && /Second of A/.test(r.chip) && /page=b|Page%20B/.test(r.url + r.chip) && r.shown }
})
await scenario('moved within one page: same id, the link stays live', async page => {
  await open(page, 'a'); await selectWhole(page, 'Second of A')
  await page.keyboard.press('Meta+x'); await wait(800)
  await pasteAfter(page, 'Fourth of A')
  const r = { a: ids('a'), words: doc('a').map(n => n.content?.[0]?.text ?? '') }
  return { ...r, ok: r.a.includes('a2') && r.words.indexOf('Second of A') > r.words.indexOf('Fourth of A') }
})
await scenario('pasting a cut twice: the second is a copy with new ids', async page => {
  await open(page, 'a'); await selectWhole(page, 'Second of A')
  await page.keyboard.press('Meta+x'); await wait(1200)
  await pasteAfter(page, 'Fourth of A')
  await pasteAfter(page, 'Fourth of A')
  const d = doc('a'), r = { copies: d.filter(n => n.content?.[0]?.text === 'Second of A').map(n => n.id) }
  return { ...r, ok: r.copies.length === 2 && r.copies.includes('a2') && new Set(r.copies).size === 2 }
})
await scenario('a copy, not a cut, gets new ids: the link stays on the original', async page => {
  await open(page, 'a'); await selectWhole(page, 'Second of A')
  await page.keyboard.press('Meta+c'); await wait(300)
  await go(page, 'Page B'); await pasteAfter(page, 'Only line of B')
  const r = { a: ids('a'), b: ids('b') }
  return { ...r, ok: r.a.includes('a2') && !r.b.includes('a2') && r.b.length === 2 }
})
await scenario('lines partly cut stay where they are, and what lands is new', async page => {
  await open(page, 'a')
  await line(page, 'Second of A').click(); await page.keyboard.press('Meta+ArrowRight'); await page.keyboard.press('Shift+ArrowLeft'); await page.keyboard.press('Shift+ArrowLeft'); await page.keyboard.press('Shift+ArrowDown'); await wait(150)
  await page.keyboard.press('Meta+x'); await wait(1200)
  await go(page, 'Page B'); await pasteAfter(page, 'Only line of B')
  const r = { a: ids('a'), b: ids('b') }
  return { ...r, ok: r.a.includes('a2') && !r.b.includes('a2') }
})
await scenario('Undo at the source after a move: a new id there, the editor takes it, and no save refused', async (page, context) => {
  await open(page, 'a'); await selectWhole(page, 'Second of A')
  await page.keyboard.press('Meta+x'); await wait(1500)
  const other = await context.newPage()
  await other.goto(`${base}/pages?page=b`); await wait(2200)
  await pasteAfter(other, 'Only line of B')
  const b = ids('b')
  await other.close(); await page.bringToFront()
  await page.evaluate(() => { window.dispatchEvent(new Event('focus')) }); await wait(1500)
  await line(page, 'First of A').click(); await wait(100); await page.keyboard.press('Meta+z'); await wait(2500)
  const a = doc('a'), brought = a.find(n => n.content?.[0]?.text === 'Second of A')
  await line(page, 'First of A').click(); await page.keyboard.press('Meta+ArrowRight'); await wait(150); await page.keyboard.type(' typed after'); await wait(2500)
  const after = doc('a'), notice = await page.locator('[role=alert], [role=status]').allInnerTexts().then(t => t.join(' | '))
  const r = { b, brought: brought?.id ?? null, afterIds: after.map(n => n.id), typed: JSON.stringify(after).includes('typed after'), notice: notice.replace(/\s+/g, ' ') }
  return { ...r, ok: r.b.includes('a2') && r.typed && !/another|elsewhere/i.test(r.notice) && r.brought && r.brought !== 'a2' && !r.afterIds.includes('a2') }
})
await browser.close()
console.log(failed ? `FAIL ${failed}` : 'PASS')
if (failed) process.exit(1)
