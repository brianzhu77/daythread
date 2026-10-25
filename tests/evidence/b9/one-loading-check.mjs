// B9 check: a cold open says one thing while it loads ("Loading your day…") and never flashes "Opening your page…" or
// "No page … yet · Start this page" on the way. Records every such text from the first paint, for a brand-new day
// (the page is made on open) and for a reload of that day. Run against an isolated server on a fresh store, never live.
// Usage: node tests/evidence/b9/one-loading-check.mjs <base-url> [webkit|chromium] [390|1280]
import assert from 'node:assert/strict'
import * as pw from '@playwright/test'
const [base, engine = 'webkit', width = '390'] = process.argv.slice(2)
const w = Number(width)
const browser = await pw[engine].launch({ headless: true })
const page = await browser.newPage({ viewport: { width: w, height: w < 600 ? 844 : 900 }, hasTouch: w < 600 })
const errors = []
page.on('pageerror', e => errors.push(e.message))
await page.addInitScript(() => {
  window.__seen = []
  const note = () => {
    for (const el of document.querySelectorAll('.loading, .empty p')) {
      const t = el.textContent.trim()
      if (t && window.__seen.at(-1) !== t) window.__seen.push(t)
    }
  }
  new MutationObserver(note).observe(document, { subtree: true, childList: true, characterData: true })
})
const open = async () => {
  await page.goto(base, { waitUntil: 'networkidle' })
  await page.waitForSelector('.bn-editor', { timeout: 15000 })
  await page.waitForTimeout(300)
  return page.evaluate(() => window.__seen)
}
try {
  const fresh = await open()
  const again = await open()
  const out = { engine, w, fresh, again }
  for (const [name, seen] of Object.entries({ fresh, again })) {
    assert.ok(seen.every(t => t === 'Loading your day…'), `${name}: only "Loading your day…" while loading ${JSON.stringify(seen)}`)
  }
  assert.deepEqual(errors, [])
  console.log(JSON.stringify({ ...out, pass: true }))
} catch (e) {
  console.log(JSON.stringify({ engine, w, errors, fail: e.message }))
  process.exitCode = 1
} finally {
  await browser.close()
}
