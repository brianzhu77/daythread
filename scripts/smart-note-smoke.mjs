// Run against an isolated dev server with disposable SQLite only: it creates pages and smart notes.
//   node scripts/smart-note-smoke.mjs <base>              the server has OPENROUTER_API_KEY=test OPENROUTER_MODEL=test
//                                                         OPENROUTER_BASE_URL=http://127.0.0.1:3514, this script's stub
//   node scripts/smart-note-smoke.mjs <base> --no-model   the server has no model key
// A smart note block (smart-note.md §4): the record's result with numbered sources; Turn into text leaves ordinary lines
// with the same words, ⌘Z brings the block back, and a block whose record is gone says so. With the stub as the model:
// `/` → Smart note, setup with a preview, Save, the picker on a second page, Refresh, Edit and a failed refresh. With
// no model: the last result still shows, with no Refresh, no Edit and no Smart note in `/`.
import assert from 'node:assert/strict'
import http from 'node:http'
import { chromium } from '@playwright/test'
const base = process.argv[2] ?? 'http://127.0.0.1:3513', withModel = !process.argv.includes('--no-model')
// Names unique to this run, so a store that has seen an earlier run still finds one of each.
const run = Math.random().toString(36).slice(2, 7), sourceTitle = `Checkout notes ${run}`, digest = `Checkout digest ${run}`

// The only "model" this smoke ever reaches: two bullets citing L1 and L2, numbered by call so a refresh shows.
const stub = { calls: 0, failNext: 0 }
const stubServer = withModel ? http.createServer((req, res) => {
  let body = ''
  req.on('data', c => { body += c })
  req.on('end', () => {
    const asked = (() => { try { return JSON.parse(body) } catch { return null } })()
    if (req.url !== '/chat/completions' || asked?.response_format?.json_schema?.name !== 'smart_note') { res.writeHead(503).end('{}'); return }
    const n = ++stub.calls
    if (stub.failNext > 0) { stub.failNext--; res.writeHead(500, { 'content-type': 'application/json' }).end('{"error":{"message":"stub"}}'); return }
    const blocks = [{ kind: 'bullet', text: `Guest checkout stays out (answer ${n})`, sources: ['L1'] }, { kind: 'bullet', text: `The address form is one step (answer ${n})`, sources: ['L2'] }]
    res.writeHead(200, { 'content-type': 'application/json' }).end(JSON.stringify({ id: `stub-${n}`, choices: [{ message: { content: JSON.stringify({ blocks }) } }], usage: { cost: 0, prompt_tokens: 1, completion_tokens: 1 } }))
  })
}) : null
if (stubServer) await new Promise(resolve => stubServer.listen(3514, '127.0.0.1', resolve))

const browser = await chromium.launch({ headless: true }), errors = []
const page = await browser.newPage({ viewport: { width: 1280, height: 900 } })
page.on('pageerror', e => errors.push(e.message))
await page.goto(base + '/', { waitUntil: 'networkidle' })

