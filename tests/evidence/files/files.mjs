// R3-11: Files in the built app, read back from the store and the folder: add, open, remove, refused and failed uploads, Trash, a Gallery card, what opens in place, the sweep.
// Usage: node tests/evidence/files/files.mjs <base-url> <store-path> <files-folder> [chromium|webkit]  (throwaway store and folder the server at <base-url> uses)
import * as pw from '@playwright/test'
import { execSync } from 'node:child_process'
import { existsSync, mkdtempSync, readdirSync, rmSync, utimesSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
const [base, S, folder, engine = 'chromium'] = process.argv.slice(2)
if (!base || !S || !folder) { console.error('Usage: node tests/evidence/files/files.mjs <base-url> <store-path> <files-folder> [chromium|webkit]'); process.exit(2) }
const store = () => JSON.parse(execSync(`sqlite3 ${S} "select data from workspace"`, { maxBuffer: 1 << 26 }).toString())
const row = id => store().pages.find(p => p.id === id)
const held = id => row(id)?.values?.att ?? []
const inFolder = () => (existsSync(join(folder, 'local')) ? readdirSync(join(folder, 'local')).filter(n => !n.endsWith('.type')) : [])
const wait = ms => new Promise(r => setTimeout(r, ms))
const tmp = mkdtempSync(join(tmpdir(), 'rb-files-'))
const onePixel = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M/wHwAEBgIApD5fRAAAAABJRU5ErkJggg==', 'base64')
writeFileSync(join(tmp, 'photo.png'), onePixel)
writeFileSync(join(tmp, 'notes.txt'), 'some words')
writeFileSync(join(tmp, 'page.html'), '<script>document.title="ran"</script>')
writeFileSync(join(tmp, 'big.bin'), Buffer.alloc(26 * 1024 * 1024))
const browser = await pw[engine].launch({ headless: true })
const wide = { viewport: { width: 1280, height: 900 } }, phone = { viewport: { width: 390, height: 780 }, hasTouch: true }
let failed = 0
const scenario = async (name, act, options = wide) => {
  execSync(`rm -rf ${S} ${S}-wal ${S}-shm ${folder} && node --no-warnings tests/evidence/files/seed.ts ${S}`, { stdio: 'ignore' })
  const context = await browser.newContext({ ...options, serviceWorkers: 'block' }), page = await context.newPage(), errors = []
  page.on('pageerror', e => { if (!/ResizeObserver loop/.test(e.message)) errors.push(e.message) })
  let r
  try { r = await act(page, context) } catch (e) { r = { ok: false, threw: e.message.split('\n').slice(0, 3).join(' ') } }
  const ok = r.ok && !errors.length
  if (!ok) failed++
  console.log(ok ? 'PASS' : 'FAIL', name, JSON.stringify({ ...r, errors }))
  await context.close()
}
const open = async page => { await page.goto(`${base}/pages?page=shelf`); await page.locator('.database-row').first().waitFor(); await wait(1200) }
const cell = (page, id) => page.locator(`.database-row[data-row="${id}"] .database-td:not(.is-title)`).first()
const editor = page => page.locator('.property-files')
const choose = (page, ...names) => editor(page).locator('input[type=file]').setInputFiles(names.map(n => join(tmp, n)))
const lines = page => editor(page).locator('.property-file').allInnerTexts().then(t => t.map(x => x.replace(/\s+/g, ' ')))
const leave = async page => { await page.keyboard.press('Escape'); await wait(900) }

await scenario('Add two: each shows, they save on leaving, the bytes are stored, and Open reads them back', async (page, context) => {
  await open(page)
  await cell(page, 'one').click(); await wait(300)
  await choose(page, 'photo.png', 'notes.txt'); await wait(900)
  const r = { shown: await lines(page), beforeLeaving: held('one').length }
  await leave(page)
  r.value = held('one').map(f => [f.name, f.size, f.type]); r.chips = await cell(page, 'one').locator('.cell-file').allInnerTexts(); r.stored = inFolder().length
  const id = held('one').find(f => f.name === 'notes.txt').id
  const got = await context.request.get(`${base}/api/files/${id}?name=notes.txt`)
  r.back = await got.text(); r.disposition = got.headers()['content-disposition']
  r.ok = r.shown.length === 2 && r.value.length === 2 && r.value[0][1] === onePixel.length && r.value[1][2].startsWith('text/plain') && r.chips.join() === 'photo.png,notes.txt' && r.stored >= 2 && r.back === 'some words' && /attachment/.test(r.disposition)
  return r
})
await scenario('Remove saves on leaving and Undo brings it back; the object stays for that', async page => {
  await open(page)
  await cell(page, 'one').click(); await wait(300)
  await choose(page, 'notes.txt'); await wait(700); await leave(page)
  const r = { added: held('one').length, objects: inFolder().length }
  await cell(page, 'one').click(); await wait(300)
  await editor(page).getByRole('button', { name: 'Remove notes.txt' }).click(); await wait(150); await leave(page)
  r.removed = held('one').length; r.objectsAfter = inFolder().length
  await page.keyboard.press('Meta+z'); await wait(1200)
  r.undone = held('one').length
  r.ok = r.added === 1 && r.removed === 0 && r.objectsAfter === r.objects && r.undone === 1
  return r
})
await scenario('Over 25 MB is refused at once with the limit, nothing uploads, and the row stays usable', async page => {
  await open(page)
  let puts = 0
  page.on('request', q => { if (q.method() === 'PUT') puts++ })
  await cell(page, 'one').click(); await wait(300)
  await choose(page, 'big.bin'); await wait(500)
  const r = { shown: await lines(page), puts }
  await choose(page, 'notes.txt'); await wait(700); await leave(page)
  r.value = held('one').map(f => f.name)
  r.ok = /Too large · 25 MB at most/.test(r.shown[0]) && r.puts === 0 && r.value.join() === 'notes.txt'
  return r
})
await scenario('A failed upload says so and Retry works; a full account says that; the rest of the row is untouched', async page => {
  await open(page)
  let mode = 'fail'
  await page.route('**/api/files/*', async route => {
    if (route.request().method() !== 'PUT') return route.continue()
    if (mode === 'fail') return route.abort()
    if (mode === 'full') return route.fulfill({ status: 507, contentType: 'application/json', body: '{"error":"full"}' })
    return route.continue()
  })
  await cell(page, 'one').click(); await wait(300)
  await choose(page, 'notes.txt'); await wait(600)
  const r = { failed: await lines(page) }
  mode = 'ok'
  await editor(page).getByRole('button', { name: 'Retry' }).click(); await wait(800)
  r.retried = await lines(page)
  mode = 'full'
  await choose(page, 'photo.png'); await wait(600)
  r.full = await lines(page); r.retryOnFull = await editor(page).getByRole('button', { name: 'Retry' }).count()
  await leave(page)
  r.value = held('one').map(f => f.name)
  r.ok = /Couldn't upload/.test(r.failed[0]) && /KB|MB/.test(r.retried[0]) && /Storage full · 5 GB at most/.test(r.full[1]) && r.retryOnFull === 0 && r.value.join() === 'notes.txt'
  return r
})
await scenario('While one is on its way a click outside keeps it open; Esc gives up on it and keeps what\'s in', async page => {
  await open(page)
  await cell(page, 'one').click(); await wait(300)
  await choose(page, 'notes.txt'); await wait(700)
  let release
  await page.route('**/api/files/*', async route => { if (route.request().method() === 'PUT') await new Promise(r => { release = r }); await route.continue().catch(() => {}) })
  await choose(page, 'photo.png'); await wait(400)
  const r = { during: await lines(page) }
  await page.mouse.click(900, 700); await wait(300)
  r.stillOpen = await editor(page).count()
  await leave(page); release?.()
  r.closed = await editor(page).count(); r.value = held('one').map(f => f.name)
  r.ok = r.during.length === 2 && /%/.test(r.during[1]) && r.stillOpen === 1 && r.closed === 0 && r.value.join() === 'notes.txt'
  return r
})
const hideable = page => page.addInitScript(() => { window.__seen = 'visible'; Object.defineProperty(document, 'visibilityState', { get: () => window.__seen }); Object.defineProperty(document, 'hidden', { get: () => window.__seen === 'hidden' }) })
const setSeen = (page, seen) => page.evaluate(seen => { window.__seen = seen; document.dispatchEvent(new Event('visibilitychange')) }, seen)
await scenario('Out of sight during an upload: it carries on, the editor stays, what\'s finished is saved, and it joins on return', async page => {
  await hideable(page); await open(page)
  await cell(page, 'one').click(); await wait(300)
  await choose(page, 'notes.txt'); await wait(700)
  let release, seen, first = true
  const arrived = new Promise(r => { seen = r })
  await page.route('**/api/files/*', async route => { if (route.request().method() === 'PUT' && first) { first = false; seen(); await new Promise(r => { release = r }) } await route.continue().catch(() => {}) })
  await choose(page, 'photo.png'); await arrived; await wait(200)
  await setSeen(page, 'hidden'); await wait(900)
  const r = { open: await editor(page).count(), savedWhileHidden: held('one').map(f => f.name) }
  release(); await wait(900)
  await setSeen(page, 'visible'); await wait(300)
  r.back = await lines(page)
  await leave(page)
  r.value = held('one').map(f => f.name)
  r.ok = r.open === 1 && r.savedWhileHidden.join() === 'notes.txt' && r.back.length === 2 && !r.back.some(l => /%|Couldn/.test(l)) && r.value.join() === 'notes.txt,photo.png'
  return r
})
await scenario('If the browser drops the upload while it\'s out of sight, coming back says so and Retry works', async page => {
  await hideable(page); await open(page)
  let drop = true, release, seen
  const arrived = new Promise(r => { seen = r })
  await page.route('**/api/files/*', async route => { if (route.request().method() !== 'PUT' || !drop) return route.continue(); seen(); await new Promise(r => { release = r }); await route.abort() })
  await cell(page, 'one').click(); await wait(300)
  await choose(page, 'notes.txt'); await arrived; await wait(200)
  await setSeen(page, 'hidden'); await wait(300); release(); await wait(500)
  await setSeen(page, 'visible'); await wait(300)
  const r = { back: await lines(page) }
  drop = false
  await editor(page).getByRole('button', { name: 'Retry' }).click(); await wait(800)
  r.retried = await lines(page)
  await leave(page)
  r.value = held('one').map(f => f.name)
  r.ok = /Couldn't upload/.test(r.back[0]) && !/Couldn't/.test(r.retried[0]) && r.value.join() === 'notes.txt'
  return r
})
await scenario('A picker that hides the page doesn\'t close the editor: choosing after coming back still lands', async page => {
  await hideable(page); await open(page)
  await cell(page, 'one').click(); await wait(300)
  await setSeen(page, 'hidden'); await wait(500); await setSeen(page, 'visible'); await wait(300)
  const r = { open: await editor(page).count() }
  await choose(page, 'notes.txt'); await wait(700); await leave(page)
  r.value = held('one').map(f => f.name)
  r.ok = r.open === 1 && r.value.join() === 'notes.txt'
  return r
})
await scenario('A row in Trash keeps its file, and Undo has it back', async (page, context) => {
  await open(page)
  await cell(page, 'one').click(); await wait(300)
  await choose(page, 'notes.txt'); await wait(700); await leave(page)
  const id = held('one')[0].id
  await page.goto(`${base}/pages?page=one`); await page.locator('.page-more').first().waitFor(); await wait(800)
  await page.locator('.page-more').first().click(); await wait(200)
  await page.getByRole('menuitem', { name: /Delete/ }).first().click(); await wait(1200)
  const r = { trashed: Boolean(row('one').trashedAt), value: held('one').length, get: (await context.request.get(`${base}/api/files/${id}`)).status() }
  await page.getByRole('button', { name: 'Undo' }).last().click().catch(() => {}); await wait(1200)
  r.back = !row('one').trashedAt; r.valueBack = held('one').length
  r.ok = r.trashed && r.value === 1 && r.get === 200 && r.back && r.valueBack === 1
  return r
})
await scenario('Gallery: Card image shows the small copy; a file gone from the store leaves a clean card, and the row reads fine', async (page, context) => {
  await open(page)
  await cell(page, 'one').click(); await wait(300)
  await choose(page, 'photo.png'); await wait(1000); await leave(page)
  const value = held('one')[0]
  await page.getByRole('button', { name: /Table/ }).first().click().catch(() => {}); await wait(200)
  await page.getByText('Cards', { exact: true }).first().click(); await wait(500)
  await page.locator('.database-more-button').first().click(); await wait(250)
  await page.locator('.database-menu').getByRole('menuitem', { name: 'Layout' }).click(); await wait(250)
  await page.locator('.database-menu').getByLabel('Card image').selectOption('att'); await wait(900)
  await page.keyboard.press('Escape'); await wait(400)
  const image = page.locator('.database-gallery-image').first()
  const r = { thumb: Boolean(value.thumb), src: await image.getAttribute('src'), width: await image.evaluate(i => i.naturalWidth) }
  rmSync(join(folder, 'local', value.id), { force: true }); if (value.thumb) rmSync(join(folder, 'local', value.thumb), { force: true })
  r.gone = (await context.request.get(`${base}/api/files/${value.id}`)).status()
  await page.reload(); await wait(2400)
  r.imagesAfter = await page.locator('.database-gallery-image').count(); r.cards = await page.locator('.database-gallery-card, .database-card').count()
  r.ok = r.src?.startsWith('/api/files/') && r.width > 0 && r.gone === 404 && r.imagesAfter === 0
  return r
})
await scenario('An id that\'s taken is never overwritten: a retry of the same size is fine, different bytes are refused', async page => {
  await open(page)
  const put = (body, type = 'text/plain') => page.evaluate(async ([body, type]) => (await fetch('/api/files/takenFile0001', { method: 'PUT', headers: { 'content-type': type }, body })).status, [body, type])
  const r = { first: await put('first!'), retry: await put('other!'), differ: await put('much longer words') }
  r.still = await page.evaluate(async () => (await fetch('/api/files/takenFile0001')).text())
  r.ok = r.first === 201 && r.retry === 200 && r.differ === 409 && r.still === 'first!'
  return r
})
await scenario('What opens in place: an image does; a page never runs on this origin', async (page, context) => {
  await open(page)
  await cell(page, 'one').click(); await wait(300)
  await choose(page, 'photo.png', 'page.html'); await wait(1000); await leave(page)
  const [png, html] = held('one')
  const a = await context.request.get(`${base}/api/files/${png.id}`), b = await context.request.get(`${base}/api/files/${html.id}`)
  const r = { png: a.headers()['content-disposition'], html: b.headers()['content-disposition'], csp: b.headers()['content-security-policy'], sniff: b.headers()['x-content-type-options'] }
  r.ok = /^inline/.test(r.png) && /^attachment/.test(r.html) && /sandbox/.test(r.csp) && r.sniff === 'nosniff'
  return r
})
await scenario('The sweep: a report removes nothing and names what would go; only what nothing holds and is over 7 days old goes', async page => {
  await open(page)
  await cell(page, 'one').click(); await wait(300)
  await choose(page, 'notes.txt'); await wait(700); await leave(page)
  const kept = held('one')[0].id
  const put = (id, body) => page.evaluate(async ([id, body]) => (await fetch(`/api/files/${id}`, { method: 'PUT', headers: { 'content-type': 'text/plain' }, body })).status, [id, body])
  await put('orphanOld0001', 'old'); await put('orphanNew0002', 'new')
  const old = new Date(Date.now() - 8 * 86_400_000)
  utimesSync(join(folder, 'local', 'orphanOld0001'), old, old); utimesSync(join(folder, 'local', kept), old, old)
  const report = await page.evaluate(async () => (await (await fetch('/api/files/sweep?report=1', { method: 'POST' })).json()))
  const afterReport = inFolder()
  const removed = await page.evaluate(async () => (await (await fetch('/api/files/sweep', { method: 'POST' })).json()).removed)
  const left = inFolder()
  const r = { report: report.wouldRemove.map(f => f.key), keptByReport: afterReport.includes('orphanOld0001'), removed, left }
  r.ok = r.report.join() === 'local/orphanOld0001' && report.removed === 0 && r.keptByReport && removed === 1 && !left.includes('orphanOld0001') && left.includes('orphanNew0002') && left.includes(kept)
  return r
})
await scenario('390: in the sheet, it takes a tap, and nothing runs past the edge', async page => {
  await open(page)
  await cell(page, 'one').click(); await wait(400)
  await choose(page, 'notes.txt'); await wait(800)
  const r = { shown: await lines(page), add: await editor(page).locator('.property-file-add').evaluate(e => e.getBoundingClientRect().height), remove: await editor(page).getByRole('button', { name: 'Remove notes.txt' }).evaluate(e => e.getBoundingClientRect().height), overflow: await page.evaluate(() => document.documentElement.scrollWidth - innerWidth) }
  r.ok = r.shown.length === 1 && r.add >= 44 && r.remove >= 44 && r.overflow <= 0
  return r
}, phone)
await browser.close()
rmSync(tmp, { recursive: true, force: true })
console.log(failed ? `${failed} FAILED` : 'ALL PASS')
process.exit(failed ? 1 : 0)
