// B86's header in the built app: from Bookmarks `‹ Bookmarks | day`, tapping the day lands on the card, the way back returns to the same place in the list, the same path
// from everywhere else without the way back, long paths fold with nothing cut, a day has no path, a sub-item goes through its parents and stops at one in Trash.
// Usage: node tests/evidence/references/header.mjs <base-url> <store-path> [chromium|webkit] [shots-dir]  (a throwaway store, never his data)
import * as pw from '@playwright/test'
import { execSync } from 'node:child_process'
const [base, storePath, engine = 'chromium', shots] = process.argv.slice(2)
if (!base || !storePath) { console.error('Usage: node tests/evidence/references/header.mjs <base-url> <store-path> [chromium|webkit] [shots-dir]'); process.exit(2) }
execSync(`rm -f ${storePath} ${storePath}-wal ${storePath}-shm && TZ=America/Vancouver node --no-warnings tests/evidence/references/seed.ts ${storePath}`, { stdio: 'ignore' })
const browser = await pw[engine].launch({ headless: true })
let fails = 0
const check = (ok, what, extra) => { if (!ok) fails++; console.log(ok ? 'PASS' : 'FAIL', what, extra === undefined ? '' : JSON.stringify(extra)) }
for (const [width, height, label] of [[1280, 800, '1280'], [390, 844, '390']]) {
  const context = await browser.newContext({ viewport: { width, height }, serviceWorkers: 'block', ...(width === 390 && engine === 'chromium' ? { hasTouch: true } : {}) })
  const page = await context.newPage()
  const errors = []; page.on('pageerror', e => { if (!/access control checks|ResizeObserver/.test(e.message)) errors.push(e.message) })
  const wait = ms => page.waitForTimeout(ms)
  const go = async path => { await page.goto(base + path); await wait(1900) }
  const crumbs = async () => (await page.locator('.crumbs-path').first().innerText({ timeout: 800 }).catch(() => '')).replace(/\s+/g, ' ').trim()
  const linked = async () => (await page.locator('.linked-from').first().innerText({ timeout: 300 }).catch(() => '')).replace(/\s+/g, ' ').trim()
  const shot = async name => { if (shots) await page.screenshot({ path: `${shots}/${engine}-${label}-${name}.png` }) }
  const say = what => `${label}: ${what}`
  // (1) From the list: the way back, the day, a landing on the card, and the same place in the list.
  await go('/pages?view=bookmarks')
  const row = page.locator('[data-bookmark="dan"]')
  await row.scrollIntoViewIfNeeded(); await wait(200)
  await row.locator('a, button').first().click(); await wait(1500)
  check(/from=bookmarks/.test(page.url()) && await crumbs() === 'Bookmarks Tue, Nov 3', say('opened from Bookmarks, the header reads ‹ Bookmarks | the day'), await crumbs())
  check(await page.locator('.crumbs .crumb-divider').count() === 1 && await page.locator('.crumbs-path .crumb-sep').count() === 0, say('with a line between them, not a chevron'))
  check(await linked() === '', say('and the day isn\'t under Linked from as well'), await linked())
  await shot('from-bookmarks')
  await page.locator('.crumbs .crumb-back').click(); await wait(1300)
  check(/view=bookmarks/.test(page.url()) && await page.locator('[data-bookmark="dan"]').evaluate(e => { const r = e.getBoundingClientRect(); return r.top >= 0 && r.bottom <= innerHeight }), say('‹ Bookmarks returns to the list with that row in view'), page.url())
  const far = page.locator('[data-bookmark="many3"]')
  await far.scrollIntoViewIfNeeded(); await wait(200)
  await far.locator('a, button').first().click(); await wait(1300)
  await page.reload(); await wait(1900)
  await page.locator('.crumbs .crumb-back').click(); await wait(1300)
  check(await far.evaluate(e => { const r = e.getBoundingClientRect(); return r.top >= 0 && r.bottom <= innerHeight }) && await page.evaluate(() => scrollY) > 0, say('and a row far down the list too, even after the page reloads'), await page.evaluate(() => scrollY))
  await go('/pages?page=dan&from=bookmarks')
  await page.locator('.crumbs .crumb-last').click(); await wait(500)
  const flash = await page.locator('.block-flash').count(), cardIn = await page.locator('[data-node-type="blockContainer"]', { hasText: 'DAN KOE' }).first().evaluate(e => { const r = e.getBoundingClientRect(); return r.top >= 0 && r.bottom <= innerHeight })
  check(/\/day\/2026-11-03/.test(page.url()) && flash === 1 && cardIn, say('tapping the day lands on the card, marked'), { url: page.url(), flash, cardIn })
  await shot('landed')
  // (2) The same path from anywhere else, with no way back.
  await go('/pages?page=dan')
  check(await crumbs() === 'Tue, Nov 3' && await page.locator('.crumbs .crumb-back').count() === 0, say('from anywhere else: the same day, no ‹ Bookmarks'), await crumbs())
  await go('/pages?page=dan&from=search')
  check(await crumbs() === 'Tue, Nov 3', say('from Search too'), await crumbs())
  // (3) A long path, with nothing cut.
  await go('/pages?page=heads')
  const fits = await page.locator('.crumbs-path').first().evaluate(el => { const nav = el.getBoundingClientRect(); return { over: el.scrollWidth > el.clientWidth + 1, cut: [...el.querySelectorAll('.crumb')].filter(c => c.getBoundingClientRect().right > nav.right + 1).length, noMark: [...el.querySelectorAll('.crumb-words')].filter(w => w.scrollWidth > w.clientWidth + 1 && getComputedStyle(w).textOverflow !== 'ellipsis').length } })
  check(!fits.over && fits.cut === 0 && fits.noMark === 0, say('a long path fits, with nothing cut off unmarked'), { ...fits, crumbs: await crumbs() })
  if (width === 390) {
    check((await crumbs()).includes('…'), say('and its middle folds'), await crumbs())
    await page.locator('.crumbs-path .crumb-more').click(); await wait(300)
    const hidden = (await page.getByRole('menuitem').allInnerTexts()).join()
    check(hidden.includes('Design notes') && hidden.includes('Daythread'), say('with every level still reachable'), hidden)
  }
  await shot('deep')
  await go('/pages?page=heads&from=bookmarks')
  const backFits = await page.locator('.crumbs-path').first().evaluate(el => el.scrollWidth <= el.clientWidth + 1)
  check(backFits && (await crumbs()).startsWith('Bookmarks'), say('with the way back as well'), await crumbs())
  await shot('deep-from-bookmarks')
  // (4) A day, a row, a sub-item.
  await go('/day/2026-11-03')
  check(await page.locator('.crumbs-path').count() === 0, say('a day has no path'))
  check((await linked()).includes('Projects'), say('and what links to it is under its date'), await linked())
  await go('/pages?page=other')
  check((await crumbs()).endsWith('Work'), say('a row\'s path ends in its database'), await crumbs())
  await go('/pages?page=copy')
  const sub = await page.locator('.crumbs-path').first().evaluate(el => el.innerText.replace(/\s+/g, ' ').trim())
  check(width === 390 ? sub.endsWith('Build the site') : sub.endsWith('Work Launch the app Build the site'), say('a sub-item\'s goes on through its parent rows'), sub)
  await go('/pages?page=leaf')
  check((await crumbs()).endsWith('Middle row') && !(await crumbs()).includes('Gone parent'), say('stopping at one in Trash'), await crumbs())
  // (5) The other day it's saved on.
  await go('/pages?page=twice')
  check(await crumbs() === 'Sun, Oct 25' && (await linked()).includes('Tue, Nov 3'), say('saved on two days: the first in the header, the second under Linked from'), [await crumbs(), await linked()])
  check(errors.length === 0, say('no page errors'), errors)
  await context.close()
}
console.log(fails ? `${fails} FAILED` : 'ALL PASS')
await browser.close()
process.exit(fails ? 1 : 0)
