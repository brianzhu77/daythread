// B87 in the built app: a screenshot pasted, files dropped, typing during an upload, what a failed, refused or missing file says, Undo, and what's stored.
// Usage: node tests/evidence/body-files/body.mjs <base-url> <store-path> <files-folder> [chromium|webkit]  (throwaway store and folder the server at <base-url> uses)
import * as pw from '@playwright/test'
import { execSync } from 'node:child_process'
import { existsSync, readdirSync } from 'node:fs'
import { join } from 'node:path'
import { crc32, deflateSync } from 'node:zlib'
const [base, S, folder, engine = 'chromium'] = process.argv.slice(2)
if (!base || !S || !folder) { console.error('Usage: node tests/evidence/body-files/body.mjs <base-url> <store-path> <files-folder> [chromium|webkit]'); process.exit(2) }
const store = () => JSON.parse(execSync(`sqlite3 ${S} "select data from workspace"`, { maxBuffer: 1 << 26 }).toString())
const doc = () => JSON.parse(store().pages.find(p => p.id === 'notes').document)
const stored = () => (existsSync(join(folder, 'local')) ? readdirSync(join(folder, 'local')).filter(n => !n.endsWith('.type')) : [])
const wait = ms => new Promise(r => setTimeout(r, ms))
const browser = await pw[engine].launch({ headless: true })
let failed = 0
const scenario = async (name, act, options = { viewport: { width: 1280, height: 900 } }) => {
  if (process.env.ONLY && !name.includes(process.env.ONLY)) return
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
// A real picture wider than the column, for what depends on its size.
const pngOf = (w, h) => {
  const chunk = (type, data) => { const body = Buffer.concat([Buffer.from(type), data]), len = Buffer.alloc(4), crc = Buffer.alloc(4); len.writeUInt32BE(data.length); crc.writeUInt32BE(crc32(body)); return Buffer.concat([len, body, crc]) }
  const head = Buffer.alloc(13); head.writeUInt32BE(w, 0); head.writeUInt32BE(h, 4); head[8] = 8; head[9] = 2
  const rows = Buffer.alloc((w * 3 + 1) * h, 120); for (let y = 0; y < h; y++) rows[y * (w * 3 + 1)] = 0
  return Buffer.concat([Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), chunk('IHDR', head), chunk('IDAT', deflateSync(rows)), chunk('IEND', Buffer.alloc(0))]).toString('base64')
}
const wide = pngOf(1400, 700)
const files = `(list) => list.map(([name, type, content]) => new File([content === 'PIXEL' ? Uint8Array.from(atob('${pixel}'), c => c.charCodeAt(0)) : content === 'WIDE' ? Uint8Array.from(atob('${wide}'), c => c.charCodeAt(0)) : content], name, { type }))`
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
const big = ['big.png', 'image/png', 'WIDE'], png = ['shot.png', 'image/png', 'PIXEL'], txt = ['notes.txt', 'text/plain', 'some words'], pdf = ['report.pdf', 'application/pdf', 'x'.repeat(2000)]
const holdPut = async page => { let release, seen, count = 0; const arrived = new Promise(r => { seen = r }), held = new Promise(r => { release = r }); await page.route('**/api/files/*', async route => { if (route.request().method() === 'PUT' && ++count === 1) { seen(); await held } await route.continue().catch(() => {}) }); return { release, arrived } }