const seeded = await page.evaluate(async sourceTitle => {
  const [f, d, l] = await Promise.all([import('/src/server/functions.ts'), import('/src/domain/editor-document.ts'), import('/src/domain/line-link.ts')])
  let { workspace } = await f.loadWorkspace({ data: { operationId: crypto.randomUUID() } })
  const run = async action => { workspace = (await f.runCommand({ data: { operationId: crypto.randomUUID(), expectedRevision: workspace.revision, action } })).workspace }
  // Fresh line ids too: the server renames a line id another page already holds.
  const today = new Date().toLocaleDateString('en-CA'), src = crypto.randomUUID(), host = crypto.randomUUID(), l1 = crypto.randomUUID(), l2 = crypto.randomUUID()
  const setup = crypto.randomUUID(), second = crypto.randomUUID(), setupLine = crypto.randomUUID(), secondLine = crypto.randomUUID()
  const text = t => [{ type: 'text', text: t, styles: {} }]
  const save = (pageId, document) => run({ type: 'save-editor', pageId, expectedContent: d.pageContentKey(workspace.pages.find(p => p.id === pageId)), document: JSON.stringify(document), today })
  await run({ type: 'create-document', title: sourceTitle, body: '', pageId: src })
  await save(src, [{ id: l1, type: 'bulletListItem', props: {}, content: text('No guest checkout in v1'), children: [] }, { id: l2, type: 'bulletListItem', props: {}, content: text('Address form is one step now'), children: [] }])
  await run({ type: 'save-smart-note', note: { id: 'smoke-note', name: 'Checkout: where things stand', prompt: 'Where does checkout stand?', range: { where: { kind: 'pages', pageIds: [src] }, days: 0 }, refresh: 'manual', result: {
    blocks: [{ kind: 'heading', text: 'Decisions', sources: [] }, { kind: 'bullet', text: 'Guest checkout is out', sources: [{ pageId: src, blockId: l1 }] }, { kind: 'bullet', text: 'Address form moves to one step', sources: [{ pageId: src, blockId: l2 }, { pageId: src, blockId: l1 }] }],
    at: new Date().toISOString(), inputKey: 'seeded', pagesRead: 1, pagesLeftOut: 0, from: today, to: today,
  } } })
  await run({ type: 'create-document', title: 'Smart home', body: '', pageId: host })
  await save(host, [{ id: crypto.randomUUID(), type: 'paragraph', props: {}, content: text('Above the note'), children: [] }, { id: crypto.randomUUID(), type: 'smartNote', props: { noteId: 'smoke-note' }, children: [] }, { id: crypto.randomUUID(), type: 'smartNote', props: { noteId: 'no-such-note' }, children: [] }])
  await run({ type: 'create-document', title: 'Smart setup', body: '', pageId: setup })
  await save(setup, [{ id: setupLine, type: 'paragraph', props: {}, content: [], children: [] }])
  await run({ type: 'create-document', title: 'Smart second', body: '', pageId: second })
  await save(second, [{ id: secondLine, type: 'paragraph', props: {}, content: [], children: [] }])
  return { host, setup, second, setupLine, secondLine, l1Path: l.pagePath(workspace.pages.find(p => p.id === src), l1), on: (await f.smartNotesOn()).on }
}, sourceTitle)
assert.equal(seeded.on, withModel, withModel ? 'the server has the stub as its model' : 'the server has no model')

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
assert.equal(await note.getByRole('button', { name: 'Refresh' }).count(), withModel ? 1 : 0, withModel ? 'Refresh shows with a model' : 'no Refresh without a model')

await note.getByRole('button', { name: 'Checkout: where things stand actions' }).click()
assert.equal(await page.getByRole('menuitem', { name: 'Edit' }).count(), withModel ? 1 : 0, withModel ? 'the menu offers Edit with a model' : 'no Edit without a model')
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

// `/smart` on an empty line: the menu's items, by title.
const slash = async (pageId, lineId) => {
  await page.goto(`${base}/pages?page=${pageId}`, { waitUntil: 'networkidle' })
  await page.locator(`.bn-editor [data-id="${lineId}"] .bn-inline-content`).click()
  await page.keyboard.type('/smart'); await page.waitForTimeout(400)
  return page.locator('#bn-suggestion-menu [role=option]')
}
const sheet = page.getByRole('dialog', { name: 'Smart note' })
const save = sheet.locator('#smart-note-save')

