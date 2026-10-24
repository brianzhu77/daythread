// B5 check (F16): the phone toolbar's Aa turns the caret's line into another style and keeps the caret and keyboard;
// a to-do made this way is a task, and turning it back follows B42; hide keyboard ends editing.
// Run against an isolated server on a disposable store (it types on today's page), never live.
// Usage: node scripts/phone-style-check.mjs <base-url> [webkit|chromium]
import assert from 'node:assert/strict'
import * as pw from '@playwright/test'
const base = process.argv[2] ?? 'http://127.0.0.1:3513'
const engine = process.argv[3] ?? 'webkit'
const browser = await pw[engine].launch({ headless: true })
const page = await browser.newPage({ viewport: { width: 390, height: 844 }, hasTouch: true })
const errors = []
page.on('pageerror', e => errors.push(e.message))
const words = `style line ${Date.now().toString(36)}`
const row = () => page.locator('[data-node-type="blockContainer"]', { hasText: words }).last()
const kind = () => row().evaluate(el => { const c = el.querySelector(':scope > .bn-block > [data-content-type], :scope > [data-content-type]') ?? el.querySelector('[data-content-type]'); return `${c.dataset.contentType}${c.dataset.contentType === "heading" ? (c.dataset.level ?? "1") : ""}` })
const state = () => page.evaluate(() => {
  const bar = document.querySelector('.editor-phone-toolbar'), panel = document.querySelector('.editor-style-panel')
  const box = el => el && el.getBoundingClientRect()
  const b = box(bar), p = panel && getComputedStyle(panel).display !== 'none' ? box(panel) : null
  return {
    toolbar: getComputedStyle(bar).display !== 'none',
    panel: Boolean(p),
    pressed: panel ? [...panel.querySelectorAll('[aria-pressed="true"]')].map(e => e.textContent) : [],
    caret: Boolean(document.activeElement?.closest('.bn-editor')),
    geometry: p ? { panelBottom: Math.round(p.bottom), toolbarTop: Math.round(b.top), left: Math.round(p.left), right: Math.round(p.right), minRow: Math.min(...[...panel.querySelectorAll('button')].map(e => Math.round(e.getBoundingClientRect().height))) } : null,
    labels: [...bar.querySelectorAll('button')].map(e => e.getAttribute('aria-label')),
  }
})
const tap = async selector => { await page.locator(selector).tap(); await page.waitForTimeout(400) }
const pick = async label => { await tap('.editor-phone-toolbar [aria-label="Line style"]'); await page.locator('.editor-style-panel button', { hasText: new RegExp(`^${label}$`) }).tap(); await page.waitForTimeout(500) }
try {
  await page.goto(base, { waitUntil: 'networkidle' })
  const later = page.getByRole('button', { name: 'Later', exact: true })
  if (await later.count()) await later.tap()
  const notesLine = await page.evaluate(() => {
    const blocks = [...document.querySelectorAll('[data-node-type="blockContainer"]')]
    const at = blocks.findIndex(b => b.querySelector('[data-content-type="heading"]')?.textContent.includes('Events'))
    return blocks[at + 1]?.dataset.id
  })
  await page.locator(`[data-node-type="blockContainer"][data-id="${notesLine}"] [data-content-type]`).first().tap({ position: { x: 40, y: 10 } })
  await page.keyboard.type(words)
  const start = await state()
  assert.deepEqual(start.labels, ['Line style', 'Insert block', 'Outdent', 'Indent', 'Undo', 'Redo', 'Hide keyboard'], 'F16 order')
  assert.equal(await kind(), 'bulletListItem')
  await tap('.editor-phone-toolbar [aria-label="Line style"]')
  const open = await state()
  assert.equal(open.panel, true); assert.deepEqual(open.pressed, ['Bullet']); assert.equal(open.caret, true, 'caret kept while the panel is open')
  assert.ok(open.geometry.panelBottom <= open.geometry.toolbarTop, 'panel sits above the toolbar'); assert.ok(open.geometry.left >= 8 && open.geometry.right <= 382); assert.ok(open.geometry.minRow >= 44)
  await page.screenshot({ path: `/tmp/jazz-basics/b5-aa-${engine}390.png` })
  await page.locator('.editor-style-panel button', { hasText: /^Heading 2$/ }).tap(); await page.waitForTimeout(500)
  assert.equal(await kind(), 'heading2')
  const after = await state()
  assert.equal(after.panel, false, 'panel closes after a choice'); assert.equal(after.caret, true, 'caret kept after a choice')
  await page.keyboard.type(' more')
  assert.ok((await row().innerText()).includes(`${words} more`), 'typing carries on in the same line')
  for (const [label, expected] of [['Text', 'paragraph'], ['Quote', 'quote'], ['Numbered', 'numberedListItem'], ['Heading 1', 'heading1']]) {
    await pick(label); assert.equal(await kind(), expected, label)
  }
  await pick('To-do')
  assert.equal(await kind(), 'task', 'To-do makes a task row')
  const taskId = await row().locator('[data-content-type="task"]').getAttribute('data-task-id')
  assert.ok(taskId)
  await page.waitForTimeout(1500); await page.reload({ waitUntil: 'networkidle' }); await page.waitForTimeout(800)
  assert.equal(await kind(), 'task', 'the to-do is saved')
  await row().locator('.bn-inline-content').first().tap({ position: { x: 30, y: 8 } }); await page.waitForTimeout(300)
  await tap('.editor-phone-toolbar [aria-label="Line style"]')
  assert.deepEqual((await state()).pressed, ['To-do'])
  await page.locator('.editor-style-panel button', { hasText: /^Bullet$/ }).tap(); await page.waitForTimeout(700)
  assert.equal(await kind(), 'bulletListItem')
  const notice = await page.getByText('Removed from tasks').count()
  assert.equal(notice, 1, 'B42 notice for a to-do turned into a bullet')
  await tap('.editor-phone-toolbar [aria-label="Hide keyboard"]')
  const hidden = await state()
  assert.equal(hidden.caret, false, 'hide keyboard ends editing'); assert.equal(hidden.toolbar, false, 'toolbar goes with the keyboard')
  assert.deepEqual(errors, [])
  console.log(JSON.stringify({ engine, order: start.labels, panel: open.geometry, styles: 'h2, text, quote, numbered, h1, to-do (task, saved), bullet (B42 notice)', caretKept: true, hideKeyboard: true, pageErrors: 0 }))
} finally {
  await browser.close()
}
