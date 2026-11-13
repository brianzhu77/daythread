// Run against an isolated dev server with disposable SQLite only: it creates two pages and a smart note.
// A smart note block (smart-note.md §4): the record's result with numbered sources; Turn into text leaves ordinary lines
// with the same words, ⌘Z brings the block back, and a block whose record is gone says so. No model is needed.
import assert from 'node:assert/strict'
import { chromium } from '@playwright/test'
const base = process.argv[2] ?? 'http://127.0.0.1:3513'
const browser = await chromium.launch({ headless: true }), errors = []
const page = await browser.newPage({ viewport: { width: 1280, height: 900 } })
page.on('pageerror', e => errors.push(e.message))
await page.goto(base + '/', { waitUntil: 'networkidle' })

const seeded = await page.evaluate(async () => {
  const [f, d, l] = await Promise.all([import('/src/server/functions.ts'), import('/src/domain/editor-document.ts'), import('/src/domain/line-link.ts')])
  let { workspace } = await f.loadWorkspace({ data: { operationId: crypto.randomUUID() } })
  const run = async action => { workspace = (await f.runCommand({ data: { operationId: crypto.randomUUID(), expectedRevision: workspace.revision, action } })).workspace }
  // Fresh line ids too: the server renames a line id another page already holds.
  const today = new Date().toLocaleDateString('en-CA'), src = crypto.randomUUID(), host = crypto.randomUUID(), l1 = crypto.randomUUID(), l2 = crypto.randomUUID()
  const text = t => [{ type: 'text', text: t, styles: {} }]
  const save = (pageId, document) => run({ type: 'save-editor', pageId, expectedContent: d.pageContentKey(workspace.pages.find(p => p.id === pageId)), document: JSON.stringify(document), today })
  await run({ type: 'create-document', title: 'Checkout notes', body: '', pageId: src })
  await save(src, [{ id: l1, type: 'bulletListItem', props: {}, content: text('No guest checkout in v1'), children: [] }, { id: l2, type: 'bulletListItem', props: {}, content: text('Address form is one step now'), children: [] }])
  await run({ type: 'save-smart-note', note: { id: 'smoke-note', name: 'Checkout: where things stand', prompt: 'Where does checkout stand?', range: { where: { kind: 'pages', pageIds: [src] }, days: 0 }, refresh: 'manual', result: {
    blocks: [{ kind: 'heading', text: 'Decisions', sources: [] }, { kind: 'bullet', text: 'Guest checkout is out', sources: [{ pageId: src, blockId: l1 }] }, { kind: 'bullet', text: 'Address form moves to one step', sources: [{ pageId: src, blockId: l2 }, { pageId: src, blockId: l1 }] }],
    at: new Date().toISOString(), inputKey: 'seeded', pagesRead: 1, pagesLeftOut: 0, from: today, to: today,
  } } })
  await run({ type: 'create-document', title: 'Smart home', body: '', pageId: host })
  await save(host, [{ id: crypto.randomUUID(), type: 'paragraph', props: {}, content: text('Above the note'), children: [] }, { id: crypto.randomUUID(), type: 'smartNote', props: { noteId: 'smoke-note' }, children: [] }, { id: crypto.randomUUID(), type: 'smartNote', props: { noteId: 'no-such-note' }, children: [] }])
  return { host, l1Path: l.pagePath(workspace.pages.find(p => p.id === src), l1) }
})

await page.goto(`${base}/pages?page=${seeded.host}`, { waitUntil: 'networkidle' })
const note = page.locator('.smart-note:not(.is-deleted)')
await note.waitFor()
await assert.doesNotReject(note.getByText('Checkout: where things stand').waitFor(), 'the name shows')
for (const words of ['Guest checkout is out', 'Address form moves to one step']) assert.equal(await note.locator('li', { hasText: words }).count(), 1, `the bullet "${words}" shows`)
assert.match(await note.locator('.smart-note-read').innerText(), /^Read 1 page · /, 'the Read line shows')
const sources = note.locator('.smart-note-source a')
assert.deepEqual(await sources.allInnerTexts(), ['1', '2', '1'], 'one number per distinct line, by first appearance')
assert.equal(await sources.first().getAttribute('href'), seeded.l1Path, "a source links to its line's page path")
assert.equal(await page.locator('.smart-note.is-deleted .smart-note-name').innerText(), 'This smart note was deleted', 'a block with an unknown note says it was deleted')

