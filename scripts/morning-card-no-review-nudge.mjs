// B37 check: the morning card no longer nudges toward an unfinished review; the Review pill stays.
// Run against an isolated server whose store has an earlier day with an unsaved review (a disposable copy, never live).
// Usage: node scripts/morning-card-no-review-nudge.mjs <base-url> [chromium|webkit]
import assert from 'node:assert/strict'
import * as pw from '@playwright/test'
const base = process.argv[2] ?? 'http://127.0.0.1:3043'
const engine = process.argv[3] ?? 'chromium'
const browser = await pw[engine].launch({ headless: true })
try {
  for (const width of [1280, 390]) {
    const phone = width < 900
    const page = await browser.newPage({ viewport: { width, height: phone ? 844 : 900 }, hasTouch: phone })
    const errors = []
    page.on('pageerror', e => errors.push(e.message))
    await page.goto(base, { waitUntil: 'networkidle' })
    const card = page.locator('section.start-the-day')
    await card.waitFor({ state: 'visible', timeout: 30000 })
    const text = await card.innerText()
    assert(!/review wasn.t finished/i.test(text), `card still nudges: ${text.split('\n').find(l => /review/i.test(l))}`)
    assert.equal(await card.locator('a[href^="/review"]').count(), 0)
    assert.equal(await page.locator('a.review-entry').count(), 1)
    assert.deepEqual(errors, [])
    console.log(JSON.stringify({ engine, width, cardFirstLine: text.split('\n')[1], reviewNudge: 'none', reviewPill: 'present' }))
    await page.close()
  }
} finally {
  await browser.close()
}