if (withModel) {
  const items = await slash(seeded.setup, seeded.setupLine)
  assert.deepEqual(await items.allInnerTexts().then(t => t.map(s => s.trim())), ['Smart note'], '`/smart` offers Smart note')
  await items.first().click()
  // A placed note exists (the seeded one), so the picker comes first.
  await sheet.getByRole('menuitem', { name: 'New smart note' }).click()
  await sheet.getByText('New smart note').waitFor()
  assert.ok(await save.isDisabled(), 'Save is disabled before a preview')
  await sheet.locator('#smart-note-prompt').fill('Where does checkout stand?')
  await sheet.locator('#smart-note-where').selectOption('pages')
  await sheet.locator('#smart-note-pages').fill(sourceTitle)
  await sheet.locator('.smart-setup-page', { hasText: sourceTitle }).locator('input').check()
  assert.ok(await save.isDisabled(), 'Save is still disabled with no preview')
  await sheet.getByRole('button', { name: 'Run preview' }).click()
  await sheet.locator('.smart-setup-preview li', { hasText: 'Guest checkout stays out' }).waitFor()
  assert.equal(await sheet.locator('.smart-setup-preview li').count(), 2, "the preview shows the stub's two bullets")
  assert.match(await sheet.locator('.smart-setup-preview .smart-note-read').innerText(), /^Read 1 page · /, 'the preview shows the Read line')
  assert.ok(await save.isEnabled(), 'Save is enabled after a preview')
  assert.ok(await sheet.locator('.smart-setup-preview .smart-note-source').count() > 0, 'the preview shows its source numbers')
  assert.equal(await sheet.locator('.smart-setup-preview a[href]').count(), 0, "the preview's source numbers are not links")
  await sheet.locator('#smart-note-prompt').fill('Where does checkout stand now?')
  assert.ok(await save.isDisabled(), 'changing the prompt disables Save again')
  await sheet.locator('#smart-note-prompt').fill('Where does checkout stand?')
  assert.ok(await save.isEnabled(), 'the prompt the preview was run with enables it again')
  await sheet.locator('#smart-note-name').fill(digest)
  const answer = (await sheet.locator('.smart-setup-preview li').first().innerText()).match(/\(answer (\d+)\)/)[1]
  const previewed = `Guest checkout stays out (answer ${answer})`
  await save.click()
  await sheet.waitFor({ state: 'detached' })
  const made = page.locator('.smart-note', { hasText: digest })
  await made.waitFor()
  const bullets = await made.locator('li').allInnerTexts()
  assert.equal(bullets.length, 2, 'the saved block has two bullets')
  assert.ok(bullets[0].startsWith(previewed) && bullets[1].startsWith(`The address form is one step (answer ${answer})`), `the saved block shows the previewed answer (${bullets.join(' | ')})`)
  assert.ok(await made.locator('.smart-note-source a[href]').count() > 0, "the saved block's source numbers are links")
  assert.equal(await page.locator(`.bn-editor [data-id="${seeded.setupLine}"]`).count(), 0, 'the block took the empty line')
  await page.getByText('Smart note saved').first().waitFor()

  // Edit: the stored prompt, Save on as it stands, off once the prompt changes; Cancel stores nothing.
  await made.getByRole('button', { name: `${digest} actions` }).click()
  await page.getByRole('menuitem', { name: 'Edit' }).click()
  assert.equal(await sheet.locator('#smart-note-prompt').inputValue(), 'Where does checkout stand?', 'Edit shows the stored prompt')
  assert.ok(await save.isEnabled(), 'an unchanged Edit can be saved')
  await sheet.locator('#smart-note-prompt').fill('Something else')
  assert.ok(await save.isDisabled(), 'a changed prompt needs a preview')
  await sheet.getByRole('button', { name: 'Cancel' }).click()
  await sheet.waitFor({ state: 'detached' })

  // Navigating with the setup open closes it and stores nothing. A client-side move first, so Back is the app's own
  // route change (no reload, and no press outside the sheet).
  const noteCount = () => page.evaluate(async () => (await (await import('/src/server/functions.ts')).loadWorkspace({ data: { operationId: crypto.randomUUID() } })).workspace.smartNotes?.length ?? 0)
  const before = await noteCount()
  await page.locator('.tree-title[title="Smart second"]').first().click()
  await page.waitForURL(url => url.search.includes(seeded.second))
  await page.locator(`.bn-editor [data-id="${seeded.secondLine}"] .bn-inline-content`).click()
  await page.keyboard.type('/smart'); await page.waitForTimeout(400)
  await page.locator('#bn-suggestion-menu [role=option]').first().click()
  await sheet.getByRole('menuitem', { name: 'New smart note' }).click()
  await sheet.locator('#smart-note-prompt').fill('Left behind')
  await page.evaluate(() => { window.smokeSamePage = true })
  await page.goBack()
  await sheet.waitFor({ state: 'detached' })
  assert.ok(await page.evaluate(() => window.smokeSamePage === true), 'Back was a route change in the same page')
  assert.equal(await noteCount(), before, 'navigating away stores no note')

  // The same note on a second page, through the picker.
  const again = await slash(seeded.second, seeded.secondLine)
  await again.first().click()
  const pick = sheet.getByRole('menuitem', { name: digest })
  await pick.waitFor()
  assert.equal(await sheet.getByRole('menuitem', { name: 'New smart note' }).count(), 1, 'the picker ends with New smart note')
  await pick.click()
  await sheet.waitFor({ state: 'detached' })
  const there = page.locator('.smart-note', { hasText: digest })
  await there.locator('li', { hasText: previewed }).waitFor()
  assert.equal(await there.locator('li').count(), 2, 'the second place shows the same result')

  // Refresh in one place updates both.
  const refreshed = `(answer ${stub.calls + 1})`
  await there.getByRole('button', { name: 'Refresh' }).click()
  await there.locator('li', { hasText: refreshed }).first().waitFor()
  await page.goto(`${base}/pages?page=${seeded.setup}`, { waitUntil: 'networkidle' })
  await page.locator('.smart-note', { hasText: digest }).locator('li', { hasText: refreshed }).first().waitFor()
} else {
  const items = await slash(seeded.setup, seeded.setupLine)
  assert.equal(await items.count(), 0, '`/smart` offers nothing without a model')
  await page.keyboard.press('Escape')
}

