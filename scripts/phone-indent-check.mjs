// B5 check: the phone toolbar's indent / outdent nest the caret's line like Tab / Shift+Tab, keep the caret, save, and
// are off where nesting would leave a section (first line under a heading, the heading itself).
// Run against an isolated server on a disposable store (it types two task rows on today's page), never live.
// Usage: node scripts/phone-indent-check.mjs <base-url> [chromium|webkit]
import assert from 'node:assert/strict'
import * as pw from '@playwright/test'
const base = process.argv[2] ?? 'http://127.0.0.1:3043'
const engine = process.argv[3] ?? 'webkit'
const browser = await pw[engine].launch({ headless: true })
const page = await browser.newPage({ viewport: { width: 390, height: 844 }, hasTouch: true })
const errors = []
page.on('pageerror', e => errors.push(e.message))
const stamp = Date.now().toString(36)
const [parent, child] = [`indent parent ${stamp}`, `indent child ${stamp}`]
const row = text => page.locator('[data-node-type="blockContainer"]', { hasText: text }).last()
const depth = text => row(text).evaluate(el => {
  let d = 0
  for (let n = el.parentElement; n; n = n.parentElement) if (n.matches('[data-node-type="blockContainer"]')) d++
  return d
})
const tools = () => page.evaluate(() => {
  const bar = document.querySelector('.editor-phone-toolbar')
  const on = label => !bar.querySelector(`[aria-label="${label}"]`).disabled
  return { shown: getComputedStyle(bar).display !== 'none', indent: on('Indent'), outdent: on('Outdent'), caret: Boolean(document.activeElement?.closest('.bn-editor')) }
})
const tap = async label => { await page.locator(`.editor-phone-toolbar [aria-label="${label}"]`).tap(); await page.waitForTimeout(400) }
const tapLine = async text => { await row(text).locator('.bn-inline-content').first().tap({ position: { x: 12, y: 8 } }); await page.waitForTimeout(300) }
const settle = async () => { await page.waitForTimeout(1500); await page.reload({ waitUntil: 'networkidle' }); await page.waitForTimeout(800) }
try {
  await page.goto(base, { waitUntil: 'networkidle' })
  const later = page.getByRole('button', { name: 'Later', exact: true })
  if (await later.count()) await later.tap()
  // The first task row under "TODO - Other": type the parent, Enter, the child.
  const firstRow = await page.evaluate(() => {
    const blocks = [...document.querySelectorAll('[data-node-type="blockContainer"]')]
    const at = blocks.findIndex(b => b.querySelector(':scope > [data-content-type="heading"]')?.textContent.includes('Other'))
    return blocks[at + 1]?.dataset.id
  })
  await page.locator(`[data-node-type="blockContainer"][data-id="${firstRow}"] .bn-inline-content`).first().tap({ position: { x: 12, y: 8 } })
  await page.keyboard.type(parent)
  assert.deepEqual(await tools(), { shown: true, indent: false, outdent: false, caret: true }, 'first line of a section can neither indent nor outdent')
  await page.keyboard.press('Enter')
  await page.keyboard.type(child)
  assert.deepEqual(await tools(), { shown: true, indent: true, outdent: false, caret: true })
  await tap('Indent')
  assert.equal(await depth(child), (await depth(parent)) + 1)
  assert.deepEqual(await tools(), { shown: true, indent: false, outdent: true, caret: true }, 'caret and toolbar stay after a tap')
  const taskId = await row(child).locator('[data-content-type="task"]').getAttribute('data-task-id')
  await settle()
  assert.equal(await depth(child), (await depth(parent)) + 1, 'nesting is saved')
  assert.equal(await row(child).locator('[data-content-type="task"]').getAttribute('data-task-id'), taskId, 'same task')
  await tapLine(child)
  await tap('Outdent')
  assert.equal(await depth(child), await depth(parent))
  await tap('Undo')
  assert.equal(await depth(child), (await depth(parent)) + 1, 'Undo reverses an outdent')
  await tap('Redo')
  assert.equal(await depth(child), await depth(parent))
  await settle()
  assert.equal(await depth(child), await depth(parent), 'outdent is saved')
  await page.locator('[data-content-type="heading"]', { hasText: 'Other' }).first().locator('.bn-inline-content').tap({ position: { x: 8, y: 8 } })
  await page.waitForTimeout(300)
  assert.equal((await tools()).indent, false, 'a heading never indents')
  assert.deepEqual(errors, [])
  console.log(JSON.stringify({ engine, indent: 'nests and saves, same task', outdent: 'unnests and saves', undoRedo: 'ok', caretKept: true, offAtSectionStartAndHeading: true, pageErrors: 0 }))
} finally {
  await browser.close()
}
