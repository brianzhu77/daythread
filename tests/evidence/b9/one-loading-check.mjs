// B9 check: a cold open says one thing while it loads ("Loading your day…") and never flashes "Opening your page…" or
// "No page … yet · Start this page" on the way. Records every such text from the first paint, for a brand-new day
// (the page is made on open) and for a reload of that day. Run against an isolated server on a fresh store, never live.
// Modes "hang" and "cut" hold or fail the page-making request: the loading line must give way to the Start state (by
// about 6 s when it hangs, at once when it fails), never load with no end, and a late reply still opens the page.
// Usage: node tests/evidence/b9/one-loading-check.mjs <base-url> [webkit|chromium] [390|1280] [hang|cut]
import assert from 'node:assert/strict'
import * as pw from '@playwright/test'
const [base, engine = 'webkit', width = '390', mode = ''] = process.argv.slice(2)
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
  if (mode) {
    // Hold or fail only the page-making command (ensure-day), on a brand-new day.
    await page.route('**/*', async route => {
      const req = route.request()
      if (req.method() === 'POST' && (req.postData() ?? '').includes('ensure-day')) {
        if (mode === 'cut') return route.abort('internetdisconnected')
        await new Promise(r => setTimeout(r, 12000))
      }
      return route.fallback()
    })
    const t0 = Date.now()
    await page.goto(base, { waitUntil: 'domcontentloaded' })
    await page.waitForSelector('text=Start this page', { timeout: 10000 })
    const startAfter = Date.now() - t0
    assert.ok(mode === 'cut' ? startAfter < 4000 : startAfter > 4500 && startAfter < 9000, `Start state after ${startAfter} ms`)
    if (mode === 'hang') {
      // He taps Start while the first request is still out (Bumblebee d1a7be5b): one page for the day, not two.
      await page.getByRole('button', { name: 'Start this page' }).click()
      await page.waitForSelector('.bn-editor', { timeout: 15000 })
      assert.equal(await page.locator('text=Start this page').count(), 0, 'the late reply opens the page')
      await page.waitForTimeout(1500)
      if (process.env.DB) {
        const { DatabaseSync } = await import('node:sqlite')
        const db = new DatabaseSync(process.env.DB, { readOnly: true })
        const today = await page.evaluate(() => new Date().toLocaleDateString('en-CA'))
        const rows = db.prepare("select count(*) as n from pages where type = 'daily' and date = ?").get(today)
        assert.equal(rows.n, 1, `one ${today} page after Start during the hang (got ${rows.n})`)
      }
    }
    console.log(JSON.stringify({ engine, w, mode, startAfter, seen: await page.evaluate(() => window.__seen), pass: true }))
    process.exit(0)
  }
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
