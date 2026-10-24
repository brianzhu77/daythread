// B5 review check (desktop half): the formatting toolbar's block-type menu leaves the day's own headings alone, and it
// offers no heading on a line that is indented or has lines indented under it, the same rules as the phone's Aa.
// Run against an isolated server on a disposable store (it types on today's page), never live.
// Usage: node scripts/block-type-check.mjs <base-url> [chromium|webkit]
import assert from 'node:assert/strict'
import * as pw from '@playwright/test'
const base = process.argv[2] ?? 'http://127.0.0.1:3513'
const engine = process.argv[3] ?? 'chromium'
const browser = await pw[engine].launch({ headless: true })
const page = await browser.newPage({ viewport: { width: 1280, height: 900 } })
const errors = []
page.on('pageerror', e => errors.push(e.message))
const stamp = Date.now().toString(36)
const parent = `parent ${stamp}`, child = `child ${stamp}`
const trigger = page.locator('.bn-formatting-toolbar button[role="combobox"], .bn-formatting-toolbar [data-slot="select-trigger"]').first()
// Selects the line's words the way a drag would; the formatting toolbar shows for a text selection.
const selectWord = async locator => {
  await locator.evaluate(el => { el.closest('[contenteditable="true"]').focus(); const r = document.createRange(); r.selectNodeContents(el); const sel = getSelection(); sel.removeAllRanges(); sel.addRange(r) })
  await page.mouse.move(5, 5); await page.waitForTimeout(500)
}
const options = async () => {
  await trigger.click(); await page.waitForTimeout(300)
  const all = await page.locator('[role="option"]').evaluateAll(els => els.map(e => ({ text: e.textContent.trim(), off: e.hasAttribute('data-disabled') || e.getAttribute('aria-disabled') === 'true' })))
  await page.keyboard.press('Escape'); await page.waitForTimeout(200)
  return all
}
const kindOf = text => page.evaluate(text => [...document.querySelectorAll('[data-content-type]')].find(c => c.textContent.trim() === text)?.dataset.contentType, text)
try {
  await page.goto(base, { waitUntil: 'networkidle' })
  const later = page.getByRole('button', { name: 'Later', exact: true })
  if (await later.count()) await later.click()
  // The day's own heading: the menu shows its type but is disabled.
  await selectWord(page.locator('[data-content-type="heading"]', { hasText: /^Good Stuffs$/ }).first().locator('.bn-inline-content'))
  assert.equal(await trigger.isVisible(), true, 'the block-type menu shows on a role heading')
  assert.equal(await trigger.isDisabled(), true, 'and is disabled there')
  await trigger.click({ force: true }); await page.waitForTimeout(300)
  assert.equal(await page.locator('[role="option"]').count(), 0, 'a disabled menu does not open')
  assert.equal(await kindOf('Good Stuffs'), 'heading')
  await page.keyboard.press('ArrowRight'); await page.waitForTimeout(300) // collapse, so the toolbar goes
  // A line he wrote: the menu works, headings included, until a line is indented under it.
  const line = await page.evaluate(() => {
    const blocks = [...document.querySelectorAll('[data-node-type="blockContainer"]')]
    const at = blocks.findIndex(b => b.querySelector('[data-content-type="heading"]')?.textContent.includes('Events'))
    return blocks[at + 1]?.dataset.id
  })
  await page.locator(`[data-node-type="blockContainer"][data-id="${line}"] .bn-inline-content`).first().click()
  await page.keyboard.type(parent)
  await selectWord(page.locator('.bn-inline-content', { hasText: parent }).first())
  assert.equal(await trigger.isDisabled(), false)
  assert.deepEqual((await options()).filter(o => o.off).map(o => o.text), [], 'every style offered on a plain line')
  await page.locator('.bn-inline-content', { hasText: parent }).first().evaluate(el => { const r = document.createRange(); r.selectNodeContents(el); r.collapse(false); const sel = getSelection(); sel.removeAllRanges(); sel.addRange(r) }); await page.waitForTimeout(200)
  await page.keyboard.press('Enter'); await page.keyboard.type(child); await page.keyboard.press('Tab'); await page.waitForTimeout(300)
  assert.equal(await page.locator('[data-node-type="blockGroup"] [data-node-type="blockGroup"] .bn-inline-content', { hasText: child }).count(), 1, 'the child line is indented')
  for (const text of [child, parent]) {
    await selectWord(page.locator('.bn-inline-content', { hasText: text }).first())
    const off = (await options()).filter(o => o.off).map(o => o.text)
    assert.ok(off.length >= 3 && off.every(t => t.startsWith('Heading') || t.startsWith('Toggle Heading')), `${text}: headings off, got ${off}`)
  }
  assert.deepEqual(errors, [])
  console.log(JSON.stringify({ engine, roleHeading: 'menu shown, disabled', plainLine: 'all styles', indented: 'no heading', parentOfIndented: 'no heading', pageErrors: 0 }))
} finally {
  await browser.close()
}
