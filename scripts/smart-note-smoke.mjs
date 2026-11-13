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

assert.deepEqual(errors, [])
await browser.close()
console.log('smart note block: ok')
