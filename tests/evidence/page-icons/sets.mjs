// Our own icons, uploads and the small set of covers in the built app (icons-covers.md §5 step 3, P1-5).
// Usage: node tests/evidence/page-icons/sets.mjs <base-url> <store-path> <files-folder> [chromium|webkit]  (a throwaway store and folder the server at <base-url> uses)
import * as pw from '@playwright/test'
import { execSync } from 'node:child_process'
import { crc32, deflateSync } from 'node:zlib'
import { existsSync, readdirSync, statSync } from 'node:fs'
import { join } from 'node:path'
const [base, S, folder, engine = 'chromium'] = process.argv.slice(2)
if (!base || !S || !folder) { console.error('Usage: node tests/evidence/page-icons/sets.mjs <base-url> <store-path> <files-folder> [chromium|webkit]'); process.exit(2) }
const store = () => JSON.parse(execSync(`sqlite3 ${S} "select data from workspace"`, { maxBuffer: 1 << 26 }).toString())
const pageOf = id => store().pages.find(p => p.id === id)
const stored = () => (existsSync(join(folder, 'local')) ? readdirSync(join(folder, 'local')).filter(n => !n.endsWith('.type')).map(n => statSync(join(folder, 'local', n)).size) : [])
const wait = ms => new Promise(r => setTimeout(r, ms))
const pngOf = (w, h) => {
  const chunk = (type, data) => { const body = Buffer.concat([Buffer.from(type), data]), len = Buffer.alloc(4), crc = Buffer.alloc(4); len.writeUInt32BE(data.length); crc.writeUInt32BE(crc32(body)); return Buffer.concat([len, body, crc]) }
  const head = Buffer.alloc(13); head.writeUInt32BE(w, 0); head.writeUInt32BE(h, 4); head[8] = 8; head[9] = 2
  const row = Buffer.alloc(w * 3 + 1, 90); row[0] = 0
  return Buffer.concat([Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), chunk('IHDR', head), chunk('IDAT', deflateSync(Buffer.concat(Array.from({ length: h }, () => row)))), chunk('IEND', Buffer.alloc(0))])
}
const photo = { name: 'photo.png', mimeType: 'image/png', buffer: pngOf(3000, 2000) }
const browser = await pw[engine].launch({ headless: true })
let failed = 0
const scenario = async (name, act, options = { viewport: { width: 1280, height: 800 } }) => {
  if (process.env.ONLY && !name.includes(process.env.ONLY)) return
  execSync(`rm -rf ${S} ${S}-wal ${S}-shm ${folder} && node --no-warnings tests/evidence/page-icons/seed.ts ${S}`, { stdio: 'ignore' })
  const context = await browser.newContext({ ...options, serviceWorkers: 'block' }), page = await context.newPage(), errors = []
  page.on('pageerror', e => { if (!/ResizeObserver loop/.test(e.message)) errors.push(e.message) })
  let r
  try { await page.goto(`${base}/pages?page=notes`); await wait(1800); r = await act(page, context) } catch (e) { r = { ok: false, threw: e.message.split('\n').slice(0, 2).join(' ') } }
  const ok = r.ok && !errors.length
  if (!ok) failed++
  console.log(ok ? 'PASS' : 'FAIL', name, JSON.stringify({ ...r, errors }).slice(0, 560))
  await context.close()
}
const menu = async (page, name) => { await page.locator('.page-more').first().click(); await wait(200); await page.getByRole('menuitem', { name }).click(); await wait(300) }
const tab = (page, name) => page.locator('.icon-picker-tabs').getByRole('tab', { name }).click()
await scenario('Icons tab: search in English and Chinese, a pick draws in the page\'s grey in the head and the sidebar, and there\'s a notice with Undo', async page => {
  await menu(page, 'Add icon'); await tab(page, 'Icons'); await page.locator('.icon-picker-tabs + .icon-picker-scroll .icon-picker-cell').first().waitFor()
  const r = { all: await page.locator('.icon-picker-cell').count(), random: await page.locator('.icon-picker').getByRole('button', { name: 'Random' }).count() }
  await page.locator('.icon-picker-search').fill('树'); await wait(150); r.zh = await page.locator('.icon-picker-cell').count()
  await page.locator('.icon-picker-search').fill('leaf'); await wait(150); await page.locator('.icon-picker-cell').first().click(); await wait(1000)
  r.icon = pageOf('notes').icon; r.head = await page.locator('.page-icon .is-own-icon').count(); r.sidebar = await page.locator('.tree-title .is-own-icon').count()
  r.color = await page.locator('.tree-title .is-own-icon').evaluate(n => getComputedStyle(n).backgroundColor !== 'rgba(0, 0, 0, 0)')
  r.size = await page.locator('.tree-title .is-own-icon').evaluate(n => { const b = n.getBoundingClientRect(); return [Math.round(b.width), Math.round(b.height)] })
  await page.locator('.icon-picker-search').count()
  await page.getByRole('button', { name: 'Undo' }).first().click(); await wait(1000)
  r.undone = pageOf('notes').icon ?? null
  r.ok = r.all === 100 && r.random === 0 && r.zh >= 1 && r.icon === 'icon:leaf' && r.head === 1 && r.sidebar === 1 && r.color && r.size[0] >= 12 && r.undone === null
  return r
})
await scenario('Upload an icon: scaled down before it goes, held only once its bytes are in, drawn in the head and the sidebar, and read back after a reload', async page => {
  await menu(page, 'Add icon'); await tab(page, 'Upload')
  await page.locator('.icon-picker-choose input').setInputFiles(photo); await wait(1600)
  const icon = pageOf('notes').icon, r = { icon: /^\/api\/files\/.*name=photo\.png/.test(icon), sizes: stored(), head: await page.locator('.page-icon .is-uploaded-icon img').count(), sidebar: await page.locator('.tree-title .is-uploaded-icon img').count() }
  await page.reload(); await wait(1800)
  r.natural = await page.locator('.page-icon .is-uploaded-icon img').evaluate(i => [i.naturalWidth, i.naturalHeight])
  r.ok = r.icon && r.sizes.length === 1 && r.sizes[0] < 100_000 && r.head === 1 && r.sidebar === 1 && r.natural[0] === 256
  return r
})
await scenario('A failed upload holds nothing and says so, with Retry; a refused one says why, with none; SVG isn\'t taken', async page => {
  await menu(page, 'Add icon'); await tab(page, 'Upload')
  await page.route('**/api/files/*', route => route.request().method() === 'PUT' ? route.abort() : route.continue())
  await page.locator('.icon-picker-choose input').setInputFiles(photo); await wait(900)
  const note = () => page.locator('.icon-picker-note').innerText()
  const r = { failed: await note(), held: pageOf('notes').icon ?? null }
  await page.unroute('**/api/files/*'); await page.locator('.icon-picker-note').getByRole('button', { name: 'Retry' }).click(); await wait(1500)
  r.retried = /^\/api\/files\//.test(pageOf('notes').icon ?? '')
  await page.locator('.page-icon').click(); await wait(300); await tab(page, 'Upload')
  await page.route('**/api/files/*', route => route.request().method() === 'PUT' ? route.fulfill({ status: 507, json: { error: 'full' } }) : route.continue())
  await page.locator('.icon-picker-choose input').setInputFiles(photo); await wait(800)
  r.full = await note(); r.retryOnFull = await page.locator('.icon-picker-note').getByRole('button', { name: 'Retry' }).count()
  await page.locator('.icon-picker-choose input').setInputFiles({ name: 'x.svg', mimeType: 'image/svg+xml', buffer: Buffer.from('<svg xmlns="http://www.w3.org/2000/svg"/>') }); await wait(400)
  r.svg = await note()
  r.ok = /Not uploaded/.test(r.failed) && r.held === null && r.retried && /Storage full/.test(r.full) && r.retryOnFull === 0 && /needs to be a picture/.test(r.svg)
  return r
})
await scenario('The small set of covers: one tap, and it draws; uploading a cover scales it to what a band can use; the sweep holds both kinds', async page => {
  await menu(page, 'Add cover')
  const r = { set: await page.locator('.cover-panel-set button').count() }
  await page.locator('.cover-panel-set button[aria-label="ruled"]').click(); await wait(1000)
  r.cover = pageOf('notes').cover; r.loaded = await page.locator('.page-cover-image').evaluate(i => i.complete && i.naturalWidth > 0)
  await menu(page, 'Change cover')
  await page.locator('.cover-panel-choose input').setInputFiles({ name: 'big.png', mimeType: 'image/png', buffer: pngOf(3000, 2000) }); await wait(2000)
  r.uploaded = /^\/api\/files\//.test(pageOf('notes').cover ?? ''); r.natural = await page.locator('.page-cover-image').evaluate(i => i.naturalWidth)
  r.report = (await page.evaluate(async () => (await (await fetch('/api/files/sweep?report=1', { method: 'POST' })).json()).wouldRemove)).length
  r.ok = r.set === 8 && r.cover === '/covers/ruled.svg' && r.loaded && r.uploaded && r.natural === 2400 && r.report === 0
  return r
})
await scenario('While a picture is on its way: the panel names it, a click elsewhere keeps it going, Cancel stops it and sends nothing', async page => {
  let puts = 0
  await page.route('**/api/files/**', async route => { if (route.request().method() === 'PUT') { puts++; await wait(1500) } await route.continue().catch(() => {}) })
  await menu(page, 'Add cover'); await page.locator('.cover-panel input[type=file]').first().setInputFiles(photo); await wait(500)
  const r = { words: await page.locator('.cover-panel-note').first().innerText() }
  await page.mouse.click(300, 700); await wait(200)
  r.open = await page.locator('.cover-panel').count()
  await wait(2500)
  r.landed = Boolean(pageOf('notes').cover); r.closedAfter = await page.locator('.cover-panel').count()
  await menu(page, 'Change cover'); await page.locator('.cover-panel input[type=file]').first().setInputFiles(photo); await wait(500)
  const before = pageOf('notes').cover
  await page.locator('.cover-panel-note').getByRole('button', { name: 'Cancel' }).click(); await wait(2500)
  r.cancelled = pageOf('notes').cover === before; r.idle = await page.locator('.cover-panel-note').count(); r.stillOpen = await page.locator('.cover-panel').count()
  r.ok = /^Uploading .*photo\.png/.test(r.words) && r.open === 1 && r.landed && r.closedAfter === 0 && r.cancelled && r.idle === 0 && r.stillOpen === 1
  return r
})
await scenario('Upload has no search; our icon sits in the box an emoji has, so a row\'s words stay put', async page => {
  const words = () => page.evaluate(() => { const t = [...document.querySelectorAll('.tree-row .tree-title')].find(e => e.textContent.includes('Notes')), w = document.createTreeWalker(t, NodeFilter.SHOW_TEXT); w.nextNode(); const r = document.createRange(); r.selectNodeContents(w.currentNode); return Math.round(r.getBoundingClientRect().x) })
  const x = await words()
  await menu(page, 'Add icon'); await tab(page, 'Icons'); await page.locator('.icon-picker-tabs + .icon-picker-scroll .icon-picker-cell').first().click(); await wait(1000)
  const r = { x, after: await words() }
  await page.locator('.page-icon').click(); await wait(400); await tab(page, 'Upload'); await wait(200)
  r.search = await page.locator('.icon-picker-search').count()
  r.ok = r.x === r.after && r.search === 0
  return r
})
await browser.close()
console.log(failed ? `${failed} FAILED` : 'ALL PASS')
process.exit(failed ? 1 : 0)
