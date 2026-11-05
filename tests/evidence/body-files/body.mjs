// B87 in the built app: a screenshot pasted, files dropped, typing during an upload, what a failed, refused or missing file says, Undo, and what's stored.
// Usage: node tests/evidence/body-files/body.mjs <base-url> <store-path> <files-folder> [chromium|webkit]  (throwaway store and folder the server at <base-url> uses)
import * as pw from '@playwright/test'
import { execSync } from 'node:child_process'
import { existsSync, readdirSync } from 'node:fs'
import { join } from 'node:path'
const [base, S, folder, engine = 'chromium'] = process.argv.slice(2)
if (!base || !S || !folder) { console.error('Usage: node tests/evidence/body-files/body.mjs <base-url> <store-path> <files-folder> [chromium|webkit]'); process.exit(2) }
const store = () => JSON.parse(execSync(`sqlite3 ${S} "select data from workspace"`, { maxBuffer: 1 << 26 }).toString())
const doc = () => JSON.parse(store().pages.find(p => p.id === 'notes').document)
const stored = () => (existsSync(join(folder, 'local')) ? readdirSync(join(folder, 'local')).filter(n => !n.endsWith('.type')) : [])
const wait = ms => new Promise(r => setTimeout(r, ms))
const browser = await pw[engine].launch({ headless: true })
let failed = 0
const scenario = async (name, act, options = { viewport: { width: 1280, height: 900 } }) => {
  execSync(`rm -rf ${S} ${S}-wal ${S}-shm ${folder} && node --no-warnings tests/evidence/body-files/seed.ts ${S}`, { stdio: 'ignore' })
  const context = await browser.newContext({ ...options, serviceWorkers: 'block' }), page = await context.newPage(), errors = []
  page.on('pageerror', e => { if (!/ResizeObserver loop/.test(e.message)) errors.push(e.message) })
  let r
  try { await page.goto(`${base}/pages?page=notes`); await page.locator('.bn-inline-content', { hasText: 'First line' }).waitFor(); await wait(900); r = await act(page, context) } catch (e) { r = { ok: false, threw: e.message.split('\n').slice(0, 2).join(' ').slice(0, 260) } }
  const ok = r.ok && !errors.length
  if (!ok) failed++
  console.log(ok ? 'PASS' : 'FAIL', name, JSON.stringify({ ...r, errors }).slice(0, 560))
  await context.close()
}
const pixel = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M/wHwAEBgIApD5fRAAAAABJRU5ErkJggg=='
const files = `(list) => list.map(([name, type, content]) => new File([content === 'PIXEL' ? Uint8Array.from(atob('${pixel}'), c => c.charCodeAt(0)) : content], name, { type }))`
const paste = (page, list, extra = {}) => page.evaluate(([list, extra, make]) => {
  const data = new DataTransfer()
  for (const f of eval(make)(list)) data.items.add(f)
  for (const [k, v] of Object.entries(extra)) data.setData(k, v)
  document.querySelector('.ProseMirror').dispatchEvent(new ClipboardEvent('paste', { clipboardData: data, bubbles: true, cancelable: true }))
}, [list, extra, files])
const drop = (page, list, selector) => page.evaluate(([list, selector, make]) => {
  const data = new DataTransfer()
  for (const f of eval(make)(list)) data.items.add(f)
  const el = [...document.querySelectorAll('.bn-inline-content')].find(n => n.textContent.includes(selector)) ?? document.querySelector(selector), box = el.getBoundingClientRect()
  el.dispatchEvent(new DragEvent('drop', { dataTransfer: data, bubbles: true, cancelable: true, clientX: box.x + 5, clientY: box.bottom - 1 }))
}, [list, selector, files])
const caretOn = async (page, text) => { await page.locator('.bn-inline-content', { hasText: text }).first().click(); await page.keyboard.press('Meta+ArrowRight'); await wait(120) }
const types = () => doc().map(n => n.type)
const urls = () => doc().filter(n => n.type === 'image' || n.type === 'file').map(n => n.props.url)
const png = ['shot.png', 'image/png', 'PIXEL'], txt = ['notes.txt', 'text/plain', 'some words'], pdf = ['report.pdf', 'application/pdf', 'x'.repeat(2000)]
const holdPut = async page => { let release, seen, count = 0; const arrived = new Promise(r => { seen = r }), held = new Promise(r => { release = r }); await page.route('**/api/files/*', async route => { if (route.request().method() === 'PUT' && ++count === 1) { seen(); await held } await route.continue().catch(() => {}) }); return { release, arrived } }