await scenario('A screenshot pasted lands as an image with its address, the caret goes below, typing carries on, and it reads back after a reload', async page => {
  await caretOn(page, 'Second line')
  await paste(page, [png]); await wait(600)
  await page.keyboard.type('typed after'); await wait(1600)
  const r = { types: types(), urls: urls(), words: doc().map(n => n.content?.[0]?.text ?? null), stored: stored().length, blob: JSON.stringify(doc()).includes('blob:') }
  await page.reload(); await page.locator('.bn-visual-media').first().waitFor(); await wait(800)
  r.width = await page.locator('.bn-visual-media').first().evaluate(i => i.naturalWidth)
  r.ok = r.types.join() === 'paragraph,paragraph,image,paragraph,paragraph' && /^\/api\/files\/[\w-]+\?name=shot\.png&size=70&type=image%2Fpng&w=1&h=1$/.test(r.urls[0]) && r.words[3] === 'typed after' && r.stored === 1 && !r.blob && r.width === 1
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
const imageBlock = () => doc().find(n => n.type === 'image')
const pasted = async (page, file = big) => { await caretOn(page, 'Second line'); await paste(page, [file]); await page.locator('.bn-visual-media:not(.body-image-loading)').first().waitFor(); await wait(1300) }
const undo = async page => { await page.keyboard.press('Meta+z'); await wait(1400) }
const toolbarLabels = page => page.locator('.bn-formatting-toolbar button').evaluateAll(l => l.map(b => b.getAttribute('aria-label') || b.getAttribute('data-test') || b.textContent).filter(Boolean))
await scenario('Resize by an edge saves when released with one Undo; the smallest holds at 120; Align shows only once it\'s narrower than the column', async page => {
  await pasted(page)
  const image = page.locator('.bn-visual-media').first()
  await image.click(); await wait(500)
  const r = { fullBar: await toolbarLabels(page) }, box = await image.boundingBox()
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2); await wait(200)
  const handle = page.locator('.bn-resize-handle').last(), h = await handle.boundingBox()
  await page.mouse.move(h.x + h.width / 2, h.y + h.height / 2); await page.mouse.down(); await page.mouse.move(h.x - 200, h.y + 10, { steps: 6 }); await page.mouse.up(); await wait(1400)
  r.width = imageBlock().props.previewWidth; r.drawn = (await image.boundingBox()).width
  await image.click(); await wait(500)
  r.narrowBar = await toolbarLabels(page)
  await page.locator('.bn-formatting-toolbar [data-test="alignTextRight"]').click(); await wait(1300)
  const column = await page.locator('.bn-inline-content', { hasText: 'First line' }).evaluate(n => n.closest('.bn-block-content').getBoundingClientRect().right), drawnBox = await image.boundingBox()
  r.rightGap = Math.round(column - (drawnBox.x + drawnBox.width))
  await page.screenshot({ path: '/tmp/rb-csv/body-right.png' })
  await page.keyboard.press('Meta+z'); await wait(1400)
  await page.mouse.click(5, 5); await page.locator('.bn-inline-content', { hasText: 'First line' }).click(); await wait(200)
  await page.keyboard.press('Meta+z'); await wait(1400)
  r.undone = imageBlock().props.previewWidth
  const big2 = await image.boundingBox(); await page.mouse.move(big2.x + big2.width / 2, big2.y + big2.height / 2); await wait(200)
  const h2 = await page.locator('.bn-resize-handle').last().boundingBox()
  await page.mouse.move(h2.x + h2.width / 2, h2.y + h2.height / 2); await page.mouse.down(); await page.mouse.move(big2.x - 400, h2.y, { steps: 8 }); await page.mouse.up(); await wait(1200)
  r.smallest = (await image.boundingBox()).width
  const align = list => list.filter(l => /lign/i.test(l)).length
  r.ok = r.width < box.width - 150 && Math.abs(r.drawn - r.width) < 3 && !align(r.fullBar) && align(r.narrowBar) === 3 && Math.abs(r.rightGap) < 3 && r.undone !== r.width && r.smallest >= 119
  return r
})
await scenario('A line of text gets no alignment or file buttons in its bar', async page => {
  await page.locator('.bn-inline-content', { hasText: 'First line' }).click({ clickCount: 3 }); await wait(500)
  const r = { bar: await toolbarLabels(page) }
  r.ok = r.bar.length > 0 && !r.bar.some(l => /lign|ownload|new tab|aption|eplace/i.test(l))
  return r
})
await scenario('Replace keeps the block, its width and its caption, and one Undo brings the old file back', async page => {
  await pasted(page)
  const before = imageBlock(), image = page.locator('.bn-visual-media').first()
  await page.evaluate(() => {})
  await image.click(); await wait(500)
  await page.locator('.bn-formatting-toolbar [data-test="editcaption"], .bn-formatting-toolbar [aria-label*="aption"]').first().click(); await wait(300)
  await page.keyboard.type('Kept', { delay: 40 }); await page.keyboard.press('Enter'); await wait(1400)
  await image.click(); await wait(500)
  await page.locator('.bn-formatting-toolbar [data-test="replaceFile"], .bn-formatting-toolbar [aria-label*="eplace"]').first().click(); await wait(400)
  await page.locator('.bn-panel input[type=file], .bn-popover-content input[type=file], input[type=file]').first().setInputFiles({ name: 'other.png', mimeType: 'image/png', buffer: Buffer.from(pixel, 'base64') }); await wait(1800)
  const after = imageBlock(), r = { sameBlock: after.id === before.id, caption: after.props.caption, name: after.props.name, changed: after.props.url !== before.props.url }
  await page.keyboard.press('Meta+z'); await wait(1400)
  r.back = imageBlock().props.url === before.props.url
  r.ok = r.sameBlock && r.caption === 'Kept' && r.name === 'other.png' && r.changed && r.back
  return r
})
await scenario('↗ and Download show only once the upload\'s done; Download saves it under its name, and ↗ opens the original', async (page, context) => {
  const hold = await holdPut(page)
  await caretOn(page, 'Second line'); await paste(page, [big]); await hold.arrived
  await page.locator('.bn-visual-media').first().click(); await wait(500)
  const r = { during: await toolbarLabels(page) }
  await page.screenshot({ path: '/tmp/rb-csv/body-uploading.png' })
  await hold.release(); await wait(1500)
  await page.locator('.bn-visual-media').first().click(); await wait(500)
  r.after = await toolbarLabels(page)
  const [download] = await Promise.all([page.waitForEvent('download'), page.locator('.bn-formatting-toolbar button[aria-label="Download"]').click()])
  r.saved = download.suggestedFilename()
  await page.locator('.bn-visual-media').first().click(); await wait(500)
  const [tab] = await Promise.all([context.waitForEvent('page'), page.locator('.bn-formatting-toolbar button[aria-label="Open in a new tab"]').click()])
  await wait(500); r.opened = tab.url().includes('/api/files/'); await tab.close()
  r.ok = !r.during.some(l => /ownload|new tab/i.test(l)) && r.after.includes('Download') && r.saved === 'big.png' && r.opened
  return r
})
await scenario('A file reads as a row: ↗ for what opens in place, ↓ for what downloads', async page => {
  await caretOn(page, 'Second line'); await paste(page, [pdf]); await wait(800); await paste(page, [txt]); await wait(1400)
  await page.screenshot({ path: '/tmp/rb-csv/body-files.png' })
  const row = name => page.locator('.body-file', { hasText: name }).locator('.body-file-go')
  const r = { pdfOpens: await row('report.pdf').getAttribute('target'), pdfSaves: await row('report.pdf').getAttribute('download'), txtOpens: await row('notes.txt').getAttribute('target'), txtSaves: await row('notes.txt').getAttribute('download') }
  r.ok = r.pdfOpens === '_blank' && r.pdfSaves === null && r.txtOpens === null && r.txtSaves === 'notes.txt'
  return r
})
await scenario('Offline: the block says so, then retries by itself on coming back', async (page, context) => {
  await caretOn(page, 'Second line')
  await context.setOffline(true)
  await paste(page, [png]); await wait(900)
  const r = { says: await page.locator('.body-file-line').first().innerText(), stored: stored().length }
  await context.setOffline(false); await wait(2000)
  r.after = await page.locator('.body-file-line').count(); r.storedAfter = stored().length
  r.ok = /Offline/.test(r.says) && /back/.test(r.says) && r.stored === 0 && r.after === 0 && r.storedAfter === 1
  return r
})
await scenario('A full account says so, with Remove', async page => {
  await page.route('**/api/files/*', route => route.request().method() === 'PUT' ? route.fulfill({ status: 507, contentType: 'application/json', body: '{"error":"full"}' }) : route.continue())
  await caretOn(page, 'Second line'); await paste(page, [png]); await wait(900)
  const r = { says: await page.locator('.body-file-line').first().innerText() }
  await page.locator('.body-file-line button', { hasText: 'Remove' }).click(); await wait(1200)
  r.left = urls().length
  r.ok = /Storage full · 5 GB at most/.test(r.says) && !/Retry/.test(r.says) && r.left === 0
  return r
})
for (const [label, viewport, w, h] of [['1280, a picture narrower than the column', { width: 1280, height: 900 }, 500, 800], ['390, a portrait photo', { width: 390, height: 780 }, 1200, 1600]]) await scenario(`Loading at ${label}: the box is the picture's shape and size, so the words don't move when it arrives`, async page => {
  await caretOn(page, 'Second line')
  // The real size matters here, so it's drawn at full size from a canvas in the page.
  await page.evaluate(async ([w, h]) => {
    const c = document.createElement('canvas'); c.width = w; c.height = h; c.getContext('2d').fillRect(0, 0, w, h)
    const blob = await new Promise(r => c.toBlob(r, 'image/png')), data = new DataTransfer()
    data.items.add(new File([blob], 'tall.png', { type: 'image/png' }))
    document.querySelector('.ProseMirror').dispatchEvent(new ClipboardEvent('paste', { clipboardData: data, bubbles: true, cancelable: true }))
  }, [w, h]); await wait(2200)
  const r = { url: imageBlock().props.url.split('&').slice(-2).join('&') }
  let release; const held = new Promise(res => { release = res })
  await page.route('**/api/files/*', async route => { if (route.request().method() === 'GET') await held; await route.continue().catch(() => {}) })
  await page.reload(); await page.locator('.bn-inline-content', { hasText: 'First line' }).waitFor(); await wait(700)
  const third = () => page.locator('.bn-inline-content', { hasText: 'Third line' }).boundingBox(), box = await page.locator('.body-image-loading').first().boundingBox()
  r.box = [Math.round(box.width), Math.round(box.height)]; const before = (await third()).y
  release(); await page.locator('.bn-visual-media:not(.body-image-loading)').first().waitFor(); await wait(400)
  const drawn = await page.locator('.bn-visual-media').first().boundingBox()
  r.drawn = [Math.round(drawn.width), Math.round(drawn.height)]; r.moved = Math.round((await third()).y - before)
  r.ok = r.url === `w=${w}&h=${h}` && Math.abs(r.moved) <= 1 && Math.abs(r.box[0] - r.drawn[0]) <= 1 && Math.abs(r.box[1] - r.drawn[1]) <= 1 && (viewport.width === 1280 ? r.drawn[0] === w : r.drawn[0] < 390)
  return r
}, { viewport, ...(viewport.width === 390 ? { hasTouch: true } : {}) })
await scenario('Opening a page holding a sized picture writes nothing', async page => {
  await pasted(page)
  const rev = () => store().revision, sized = /&w=1400&h=700$/.test(imageBlock().props.url), before = rev()
  await page.reload(); await page.locator('.bn-inline-content', { hasText: 'First line' }).waitFor(); await wait(1800)
  const r = { sized, wrote: rev() - before }
  r.ok = r.sized && r.wrote === 0
  return r
})
await scenario('One Undo removes a pasted picture even after its size joined the address', async page => {
  await pasted(page)
  const r = { sized: /&w=1400&h=700$/.test(imageBlock().props.url) }
  await page.locator('.bn-inline-content', { hasText: 'First line' }).click(); await undo(page)
  r.image = types().includes('image')
  r.ok = r.sized && !r.image
  return r
})
await scenario('A link to an image that fails says so, with its address and no broken mark', async page => {
  await caretOn(page, 'Second line')
  await page.keyboard.press('Enter'); await page.keyboard.type('/image', { delay: 30 }); await wait(400); await page.keyboard.press('Enter'); await wait(500)
  await page.getByRole('tab', { name: 'Paste a link' }).click(); await wait(200)
  await page.locator('input[data-test="embed-input"], .bn-panel input[type=text], .bn-panel input:not([type=file])').first().fill('http://127.0.0.1:9/gone.png')
  await page.keyboard.press('Enter'); await wait(1500)
  const r = { says: await page.locator('.body-file-line').first().innerText(), imgs: await page.locator('.bn-visual-media').count() }
  r.ok = /Can't load this image/.test(r.says) && /gone\.png/.test(r.says) && r.imgs === 0
  return r
})
await scenario('A format the browser can\'t draw: Can\'t show this image here, with Download; and the same after a reload', async page => {
  await caretOn(page, 'Second line'); await paste(page, [['phone.heic', 'image/heic', 'not a picture this browser draws']]); await wait(1800)
  const r = { says: await page.locator('.body-file-line').first().innerText({ timeout: 8000 }) }
  await page.reload(); await page.locator('.bn-inline-content', { hasText: 'First line' }).waitFor(); await wait(1500)
  r.state = await page.locator('[data-content-type=image]').first().evaluate(n => n.innerHTML.slice(0, 300))
  r.again = await page.locator('.body-file-line').first().innerText({ timeout: 8000 }).catch(e => 'none')
  r.ok = /Can't show this image here/.test(r.says) && /Download/.test(r.says) && /Can't show this image here/.test(r.again)
  return r
})
await scenario('A file that turns up later shows when the page regains focus', async page => {
  await pasted(page)
  const id = urls()[0].match(/files\/([\w-]+)/)[1], at = join(folder, 'local', id)
  execSync(`mv ${at} ${at}.away`)
  await page.reload(); await page.locator('.bn-inline-content', { hasText: 'First line' }).waitFor(); await wait(1500)
  const r = { gone: await page.locator('.body-file-line').first().innerText({ timeout: 8000 }) }
  execSync(`mv ${at}.away ${at}`)
  await page.evaluate(() => window.dispatchEvent(new Event('focus'))); await wait(1500)
  r.lines = await page.locator('.body-file-line').count(); r.width = await page.locator('.bn-visual-media').first().evaluate(i => i.naturalWidth)
  r.ok = /isn't here/.test(r.gone) && r.lines === 0 && r.width === 1400
  return r
})
const dayOf = back => new Intl.DateTimeFormat('en-CA').format(new Date(Date.now() - back * 86_400_000))
const dayDoc = date => JSON.parse(store().pages.find(p => p.date === date && p.type === 'daily').document)
const rows = list => list.map(n => [n.id, n.type, n.content?.map?.(c => c.text ?? '').join('') ?? null])
for (const [label, back] of [['today', 0], ['a past day', 3]]) await scenario(`On ${label}: a screenshot lands in the section and typing carries on; after a reload its lines and carry-over are as they were`, async page => {
  const date = dayOf(back)
  await page.goto(`${base}/day/${date}`); await page.locator('.bn-editor').first().waitFor(); await wait(2200)
  const before = rows(dayDoc(date)), tray = () => page.getByText('1 more open').count(), trayBefore = await tray()
  // On today, the empty bullet at the end of Notes. On a past day, after a written line.
  if (back) { await page.locator('.bn-inline-content', { hasText: 'And after it' }).first().click(); await page.keyboard.press('Meta+ArrowRight') }
  else await page.locator('[data-content-type=bulletListItem] .bn-inline-content').last().click()
  await wait(150)
  const at = await page.evaluate(() => getSelection().anchorNode?.parentElement?.closest('[data-node-type=blockContainer]')?.getAttribute('data-id'))
  await paste(page, [png]); await wait(700)
  await page.keyboard.type('After the picture', { delay: 15 }); await wait(1800)
  await page.reload(); await page.locator('.bn-editor').first().waitFor(); await wait(2000)
  const after = rows(dayDoc(date)), added = after.filter(r => !before.some(b => b[0] === r[0]))
  const r = { added: added.map(a => [a[1], a[2]]), images: await page.locator('.bn-visual-media:not(.body-image-loading)').count(), written: (await page.evaluate(() => document.querySelector('.bn-editor').innerText)).includes('After the picture'), tray: [trayBefore, await tray()] }
  // Every line that was there still is, in order, apart from the empty one the picture used up.
  r.sameLines = JSON.stringify(after.filter(a => before.some(b => b[0] === a[0]))) === JSON.stringify(before.filter(b => b[0] !== (back ? null : at)))
  const headings = list => list.filter(l => l[1] === 'heading').map(l => l[2])
  r.sections = JSON.stringify(headings(after)) === JSON.stringify(headings(before))
  const image = after.findIndex(a => a[1] === 'image')
  r.below = after[image + 1]
  r.ok = r.added.some(a => a[0] === 'image') && r.images === 1 && r.written && r.sameLines && r.sections && r.below?.[2] === 'After the picture' && r.tray[0] === r.tray[1] && (back ? r.below[1] === 'paragraph' : r.below[1] === 'bulletListItem' && after[image - 1]?.[2] === 'Notes')
  return r
})
await scenario('A /image left empty: Remove takes it, with its panel open', async page => {
  await caretOn(page, 'Third line')
  await page.keyboard.press('Enter'); await page.keyboard.type('/image'); await wait(500); await page.keyboard.press('Enter'); await wait(500)
  const r = { panel: await page.locator('.bn-panel').count(), held: types().includes('image') }
  await page.locator('.body-file-empty button', { hasText: 'Remove' }).click(); await wait(1400)
  r.after = types().includes('image'); r.panelAfter = await page.locator('.bn-panel').count()
  r.ok = r.panel === 1 && !r.after && r.panelAfter === 0
  return r
})
await scenario('A file block asks for its file without fetching it, and an image asks only once its picture fails', async page => {
  await caretOn(page, 'Second line'); await paste(page, [pdf]); await wait(500); await paste(page, [big]); await wait(1500)
  const seen = []; page.on('request', q => { if (q.url().includes('/api/files/')) seen.push([q.method(), q.resourceType()]) })
  await page.reload(); await page.locator('.bn-inline-content', { hasText: 'First line' }).waitFor(); await wait(1800)
  const r = { seen }
  r.ok = seen.filter(s => s[0] === 'HEAD').length === 1 && seen.filter(s => s[0] === 'GET').length === 1 && seen.find(s => s[0] === 'GET')[1] === 'image'
  return r
})
await scenario('Keys on a chosen image: Enter adds a line below, Backspace removes it with one Undo, an arrow moves on, and Esc lets go', async page => {
  await pasted(page)
  const count = () => doc().length, order = () => doc().map(n => n.type).join()
  await page.locator('.bn-visual-media').first().click(); await wait(400)
  const r = { start: order() }
  await page.keyboard.press('Enter'); await wait(1300)
  r.enter = order()
  await page.locator('.bn-visual-media').first().click(); await wait(400)
  await page.keyboard.press('Backspace'); await wait(1300)
  r.backspace = order()
  await undo(page)
  r.undo = order()
  const selected = () => page.evaluate(() => { const s = getSelection(); return [document.querySelectorAll('.ProseMirror-selectednode').length, s?.anchorNode?.textContent?.slice(0, 20) ?? null] })
  await page.locator('.bn-visual-media').first().click(); await wait(400)
  r.chosen = await selected()
  await page.keyboard.press('ArrowDown'); await wait(300)
  r.down = await selected()
  await page.locator('.bn-visual-media').first().click(); await wait(400)
  await page.keyboard.press('Escape'); await wait(300)
  r.esc = await selected()
  r.keys = r.chosen[0] === 1 && r.down[0] === 0 && r.esc[0] === 0
  r.ok = r.keys && !r.backspace.includes('image') && r.undo.includes('image') && r.enter.split(',').length === r.start.split(',').length + 1 && r.enter.split(',')[r.start.split(',').indexOf('image') + 1] === 'paragraph'
  return r
})
const typesNow = () => doc().map(n => n.type).join()
await scenario('B88: opening a page ending in a picture, then Backspace, Delete and a letter, changes nothing', async page => {
  await caretOn(page, 'Third line'); await page.keyboard.press('Enter'); await wait(100); await paste(page, [png]); await wait(1300)
  // Ends in the picture alone, with its line below gone.
  await page.locator('.bn-inline-content', { hasText: 'Third line' }).click(); await wait(100)
  const trailing = doc().at(-1); if (trailing.type === 'paragraph' && !trailing.content.length) { await page.locator('.bn-block-content[data-content-type=paragraph]').last().click(); await page.keyboard.press('Backspace'); await wait(1400) }
  const r = { last: doc().at(-1).type }, before = JSON.stringify(doc())
  await page.reload(); await page.locator('.bn-inline-content', { hasText: 'First line' }).waitFor(); await wait(1500)
  for (const key of ['Backspace', 'Delete', 'x']) { await page.keyboard.press(key); await wait(300) }
  await wait(1200)
  r.same = JSON.stringify(doc()) === before
  r.ok = r.last === 'image' && r.same
  return r
})
await scenario('B89: Delete from the line above and Backspace from the line below leave a picture; an empty line beside it goes', async page => {
  await pasted(page)
  const was = typesNow(), r = {}
  await caretOn(page, 'Second line'); await page.keyboard.press('Delete'); await wait(1300)
  r.delete = typesNow() === was
  await page.locator('.bn-block-content[data-content-type=paragraph]').nth(2).click(); await page.keyboard.type('Below'); await wait(1300)
  const below = doc().find(n => n.content?.[0]?.text?.includes('Below'))
  await page.locator(`[data-id="${below.id}"] .bn-inline-content`).click(); await page.keyboard.press('Meta+ArrowLeft'); await wait(100); await page.keyboard.press('Home'); await page.keyboard.press('Backspace'); await wait(1300)
  r.backspace = typesNow().includes('image') && doc().some(n => n.content?.[0]?.text?.includes('Below'))
  await caretOn(page, 'Second line'); await page.keyboard.press('Enter'); await wait(1300)
  const withLine = doc().length
  await page.keyboard.press('Delete'); await wait(1300)
  r.emptyGoes = doc().length === withLine - 1 && types().includes('image')
  r.ok = r.delete && r.backspace && r.emptyGoes
  return r
})
await scenario('An arrow arriving at a picture leaves it to Backspace; a click chooses it, and so does a click on an empty Add image', async page => {
  await pasted(page)
  const r = {}
  await page.locator('.bn-visual-media').first().click(); await wait(300); await page.keyboard.press('ArrowDown'); await wait(200); await page.keyboard.press('ArrowUp'); await wait(300)
  r.arrived = await page.locator('.ProseMirror-selectednode').count()
  await page.keyboard.press('Backspace'); await wait(1300)
  r.afterArrow = types().includes('image')
  await page.locator('.bn-visual-media').first().click(); await wait(300); await page.keyboard.press('Backspace'); await wait(1300)
  r.afterClick = types().includes('image')
  await caretOn(page, 'Second line'); await page.keyboard.press('Enter'); await page.keyboard.type('/image'); await wait(500); await page.keyboard.press('Enter'); await wait(500)
  await page.keyboard.press('Escape'); await wait(300); await page.mouse.click(5, 5); await wait(300)
  await page.locator('.bn-add-file-button').first().click(); await wait(400)
  r.selectedEmpty = await page.locator('.ProseMirror-selectednode').count()
  await page.keyboard.press('Backspace'); await wait(1300)
  r.emptyGone = !types().includes('image')
  r.ok = r.arrived === 1 && r.afterArrow && !r.afterClick && r.emptyGone
  return r
})
await scenario('Moved by its handle: the block goes, its address with it', async page => {
  await pasted(page)
  const before = doc().map(n => n.type).join(), box = await page.locator('.bn-visual-media').first().boundingBox()
  await page.mouse.move(box.x + 30, box.y + 30); await wait(400)
  const grip = await page.locator('.bn-side-menu [draggable="true"], .bn-side-menu button').first().boundingBox()
  const top = await page.locator('.bn-inline-content', { hasText: 'First line' }).boundingBox()
  await page.mouse.move(grip.x + grip.width / 2, grip.y + grip.height / 2); await page.mouse.down(); await page.mouse.move(grip.x, top.y + 2, { steps: 10 }); await wait(200); await page.mouse.up(); await wait(1500)
  const r = { before, after: doc().map(n => n.type).join(), url: Boolean(imageBlock().props.url.includes('/api/files/')) }
  r.ok = r.after !== before && r.after.startsWith('image') && r.url
  return r
})
await scenario('A file dropped on a table goes beside it, not into it', async page => {
  await page.goto(`${base}/pages?page=with-table`); await page.locator('.database-block').first().waitFor(); await wait(1200)
  const r = { ids: await page.evaluate(([list, make]) => {
    const data = new DataTransfer(); for (const f of eval(make)(list)) data.items.add(f)
    const el = document.querySelector('.database-block'), box = el.getBoundingClientRect()
    el.dispatchEvent(new DragEvent('drop', { dataTransfer: data, bubbles: true, cancelable: true, clientX: box.x + 40, clientY: box.bottom - 2 }))
    return true
  }, [[png], files]) }
  await wait(1400)
  r.types = JSON.parse(store().pages.find(p => p.id === 'with-table').document).map(n => n.type)
  r.ok = r.types.indexOf('image') === r.types.indexOf('database') + 1
  return r
})
if (engine === 'chromium') await scenario('A real drag of files from the desktop: the drop line shows, each lands in order, and letting go beside the column stays on the page', async (page, context) => {
  const { mkdtempSync, writeFileSync } = await import('node:fs'), dir = mkdtempSync('/tmp/rb-drop-')
  writeFileSync(join(dir, 'one.png'), Buffer.from(pixel, 'base64')); writeFileSync(join(dir, 'two.txt'), 'words')
  const cdp = await context.newCDPSession(page), paths = [join(dir, 'one.png'), join(dir, 'two.txt')]
  const at = await page.locator('.bn-inline-content', { hasText: 'Second line' }).boundingBox(), x = at.x + 40, y = at.y + at.height - 2
  const drag = (type, x, y) => cdp.send('Input.dispatchDragEvent', { type, x, y, data: { items: [], files: paths, dragOperationsMask: 1 } })
  await drag('dragEnter', x, y); await drag('dragOver', x, y); await wait(300); await drag('dragOver', x + 1, y); await wait(300)
  const r = { line: await page.evaluate(() => [...document.querySelectorAll('.editor-drop-line')].filter(e => e.getBoundingClientRect().width > 100).length), caret: await page.locator('[class*=dropcursor]').count() }
  await page.screenshot({ path: '/tmp/rb-csv/body-dropline.png' })
  await drag('drop', x, y); await wait(1800)
  r.types = types(); r.url = page.url().startsWith(base)
  await drag('dragEnter', 8, 300); await drag('dragOver', 8, 300); await drag('drop', 8, 300); await wait(800)
  r.stillHere = page.url().startsWith(base) && (await page.locator('.bn-inline-content', { hasText: 'First line' }).count()) === 1
  r.ok = r.line === 1 && r.caret === 0 && r.types.includes('image') && r.types.indexOf('file') === r.types.indexOf('image') + 1 && r.stillHere
  return r
})
await scenario('390: a tap brings ⋯, with what the bar offers; no resize; a saved width stays inside the column; a caption and Remove work from it', async page => {
  await caretOn(page, 'Second line'); await paste(page, [big]); await page.locator('.bn-visual-media:not(.body-image-loading)').first().waitFor(); await wait(1300)
  const image = page.locator('.bn-visual-media').first()
  const r = { before: await page.locator('.body-file-more').count() }
  await image.tap(); await wait(400)
  r.afterTap = await page.locator('.body-file-more').count()
  r.handles = await page.locator('.bn-resize-handle').evaluateAll(l => l.filter(h => getComputedStyle(h).display !== 'none').length)
  r.bar = await page.locator('.bn-formatting-toolbar').count()
  await page.locator('.body-file-more').tap(); await wait(300)
  r.menu = await page.locator('.body-file-menu [role=menuitem]').allInnerTexts()
  await page.screenshot({ path: '/tmp/rb-csv/body-menu-390.png' })
  const menu = await page.locator('.body-file-menu').boundingBox(); r.menuFits = menu.x >= 0 && menu.x + menu.width <= 390
  await page.locator('.body-file-menu [role=menuitem]', { hasText: 'Caption' }).tap(); await wait(200)
  await page.keyboard.type('From the phone', { delay: 30 }); await page.keyboard.press('Enter'); await wait(1400)
  r.caption = imageBlock().props.caption
  r.overflow = await page.evaluate(() => document.documentElement.scrollWidth - innerWidth)
  r.ok = r.before === 0 && r.afterTap === 1 && r.handles === 0 && r.bar === 0 && r.menu.includes('Replace') && r.menu.includes('Download') && r.menu.includes('Remove') && r.menuFits && r.caption === 'From the phone' && r.overflow <= 0
  return r
}, { viewport: { width: 390, height: 780 }, hasTouch: true })
await scenario('390: a file row has its ⋯, and /image\'s panel fits the screen', async page => {
  await caretOn(page, 'Second line'); await paste(page, [txt]); await wait(1300)
  const r = { more: await page.locator('.body-file .body-file-more').count() }
  await page.locator('.bn-inline-content', { hasText: 'First line' }).tap(); await wait(200)
  await page.keyboard.press('Meta+ArrowRight'); await page.keyboard.press('Enter'); await page.keyboard.type('/image', { delay: 30 }); await wait(500); await page.keyboard.press('Enter'); await wait(600)
  const panel = await page.locator('.bn-panel').first().boundingBox()
  r.panel = panel && [Math.round(panel.x), Math.round(panel.width)]
  r.overflow = await page.evaluate(() => document.documentElement.scrollWidth - innerWidth)
  await page.screenshot({ path: '/tmp/rb-csv/body-panel-390.png' })
  r.ok = r.more === 1 && Boolean(panel) && panel.x >= 0 && panel.x + panel.width <= 390 && r.overflow <= 0
  return r
}, { viewport: { width: 390, height: 780 }, hasTouch: true })
await browser.close()
console.log(failed ? `${failed} FAILED` : 'ALL PASS')
process.exit(failed ? 1 : 0)
