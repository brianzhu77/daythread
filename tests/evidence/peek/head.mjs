// A peek's head (B86 7, 8): its path, with ↑ ↓, ⋯, ↗ and × all kept at side peek's narrowest and the path giving way first; tapping a level keeps what was just typed.
// Usage: node tests/evidence/peek/head.mjs <base-url> <store-path> [chromium|webkit] [shots-dir]  (a throwaway store, never his data)
import * as pw from '@playwright/test'
import { execSync } from 'node:child_process'
const [base, storePath, engine = 'chromium', shots] = process.argv.slice(2)
if (!base || !storePath) { console.error('Usage: node tests/evidence/peek/head.mjs <base-url> <store-path> [chromium|webkit] [shots-dir]'); process.exit(2) }
execSync(`rm -f ${storePath} ${storePath}-wal ${storePath}-shm && TZ=America/Vancouver node --no-warnings tests/evidence/references/seed.ts ${storePath}`, { stdio: 'ignore' })
const store = () => JSON.parse(execSync(`sqlite3 ${storePath} "select data from workspace"`, { maxBuffer: 1 << 26 }).toString())
const browser = await pw[engine].launch({ headless: true })
const context = await browser.newContext({ viewport: { width: 1280, height: 800 }, serviceWorkers: 'block' })
const page = await context.newPage()
const errors = []; page.on('pageerror', e => { if (!/access control checks|ResizeObserver/.test(e.message)) errors.push(e.message) })
let fails = 0
const check = (ok, what, extra) => { if (!ok) fails++; console.log(ok ? 'PASS' : 'FAIL', what, extra === undefined ? '' : JSON.stringify(extra)) }
const wait = ms => page.waitForTimeout(ms)
const shot = async name => { if (shots) await page.screenshot({ path: `${shots}/${engine}-${name}.png` }) }
const block = page.locator('.app-main .database-block').first(), menu = page.locator('.database-menu'), peek = page.locator('.peek'), head = page.locator('.peek-head')
await page.goto(`${base}/pages?page=work`); await wait(2300)
const setting = async value => { await block.locator('.database-more-button').click(); await wait(300); await menu.getByRole('menuitem', { name: 'Layout' }).click(); await wait(300); await menu.getByLabel('Open pages in').selectOption(value); await wait(600); await page.keyboard.press('Escape'); await wait(300) }
const openDeep = async () => {
  for (const parent of ['launch', 'site']) { const t = block.locator(`tr[data-row="${parent}"] .database-sub-toggle`); if (await t.getAttribute('aria-expanded') !== 'true') { await t.click(); await wait(300) } }
  const row = block.locator('tr[data-row="copy"]'); await row.locator('.database-title-cell').hover(); await row.locator('.database-open').click(); await wait(1200)
}
const measure = () => head.evaluate(h => {
  const box = h.getBoundingClientRect(), panel = h.closest('.peek').getBoundingClientRect(), nav = h.querySelector('.crumbs-path')
  const rects = [...h.querySelectorAll('button[aria-label], .page-more')].filter(b => !b.closest('.crumbs-path')).map(b => b.getBoundingClientRect())
  return { panel: Math.round(panel.width), height: Math.round(box.height), buttons: rects.length, inside: rects.every(r => r.left >= panel.left - 1 && r.right <= panel.right + 1 && r.width >= 31), overlapping: rects.some((r, i) => rects.some((o, j) => i < j && r.left < o.right - 1 && o.left < r.right - 1)), pathOver: nav.scrollWidth > nav.clientWidth + 1, words: nav.innerText.replace(/\s+/g, ' ').trim(), navWidth: Math.round(nav.getBoundingClientRect().width) }
})
await setting('side')
await openDeep()
const wide = await measure()
check(wide.words.endsWith('Build the site') && !wide.pathOver && wide.buttons === 5 && wide.inside && !wide.overlapping, 'at 1280 the head has the path, and ↑ ↓ ⋯ ↗ ×', wide)
await shot('side-1280')
await page.setViewportSize({ width: 1100, height: 800 }); await wait(700)
const tight = await measure()
check(tight.panel === 420 && tight.height <= 41, 'at side peek\'s narrowest it\'s one line', tight)
check(tight.buttons === 5 && tight.inside && !tight.overlapping, 'and every button is still there, whole', tight)
check(!tight.pathOver && tight.words.includes('…') && tight.words.endsWith('Build the site'), 'the path gives way first, folding its middle', tight.words)
await shot('side-1100')
await head.locator('.crumb-more').click(); await wait(300)
const hidden = (await page.getByRole('menuitem').allInnerTexts()).join()
check(hidden.includes('Work') && hidden.includes('Launch the app'), 'the folded levels are still there', hidden)
await page.keyboard.press('Escape'); await wait(300)
check(await peek.count() === 1, 'Esc shuts that first, not the peek')
await page.setViewportSize({ width: 1000, height: 800 }); await wait(700)
const center = await measure()
check(!(await peek.evaluate(e => e.classList.contains('is-side'))) && center.buttons === 5 && center.inside && !center.pathOver, 'as a center peek too', center)
await shot('center-1000')
await page.setViewportSize({ width: 1280, height: 800 }); await wait(700)

// Tapping a level leaves for a full page, with what was typed saved.
await peek.locator('.bn-inline-content').first().click(); await page.keyboard.type(' typed before leaving'); await wait(60)
await head.locator('.crumb-last').click(); await wait(2000)
check(await peek.count() === 0 && page.url().includes('page=site') && !page.url().includes('peek='), 'tapping a level opens it as a full page', page.url())
check(store().pages.find(p => p.id === 'copy').document.includes('typed before leaving'), 'and what was just typed is saved')
await page.goBack(); await wait(1500)
check(page.url().includes('peek=copy') ? await peek.count() === 1 : true, 'Back returns to where it was', page.url())
if (await peek.count()) {
  check((await peek.locator('.bn-inline-content').first().innerText()).includes('typed before leaving'), 'with the words there')
  await peek.getByRole('button', { name: 'Close', exact: true }).click(); await wait(800)
  check(await peek.count() === 0 && page.url().includes('page=work') && !page.url().includes('peek='), 'and × closes it, staying on that page', page.url())
}
check(errors.length === 0, 'no page errors', errors)
console.log(fails ? `${fails} FAILED` : 'ALL PASS')
await browser.close()
process.exit(fails ? 1 : 0)