// At 390 wide every control is a 44 px target; the source numbers keep their small glyph inside a taller hit area.
// The hit box is measured as the span of points that hit the control (elementFromPoint), so clipping counts too.
const phone = await browser.newPage({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true })
phone.on('pageerror', e => errors.push(e.message))
await phone.goto(`${base}/pages?page=${seeded.host}`, { waitUntil: 'networkidle' })
const hitBox = locator => locator.evaluate(el => {
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
const source = await hitBox(phone.locator('.smart-note-source a').first())
assert.ok(source.height >= 44, `a source number is a 44 px target at 390 (${source.width}x${source.height})`)
const sizes = [`source ${source.width}x${source.height}`]
if (withModel) {
  // The stub fails one call with HTTP 500: Retry shows, and the next call succeeds.
  stub.failNext = 1
  const shown = phone.locator('.smart-note:not(.is-deleted)').first()
  await shown.getByRole('button', { name: 'Refresh' }).click()
  await shown.getByText("Couldn't refresh ·").waitFor()
  const retry = await hitBox(shown.locator('.smart-note-status button'))
  assert.ok(retry.height >= 44 && retry.width >= 44, `Retry is a 44 px target at 390 (${retry.width}x${retry.height})`)
  sizes.push(`Retry ${retry.width}x${retry.height}`)
  await shown.getByRole('button', { name: 'Retry' }).click()
  await shown.locator('li', { hasText: '(answer ' }).first().waitFor()
  assert.equal(await shown.locator('.smart-note-status').count(), 0, 'Retry succeeds and the failure goes')

  // The setup sheet's controls at 390.
  await shown.getByRole('button', { name: 'Checkout: where things stand actions' }).click()
  await phone.getByRole('menuitem', { name: 'Edit' }).click()
  const phoneSheet = phone.getByRole('dialog', { name: 'Smart note' })
  await phoneSheet.waitFor()
  for (const selector of ['#smart-note-where', '#smart-note-days', '#smart-note-pages', '#smart-note-name', '#smart-note-preview', '#smart-note-cancel', '#smart-note-save', '.smart-setup-chip button']) {
    await phoneSheet.locator(selector).first().scrollIntoViewIfNeeded()
    const box = await hitBox(phoneSheet.locator(selector).first())
    assert.ok(box.height >= 44 && box.width >= 44, `${selector} is a 44 px target at 390 (${box.width}x${box.height})`)
    sizes.push(`${selector} ${box.width}x${box.height}`)
  }
  await phoneSheet.getByRole('button', { name: 'Cancel' }).click()
  await phoneSheet.waitFor({ state: 'detached' })
  console.log(`stub calls: ${stub.calls}`)
}
console.log(`at 390: ${sizes.join(', ')}`)

assert.deepEqual(errors, [])
await browser.close()
stubServer?.close()
console.log(`smart note ${withModel ? 'with the stub model' : 'with no model'}: ok`)
