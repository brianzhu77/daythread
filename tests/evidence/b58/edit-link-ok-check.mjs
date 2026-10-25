// B58 check: with the phone keyboard up, Edit link's URL form sits clear of the editor toolbar (both fields in view),
// and Return saves the link. Headless browsers can't raise an iOS keyboard, so this fakes one the way phone-keyboard-check
// does (it stays up for any text field, as iOS does). Run against an isolated server on a disposable store, never live.
// Usage: node tests/evidence/b58/edit-link-ok-check.mjs <base-url> [webkit|chromium]
import assert from 'node:assert/strict'
import * as pw from '@playwright/test'
const [base, engine = 'webkit'] = process.argv.slice(2)
const KEYBOARD = 336 // an iPhone keyboard with its suggestion bar, in CSS px
const browser = await pw[engine].launch({ headless: true })
// The iPhone profile, so the page sees a touch screen ((hover: none)) the way Safari reports it.
const page = await browser.newPage(engine === 'webkit' ? { ...pw.devices['iPhone 13'], viewport: { width: 390, height: 844 } } : { viewport: { width: 390, height: 844 }, hasTouch: true, isMobile: true })
const errors = []
page.on('pageerror', e => errors.push(e.message))
await page.addInitScript(keyboard => {
  const vv = window.visualViewport
  let up = 0
  Object.defineProperty(vv, 'height', { configurable: true, get: () => window.innerHeight - up })
  const fire = () => vv.dispatchEvent(new Event('resize'))
  const typing = () => { const a = document.activeElement; return Boolean(a?.closest('[contenteditable="true"]') || a?.matches?.('input:not([type=checkbox]), textarea')) }
  document.addEventListener('focusin', () => setTimeout(() => { if (typing() && !up) { up = keyboard; fire() } }, 60))
  document.addEventListener('focusout', () => setTimeout(() => { if (!typing() && up) { up = 0; fire() } }, 60))
}, KEYBOARD)
const settle = (ms = 450) => page.waitForTimeout(ms)
const URL_ = 'https://example.com/b58', NEW = 'https://example.com/b58-saved'
// The visible one: the page keeps other, hidden .bn-form elements (the formatting toolbar's link form).
const rect = sel => page.evaluate(s => { const r = [...document.querySelectorAll(s)].map(e => e.getBoundingClientRect()).find(r => r.height); return r ? { top: Math.round(r.top), bottom: Math.round(r.bottom), left: r.left, width: r.width } : null }, sel)
try {
  await page.goto(base, { waitUntil: 'networkidle' })
  const later = page.getByRole('button', { name: 'Later', exact: true })
  if (await later.count()) await later.tap()
  const notes = page.locator('[data-content-type="bulletListItem"] .bn-inline-content').last()
  await notes.tap(); await settle()
  await page.keyboard.insertText('see '); await settle()
  await page.evaluate(v => { const dt = new DataTransfer(); dt.setData('text/plain', v); document.activeElement.dispatchEvent(new ClipboardEvent('paste', { clipboardData: dt, bubbles: true, cancelable: true })) }, URL_)
  await settle()
  // The link's line about 120 px above the toolbar, as in Ratchet's native run: there's room below it in the layout
  // viewport (which iOS doesn't shrink for the keyboard), so the form opens downward, into the toolbar's band.
  const bar = await rect('.editor-phone-toolbar')
  assert.ok(bar, 'toolbar shown with the keyboard up')
  const line = await page.locator('.bn-editor a').first().boundingBox()
  await page.evaluate(by => window.scrollBy(0, by), line.y + line.height - (bar.top - 120)); await settle()
  await page.locator('.bn-editor a').first().tap(); await settle()
  await page.getByRole('button', { name: 'Edit link', exact: true }).tap(); await settle(700)
  const form = await page.evaluate(() => { const r = [...document.querySelectorAll('[data-slot="popover-content"]')].map(p => p.querySelector('input') && p.getBoundingClientRect()).find(r => r && r.height); return r ? { top: Math.round(r.top), bottom: Math.round(r.bottom) } : null })
  const toolbar = await rect('.editor-phone-toolbar')
  assert.ok(form && toolbar, `form and toolbar measured ${JSON.stringify({ form, toolbar })}`)
  assert.ok(form.bottom <= toolbar.top, `the URL form ends above the toolbar (form ${form.bottom}, toolbar ${toolbar.top})`)
  const url = page.locator('[data-slot="popover-content"] input:visible').first()
  assert.deepEqual(await page.locator('[data-slot="popover-content"] input:visible').evaluateAll(xs => xs.map(x => x.enterKeyHint)), ['done', 'done'], 'the keyboard key reads "done" in both fields')
  await url.fill(NEW); await settle()
  // BlockNote's form has no visible OK: its "OK" is a 1 px screen-reader submit (bn-screen-reader-only-submit), and
  // Return saves, on desktop and on the phone's keyboard alike.
  await url.press('Enter'); await settle(1500)
  assert.equal(await page.locator(`.bn-editor a[href="${NEW}"]`).count(), 1, 'Return saved the new URL')
  assert.deepEqual(errors, [])
  console.log(JSON.stringify({ engine, form, toolbar, pass: true }))
} catch (e) {
  console.log(JSON.stringify({ engine, errors, fail: e.message }))
  await page.screenshot({ path: `/tmp/jazz-b31/b58-fail-${engine}.png` })
  process.exitCode = 1
} finally {
  await browser.close()
}
