// Run against an isolated dev server with disposable SQLite only: the Delete checks write to today's page.
// Shift-clicking a second handle selects both blocks (design d8b89a88): the bar reads "2 blocks selected", typing
// changes nothing, Enter puts the caret at the end of the first block, and Delete removes both with one Undo / one ⌘Z.
import assert from 'node:assert/strict'
import { chromium } from '@playwright/test'
const base = process.argv[2] ?? 'http://127.0.0.1:3044'
const browser = await chromium.launch({ headless: true }), errors = []
const blocks = page => page.evaluate(() => [...document.querySelectorAll('.bn-editor [data-node-type=blockContainer]')].map(e => `${e.dataset.id}:${e.querySelector('.bn-inline-content, .editor-task-title')?.textContent ?? ''}`).join('|'))
const label = page => page.locator('.continuous-editor .sr-only[aria-label]').getAttribute('aria-label')
async function fresh() {
  const page = await browser.newPage({ viewport: { width: 1280, height: 1000 } })
  page.on('pageerror', e => errors.push(e.message))
  await page.goto(base, { waitUntil: 'networkidle' })
  await page.locator('.editor-task-title').first().waitFor({ state: 'visible', timeout: 30000 })
  return page
}
async function clickHandle(page, row) {
  await row.hover(); await page.waitForTimeout(250)
  await page.locator('.bn-side-menu [draggable=true]').first().click(); await page.waitForTimeout(300)
}
// The first two task rows that sit next to each other, so the selection is exactly those two blocks.
async function pickTwo(page) {
  const ids = await page.evaluate(() => {
    const all = [...document.querySelectorAll('.bn-editor [data-node-type=blockContainer]')]
    const i = all.findIndex((e, n) => e.querySelector('.editor-task-title') && all[n + 1]?.querySelector('.editor-task-title'))
    return i < 0 ? null : [all[i].dataset.id, all[i + 1].dataset.id]
  })
  assert(ids, 'today needs two adjacent task rows')
  const row = id => page.locator(`.bn-editor [data-node-type=blockContainer][data-id="${id}"] .editor-task-title`).first()
  await clickHandle(page, row(ids[0]))
  await page.keyboard.down('Shift'); await page.mouse.move(5, 5); await clickHandle(page, row(ids[1])); await page.keyboard.up('Shift')
  return ids
}
try {
  {
    const page = await fresh(), before = await blocks(page)
    const [first] = await pickTwo(page)
    assert.equal(await label(page), '2 blocks selected')
    await page.keyboard.type('a'); await page.waitForTimeout(800)
    assert.equal(await blocks(page), before, 'typing must not replace the selected blocks')
    await page.keyboard.press('Enter')
    const caret = await page.evaluate(() => { const s = window.getSelection(), el = s?.focusNode?.parentElement?.closest('[data-node-type=blockContainer]'); return { id: el?.dataset.id, atEnd: s?.focusOffset === s?.focusNode?.textContent?.length } })
    assert.deepEqual(caret, { id: first, atEnd: true }, 'Enter goes to the end of the first selected block')
    await page.close()
  }
  for (const undo of ['notice', 'keyboard']) {
    const page = await fresh(), before = await blocks(page)
    const ids = await pickTwo(page)
    await page.keyboard.press('Delete'); await page.waitForTimeout(700)
    const after = await blocks(page)
    assert(ids.every(id => !after.includes(id)), 'Delete removes both blocks')
    assert.equal(await page.locator('[data-slot=toast]').count(), 1, 'one notice')
    if (undo === 'notice') await page.locator('[data-slot=toast]').getByRole('button', { name: 'Undo' }).click()
    // Delete leaves the caret in the editor, so ⌘Z goes straight to the editor's history.
    else await page.keyboard.press('Meta+z')
    await page.waitForTimeout(1200)
    assert.equal(await blocks(page), before, `one ${undo} undo restores both blocks with their ids`)
    await page.close()
  }
  assert.deepEqual(errors, [])
  console.log('editor shift selection smoke passed')
} finally { await browser.close() }