await note.getByRole('button', { name: 'Checkout: where things stand actions' }).click()
await page.getByRole('menuitem', { name: 'Turn into text' }).click()
await page.waitForTimeout(300)
assert.equal(await page.locator('.smart-note:not(.is-deleted)').count(), 0, 'Turn into text leaves no smart note')
const editor = page.locator('.bn-editor')
for (const words of ['Decisions', 'Guest checkout is out', 'Address form moves to one step']) assert.equal(await editor.locator('.bn-inline-content', { hasText: words }).count(), 1, `"${words}" is an ordinary line`)
assert.equal(await editor.locator('[data-content-type="heading"] .bn-inline-content', { hasText: 'Decisions' }).count(), 1, 'the heading stays a heading')
assert.equal(await editor.locator('.bn-inline-content', { hasText: 'Address form moves to one step' }).locator('.line-ref').count(), 2, 'each source is a line link')

await editor.locator('.bn-inline-content', { hasText: 'Above the note' }).click()
await page.keyboard.press('ControlOrMeta+z'); await page.waitForTimeout(300)
assert.equal(await page.locator('.smart-note:not(.is-deleted)').count(), 1, 'Undo brings the block back')
assert.equal(await editor.locator('.bn-inline-content', { hasText: 'Guest checkout is out' }).count(), 0, 'and takes the lines away')

// At 390 wide every control is a 44 px target; the source numbers keep their small glyph inside a taller hit area.
// The hit box is measured as the span of points that hit the control (elementFromPoint), so clipping counts too.
const phone = await browser.newPage({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true })
phone.on('pageerror', e => errors.push(e.message))
const fnName = url => { try { return JSON.parse(Buffer.from(new URL(url).pathname.split('/').pop(), 'base64url').toString()).export } catch { return '' } }
// No model here: the tab is told smart notes are on, and the ask fails, so the failed state shows its Retry.
await phone.route('**/_serverFn/**', async route => {
  const name = fnName(route.request().url())
  if (name.startsWith('askSmartNote')) return route.abort('failed')
  if (!name.startsWith('smartNotesOn')) return route.continue()
  const response = await route.fetch()
  return route.fulfill({ response, body: (await response.text()).replace('"k":["on"],"v":[{"t":2,"s":3}]', '"k":["on"],"v":[{"t":2,"s":2}]') })
})
await phone.goto(`${base}/pages?page=${seeded.host}`, { waitUntil: 'networkidle' })
const hitBox = selector => phone.locator(selector).first().evaluate(el => {
  const r = el.getBoundingClientRect(), cx = r.left + r.width / 2, cy = r.top + r.height / 2
  const hits = (x, y) => { const at = document.elementFromPoint(x, y); return Boolean(at && (at === el || el.contains(at))) }
  let top = cy, bottom = cy, left = cx, right = cx
  while (hits(cx, top - 1)) top--
  while (hits(cx, bottom + 1)) bottom++
  while (hits(left - 1, cy)) left--
  while (hits(right + 1, cy)) right++
  return { width: right - left + 1, height: bottom - top + 1 }
})
await phone.locator('.smart-note-source a').first().waitFor()
const source = await hitBox('.smart-note-source a')
assert.ok(source.height >= 44, `a source number is a 44 px target at 390 (${source.width}x${source.height})`)
await phone.getByRole('button', { name: 'Refresh' }).click()
await phone.getByRole('button', { name: 'Retry' }).waitFor()
const retry = await hitBox('.smart-note-status button')
assert.ok(retry.height >= 44 && retry.width >= 44, `Retry is a 44 px target at 390 (${retry.width}x${retry.height})`)
console.log(`at 390: source ${source.width}x${source.height}, Retry ${retry.width}x${retry.height}`)

assert.deepEqual(errors, [])
await browser.close()
console.log('smart note block: ok')