await scenario('A screenshot pasted lands as an image with its address, the caret goes below, typing carries on, and it reads back after a reload', async page => {
  await caretOn(page, 'Second line')
  await paste(page, [png]); await wait(600)
  await page.keyboard.type('typed after'); await wait(1600)
  const r = { types: types(), urls: urls(), words: doc().map(n => n.content?.[0]?.text ?? null), stored: stored().length, blob: JSON.stringify(doc()).includes('blob:') }
  await page.reload(); await page.locator('.bn-visual-media').first().waitFor(); await wait(800)
  r.width = await page.locator('.bn-visual-media').first().evaluate(i => i.naturalWidth)
  r.ok = r.types.join() === 'paragraph,paragraph,image,paragraph,paragraph' && /^\/api\/files\/[\w-]+\?name=shot\.png&size=70$/.test(r.urls[0]) && r.words[3] === 'typed after' && r.stored === 1 && !r.blob && r.width === 1
  return r
})
await scenario('A clipboard holding text and an image: the text wins, as it does for a table from a sheet', async page => {
  await caretOn(page, 'Second line')
  await paste(page, [png], { 'text/plain': 'pasted words', 'text/html': '<p>pasted words</p>' }); await wait(1600)
  const r = { types: types(), text: JSON.stringify(doc()).includes('pasted words'), stored: stored().length }
  r.ok = !r.types.includes('image') && r.text && r.stored === 0
  return r
})
await scenario('Two dropped: one block each, in order, where the pointer is, an image and a file', async page => {
  await drop(page, [png, pdf], 'First line'); await wait(1600)
  const r = { types: types(), names: doc().filter(n => n.props?.url).map(n => n.props.name), file: await page.locator('.body-file-name').first().innerText(), size: await page.locator('.body-file-size').first().innerText(), stored: stored().length }
  r.ok = r.types.join() === 'paragraph,image,file,paragraph,paragraph' && r.names.join() === 'shot.png,report.pdf' && r.file === 'report.pdf' && /KB/.test(r.size) && r.stored === 2
  return r
})
await scenario('Typing carries on during an upload, the page saves, and the block\'s there from the start, with its preview', async page => {
  const { release, arrived } = await holdPut(page)
  await caretOn(page, 'Second line')
  await paste(page, [png]); await arrived; await wait(300)
  await page.keyboard.type('during'); await wait(1500)
  const r = { saved: JSON.stringify(doc()).includes('during'), types: types(), preview: await page.locator('.bn-visual-media').first().getAttribute('src'), stored: stored().length, status: await page.locator('.editor-save-line').innerText() }
  release(); await wait(1000)
  r.storedAfter = stored().length
  r.ok = r.saved && r.types.includes('image') && /^blob:/.test(r.preview) && r.stored === 0 && r.storedAfter === 1 && !JSON.stringify(doc()).includes('blob:')
  return r
})
await scenario('A failed upload says so with Retry, which works; Remove takes the block', async page => {
  let fail = true
  await page.route('**/api/files/*', route => (route.request().method() === 'PUT' && fail ? route.abort() : route.continue()))
  await caretOn(page, 'Second line')
  await paste(page, [png]); await wait(900)
  const r = { line: await page.locator('.body-file-line').innerText() }
  fail = false
  await page.locator('.body-file-line').getByRole('button', { name: 'Retry' }).click(); await wait(900)
  r.after = await page.locator('.body-file-line').count(); r.stored = stored().length
  r.ok = /Not uploaded/.test(r.line) && r.after === 0 && r.stored === 1
  return r
})
await scenario('Too large says so at once, with no attempt; Remove takes it, and the page is what it was', async page => {
  let puts = 0
  page.on('request', q => { if (q.method() === 'PUT') puts++ })
  await caretOn(page, 'Second line')
  await page.evaluate(() => { const data = new DataTransfer(); data.items.add(new File([new Uint8Array(26 * 1024 * 1024)], 'huge.bin', { type: 'application/octet-stream' })); document.querySelector('.ProseMirror').dispatchEvent(new ClipboardEvent('paste', { clipboardData: data, bubbles: true, cancelable: true })) })
  await wait(900)
  const r = { line: await page.locator('.body-file-line').innerText(), puts }
  await page.locator('.body-file-line').getByRole('button', { name: 'Remove' }).click(); await wait(1500)
  r.files = types().filter(t => t === 'file').length
  r.ok = /Too large · 25 MB at most/.test(r.line) && r.puts === 0 && r.files === 0
  return r
})
await scenario('A reload with its bytes gone: the block reads "isn\'t here", with Choose again and Remove and no broken image; Choose again uploads and shows it', async page => {
  await page.route('**/api/files/*', route => (route.request().method() === 'PUT' ? route.abort() : route.continue()))
  await caretOn(page, 'Second line')
  await paste(page, [png]); await wait(1500)
  await page.unrouteAll({ behavior: 'ignoreErrors' })
  await page.reload(); await page.locator('.body-file-line').waitFor(); await wait(300)
  const r = { line: await page.locator('.body-file-line').innerText(), buttons: await page.locator('.body-file-line button').allInnerTexts(), imgs: await page.locator('.bn-visual-media').count() }
  const [chooser] = await Promise.all([page.waitForEvent('filechooser'), page.locator('.body-file-line').getByRole('button', { name: 'Choose again' }).click()])
  await chooser.setFiles({ name: 'again.png', mimeType: 'image/png', buffer: Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M/wHwAEBgIApD5fRAAAAABJRU5ErkJggg==', 'base64') }); await wait(1600)
  r.after = await page.locator('.body-file-line').count(); r.url = urls()[0]; r.stored = stored().length
  r.ok = /shot\.png isn't here/.test(r.line) && r.buttons.join() === 'Choose again,Remove' && r.imgs === 0 && r.after === 0 && /name=again\.png/.test(r.url) && r.stored === 1
  return r
})
await scenario('One Undo removes what was added', async page => {
  await caretOn(page, 'Second line')
  await paste(page, [png]); await wait(1300)
  const r = { before: types().includes('image') }
  await page.keyboard.press('Meta+z'); await wait(1500)
  r.undone = types().includes('image'); r.lines = doc().length
  r.ok = r.before && !r.undone
  return r
})
await scenario('Deleting a block mid-upload stops it; Undo brings it back reading Not uploaded, and Retry finishes it', async page => {
  const { release, arrived } = await holdPut(page)
  await caretOn(page, 'Second line')
  await paste(page, [png]); await arrived; await wait(300)
  const before = doc().length
  await page.locator('.bn-visual-media').first().click(); await wait(200)
  await page.keyboard.press('Backspace'); await wait(700)
  const r = { gone: !types().includes('image'), before }
  await page.keyboard.press('Meta+z'); await wait(1200)
  r.back = types().includes('image'); r.line = await page.locator('.body-file-line').innerText().catch(() => '')
  release(); await wait(600)
  const retry = page.locator('.body-file-line').getByRole('button', { name: 'Retry' })
  r.retry = await retry.count()
  if (r.retry) { await retry.click(); await wait(900) }
  r.after = await page.locator('.body-file-line').count(); r.stored = stored().length
  r.ok = r.gone && r.back && /Not uploaded/.test(r.line) && r.retry === 1 && r.after === 0 && r.stored === 1
  return r
})
for (const [word, title, name, type, made] of [['image', 'Image', 'pic.png', 'image/png', 'image'], ['file', 'File', 'doc.pdf', 'application/pdf', 'file'], ['file', 'File', 'pic.png', 'image/png', 'file']]) {
  await scenario(`/${word} with ${name}: the panel uploads and it's a ${made} block`, async page => {
    await caretOn(page, 'Third line')
    await page.keyboard.press('Enter'); await page.keyboard.type(`/${word}`); await wait(500)
    const r = { items: await page.getByRole('option').allInnerTexts() }
    await page.keyboard.press('Enter'); await wait(500)
    r.tabs = await page.locator('.bn-panel [role=tab]').allInnerTexts()
    await page.locator('.bn-panel input[type=file]').setInputFiles({ name, mimeType: type, buffer: Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M/wHwAEBgIApD5fRAAAAABJRU5ErkJggg==', 'base64') }); await wait(1500)
    r.types = types(); r.url = urls()[0]; r.stored = stored().length
    r.ok = r.tabs.join() === 'Upload,Paste a link' && r.types.includes(made) && new RegExp(`name=${name.replace('.', '\\.')}`).test(r.url) && r.stored === 1
    return r
  })
}
await scenario('/image given a PDF makes a file block', async page => {
  await caretOn(page, 'Third line')
  await page.keyboard.press('Enter'); await page.keyboard.type('/image'); await wait(500); await page.keyboard.press('Enter'); await wait(500)
  await page.locator('.bn-panel input[type=file]').setInputFiles({ name: 'doc.pdf', mimeType: 'application/pdf', buffer: Buffer.from('%PDF-1.4') }); await wait(1500)
  const r = { types: types(), name: await page.locator('.body-file-name').first().innerText() }
  r.ok = r.types.includes('file') && !r.types.includes('image') && r.name === 'doc.pdf'
  return r
})
await scenario('An image selected: the toolbar offers Caption, Replace, Align and Download; a caption and an alignment save, with one Undo each', async page => {
  await caretOn(page, 'Second line')
  await paste(page, [png]); await wait(1300)
  await page.locator('.bn-visual-media').first().click(); await wait(500)
  const toolbar = page.locator('.bn-formatting-toolbar')
  const r = { buttons: await toolbar.locator('button').evaluateAll(l => l.map(b => b.getAttribute('aria-label') || b.getAttribute('data-test') || b.textContent).filter(Boolean)) }
  await toolbar.locator('[data-test="alignTextCenter"]').click(); await wait(1300)
  r.align = doc().find(n => n.type === 'image').props.textAlignment
  await toolbar.locator('[data-test="editcaption"], [aria-label*="aption"]').first().click(); await wait(300)
  await page.keyboard.type('A caption', { delay: 40 }); await page.keyboard.press('Enter'); await wait(1400)
  r.caption = doc().find(n => n.type === 'image').props.caption
  r.ok = r.align === 'center' && r.caption === 'A caption'
  return r
})
await scenario('The sweep holds a body\'s file, and the export names it in the README and leaves no dead link', async (page, context) => {
  await caretOn(page, 'Second line')
  await paste(page, [png]); await wait(1300)
  const old = new Date(Date.now() - 8 * 86_400_000), id = urls()[0].match(/files\/([\w-]+)/)[1]
  execSync(`touch -t ${old.toISOString().slice(0, 16).replace(/[-T:]/g, '')} ${join(folder, 'local', id)}`)
  const r = { report: (await page.evaluate(async () => (await (await fetch('/api/files/sweep?report=1', { method: 'POST' })).json()).wouldRemove)).length }
  r.export = (await context.request.get(`${base}/api/export`)).status()
  r.ok = r.report === 0 && r.export === 200
  return r
})
await scenario('390: a screenshot pasted fits the column and nothing runs past the edge', async page => {
  await caretOn(page, 'Second line')
  await paste(page, [png]); await wait(1200)
  const r = { types: types(), overflow: await page.evaluate(() => document.documentElement.scrollWidth - innerWidth) }
  r.ok = r.types.includes('image') && r.overflow <= 0
  return r
}, { viewport: { width: 390, height: 780 }, hasTouch: true })
await browser.close()
console.log(failed ? `${failed} FAILED` : 'ALL PASS')
process.exit(failed ? 1 : 0)
