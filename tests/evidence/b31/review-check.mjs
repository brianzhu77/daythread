// B31 check: the one-screen evening review on a copy of his row (rev 362: Sat Oct 24 has three open Top 3 tasks).
// Each mode needs a fresh copy, because Done writes. Run against an isolated server, never live.
// Usage: node tests/evidence/b31/review-check.mjs <base-url> <evening|midnight|offline|leave> [webkit|chromium] [390|1280]
import assert from 'node:assert/strict'
import * as pw from '@playwright/test'
const [base, mode, engine = 'webkit', width = '390'] = process.argv.slice(2)
const w = Number(width)
const browser = await pw[engine].launch({ headless: true })
const ctx = await browser.newContext({ viewport: { width: w, height: w < 600 ? 844 : 900 }, timezoneId: 'America/Vancouver', hasTouch: w < 600 })
const page = await ctx.newPage()
const errors = []
page.on('pageerror', e => errors.push(e.message))
const at = iso => page.clock.install({ time: new Date(iso) })
const settle = (ms = 600) => page.waitForTimeout(ms)
const input = page.getByRole('textbox', { name: /Add a to-do for/ })
const listed = () => page.locator('.review-list .task-row .task-title').allTextContents()
const type = async text => { await input.fill(text); await input.press('Enter'); await settle() }
// The day page's outline: headings and to-dos in order, as he sees them.
const outline = () => page.evaluate(() => [...document.querySelectorAll('.bn-block-content[data-content-type="heading"], .bn-block-content[data-content-type="task"]')].map(e => e.textContent.replace(/⋯$/, '').trim()).filter(Boolean))
const card = () => page.getByRole('heading', { name: 'Start the day' }).count()
const geometry = () => page.evaluate(() => [...document.querySelectorAll('.review-list .task-row')].map(row => {
  const title = row.querySelector('.task-title'), box = row.querySelector('.check'), menu = row.querySelector('.row-menu button, .row-menu')
  const range = document.createRange(); range.selectNodeContents(title); const first = [...range.getClientRects()].find(r => r.height) ?? title.getBoundingClientRect()
  const mid = r => r.top + r.height / 2, line = mid(first)
  return { text: title.textContent || title.value || '', check: box ? Math.round(mid(box.getBoundingClientRect()) - line) : null, menu: menu && menu.getBoundingClientRect().height ? Math.round(mid(menu.getBoundingClientRect()) - line) : null }
}))
const out = { mode, engine, width: w }
try {
  if (mode === 'midnight') {
    // 00:40 Sunday, reviewing Saturday: the next day is today by the clock.
    await at('2026-10-25T00:40:00-07:00')
    await page.goto(`${base}/review`, { waitUntil: 'networkidle' }); await settle()
    out.h1 = await page.locator('h1').first().textContent()
    assert.equal(out.h1, 'Today · Sun, Oct 25')
    assert.match(await page.locator('.review-one-sub').textContent(), /^Saturday: 0 done · 3 still open/)
    await type('万圣节装饰、衣服')
    await page.getByRole('button', { name: 'Done' }).click(); await settle(1200)
    await page.goto(`${base}/`, { waitUntil: 'networkidle' }); await settle(1200)
    out.outline = await outline()
    assert.equal(await card(), 0, 'no morning card after Done')
    for (const t of ['TRV for Lu and Kathy', '#daythread bug', '#daythread improvements on link as page', '万圣节装饰、衣服']) assert.equal(out.outline.filter(x => x === t).length, 1, `${t} once`)
  } else {
    await at('2026-10-24T20:00:00-07:00')
    await page.goto(`${base}/review`, { waitUntil: 'networkidle' }); await settle()
    out.h1 = await page.locator('h1').first().textContent()
    assert.equal(out.h1, 'Tomorrow · Sun, Oct 25')
    assert.deepEqual((await listed()).slice(0, 3), ['TRV for Lu and Kathy', '#daythread bug', '#daythread improvements on link as page'], 'in page order')
    // Pinyin: Return while composing confirms the candidate and never adds a line, also when WebKit sends it right
    // after compositionend.
    await input.fill('wan')
    await input.evaluate(el => {
      el.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', keyCode: 229, bubbles: true, cancelable: true }))
      el.dispatchEvent(new CompositionEvent('compositionstart', { bubbles: true }))
      el.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true, cancelable: true, isComposing: true }))
      el.dispatchEvent(new CompositionEvent('compositionend', { bubbles: true, data: '万' }))
      el.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true, cancelable: true }))
    })
    await settle()
    assert.equal((await listed()).length, 4, 'no line added while composing')
    assert.equal(await input.inputValue(), 'wan')
    if (mode === 'offline') {
      await ctx.setOffline(true)
      await type('Kathy 的作业，family culture')
      assert.match(await page.locator('.review-pending').textContent(), /Not added · Retry/)
      await page.getByRole('button', { name: 'Done' }).click(); await settle()
      assert.match(await page.locator('.review-one-head .warn-line').textContent(), /1 line not saved yet/)
      assert.match(page.url(), /\/review/, 'Done stays while a line is unsaved')
      await ctx.setOffline(false); await page.evaluate(() => window.dispatchEvent(new Event('online'))); await settle(1500)
      assert.equal(await page.locator('.review-pending').count(), 0, 'the line saved by itself once online')
      assert.ok((await listed()).includes('Kathy 的作业，family culture'))
      await input.fill('')
    } else {
      await input.fill('')
      await page.getByRole('checkbox', { name: 'Mark #daythread bug done' }).click(); await settle()
      await type('万圣节装饰、衣服')
      await type('Kathy 的作业，family culture')
      out.geometry = await geometry()
      for (const g of out.geometry) {
        assert.ok(g.check === null || Math.abs(g.check) <= 1, `checkbox on first line: ${g.text} ${g.check}`)
        if (w < 600) assert.ok(g.menu === null || Math.abs(g.menu) <= 1, `⋯ on first line: ${g.text} ${g.menu}`)
      }
      await page.screenshot({ path: `/tmp/jazz-b31/check-${mode}-${engine}-${w}.png`, fullPage: true })
    }
    if (mode === 'leave') {
      // Leaves without Done: the morning card carries as before and doesn't offer his added lines again.
      await at('2026-10-25T08:00:00-07:00')
      await page.goto(`${base}/`, { waitUntil: 'networkidle' }); await settle(1200)
      assert.equal(await card(), 1, 'the morning card shows')
      out.card = await page.locator('.mc-title').allTextContents()
      assert.deepEqual(out.card.sort(), ['#daythread improvements on link as page', 'TRV for Lu and Kathy'].sort())
      out.outline = await outline()
      for (const t of ['万圣节装饰、衣服', 'Kathy 的作业，family culture']) assert.equal(out.outline.filter(x => x === t).length, 1, `${t} on Sunday once`)
    } else {
      await page.getByRole('button', { name: 'Done' }).click(); await settle(1500)
      out.after = page.url()
      assert.doesNotMatch(out.after, /\/review/)
      await page.clock.setSystemTime(new Date('2026-10-25T08:00:00-07:00'))
      await page.goto(`${base}/`, { waitUntil: 'networkidle' }); await settle(1200)
      assert.equal(await card(), 0, 'no morning card after Done')
      out.outline = await outline()
      const once = ['TRV for Lu and Kathy', '#daythread improvements on link as page', 'Kathy 的作业，family culture', ...(mode === 'evening' ? ['万圣节装饰、衣服'] : [])]
      for (const t of once) assert.equal(out.outline.filter(x => x === t).length, 1, `${t} once`)
      if (mode === 'evening') assert.equal(out.outline.includes('#daythread bug'), false, 'a ticked task stays behind')
      else assert.equal(out.outline.filter(x => x === '#daythread bug').length, 1, 'an unticked task comes along once')
      const top3 = out.outline.indexOf('TODO - Top 3'), other = out.outline.indexOf('TODO - Other')
      for (const t of ['TRV for Lu and Kathy', '#daythread improvements on link as page']) { const i = out.outline.indexOf(t); assert.ok(i > top3 && i < other, `${t} in Top 3`) }
      assert.ok(out.outline.indexOf('Kathy 的作业，family culture') > other, 'new lines in Other')
      await page.screenshot({ path: `/tmp/jazz-b31/check-${mode}-${engine}-${w}-sunday.png`, fullPage: true })
    }
  }
  assert.deepEqual(errors, [])
  console.log(JSON.stringify({ ...out, pass: true }))
} catch (e) {
  console.log(JSON.stringify({ ...out, errors, fail: e.message }))
  await page.screenshot({ path: `/tmp/jazz-b31/fail-${mode}-${engine}-${w}.png`, fullPage: true })
  process.exitCode = 1
} finally {
  await browser.close()
}
