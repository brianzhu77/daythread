// Finding 6 check: on a touch screen BlockNote's link toolbar ("Edit link") shows only after a tap on a link, not when
// a paste leaves the caret in one; typing puts it away. With a mouse it behaves as before. Run against an isolated
// server on a disposable store (it types on today's page), never live.
// Usage: node tests/evidence/f6/link-toolbar-check.mjs <base-url> <phone|desktop>
import assert from 'node:assert/strict'
import * as pw from '@playwright/test'
const [base, mode = 'phone'] = process.argv.slice(2)
const phone = mode === 'phone'
const browser = await (phone ? pw.webkit : pw.chromium).launch({ headless: true })
const page = await browser.newPage(phone ? { ...pw.devices['iPhone 13'] } : { viewport: { width: 1280, height: 900 } })
const errors = []
page.on('pageerror', e => errors.push(e.message))
const URL_ = 'https://example.com/f6-check'
const toolbar = () => page.getByRole('button', { name: 'Edit link' }).isVisible().catch(() => false)
const settle = () => page.waitForTimeout(500)
try {
  await page.goto(base, { waitUntil: 'networkidle' })
  const later = page.getByRole('button', { name: 'Later', exact: true })
  if (await later.count()) await (phone ? later.tap() : later.click())
  // A Notes line with text, so the paste goes in as an inline link (B44's menu is for empty lines only).
  const notes = page.locator('[data-content-type="bulletListItem"] .bn-inline-content').last()
  await (phone ? notes.tap() : notes.click()); await settle()
  await page.keyboard.insertText('see '); await settle()
  await page.evaluate(v => { const dt = new DataTransfer(); dt.setData('text/plain', v); document.activeElement.dispatchEvent(new ClipboardEvent('paste', { clipboardData: dt, bubbles: true, cancelable: true })) }, URL_)
  await settle()
  const link = page.locator('.bn-editor a', { hasText: 'example.com' }).first()
  assert.equal(await link.count(), 1, 'the URL went in as a link')
  const afterPaste = await toolbar()
  if (phone) {
    assert.equal(afterPaste, false, 'phone: no Edit link right after the paste')
    await link.tap(); await settle()
    assert.equal(await toolbar(), true, 'phone: a tap on the link shows Edit link')
    await page.keyboard.insertText(' ok'); await settle()
    assert.equal(await toolbar(), false, 'phone: typing puts it away')
  } else {
    assert.equal(afterPaste, true, 'desktop: Edit link shows with the caret in the link, as before')
  }
  assert.deepEqual(errors, [])
  console.log(JSON.stringify({ mode, afterPaste, pass: true }))
} catch (e) {
  console.log(JSON.stringify({ mode, errors, fail: e.message }))
  await page.screenshot({ path: `/tmp/jazz-b31/f6-fail-${mode}.png` })
  process.exitCode = 1
} finally {
  await browser.close()
}
