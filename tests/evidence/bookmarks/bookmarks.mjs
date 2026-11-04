// B83: the entry, the list, the row and its ↗, the way back, Trash and Undo, in the built app.
// Usage: node tests/evidence/bookmarks/bookmarks.mjs <base-url> <store-path> [chromium|webkit]  (a throwaway store the server at <base-url> uses)
import * as pw from '@playwright/test'
import { execSync } from 'node:child_process'
const [base, S, engine = 'chromium'] = process.argv.slice(2)
if (!base || !S) { console.error('Usage: node tests/evidence/bookmarks/bookmarks.mjs <base-url> <store-path> [chromium|webkit]'); process.exit(2) }
const store = () => JSON.parse(execSync(`sqlite3 ${S} "select data from workspace"`, { maxBuffer: 1 << 26 }).toString())
const wait = ms => new Promise(r => setTimeout(r, ms))
const browser = await pw[engine].launch({ headless: true })
const wide = { viewport: { width: 1280, height: 900 } }, phone = { viewport: { width: 390, height: 780 }, hasTouch: true }
let failed = 0
const scenario = async (name, seed, act, options = wide) => {
  execSync(`rm -f ${S} ${S}-wal ${S}-shm && node --no-warnings tests/evidence/bookmarks/seed.ts ${S} ${seed}`, { stdio: 'ignore' })
  const context = await browser.newContext(options), page = await context.newPage(), errors = []
  page.on('pageerror', e => { if (!/ResizeObserver loop/.test(e.message)) errors.push(e.message) })
  let r
  try { r = await act(page, context) } catch (e) { r = { ok: false, threw: e.message.split('\n').slice(0, 3).join(' ') } }
  const ok = r.ok && !errors.length
  if (!ok) failed++
  console.log(ok ? 'PASS' : 'FAIL', name, JSON.stringify({ ...r, errors }))
  if (process.env.SHOTS) await page.screenshot({ path: `${process.env.SHOTS}/${name.replace(/\W+/g, '-').slice(0, 30)}-${engine}-${options.viewport.width}.png` }).catch(() => {})
  await context.close()
}
const rows = page => page.locator('.bookmark-title').allInnerTexts()
await scenario('No bookmarks: no entry at either width, and an old address says so', 'empty', async page => {
  await page.goto(`${base}/pages`); await wait(1800)
  const r = { side: await page.locator('.sidebar .side-row', { hasText: 'Bookmarks' }).count(), row: await page.locator('.pages-bookmarks-row').count() }
  await page.goto(`${base}/pages?view=bookmarks`); await wait(1500)
  r.text = await page.locator('.list-screen').innerText()
  r.ok = r.side === 0 && r.row === 0 && /No bookmarks yet/.test(r.text)
  return r
})
await scenario('The list: newest first, title, first words, where it came from; the host left out at a default title', '', async page => {
  await page.goto(`${base}/pages`); await wait(1800)
  await page.locator('.sidebar .side-row', { hasText: 'Bookmarks' }).click(); await wait(1000)
  const r = { url: page.url(), rows: await rows(page), words: await page.locator('.bookmark-words').allInnerTexts(), where: await page.locator('.bookmark-where').allInnerTexts(), current: await page.locator('.sidebar .side-row[aria-current=page]').allInnerTexts() }
  r.ok = /view=bookmarks/.test(r.url) && r.rows[0] === 'DAN KOE (@thedankoe) on X' && r.rows.length === 3 && r.words.join().includes('How to fix') && r.where[0].startsWith('x.com · ') && r.current.join() === 'Bookmarks'
  return r
})
await scenario('A row opens the page with the way back in its crumb; ↗ opens the site and not the row; the same page from its day keeps its own crumb', '', async (page, context) => {
  await page.goto(`${base}/pages?view=bookmarks`); await wait(1800)
  const [site] = await Promise.all([context.waitForEvent('page'), page.locator('.bookmark-row').first().locator('.bookmark-open').click()])
  const r = { siteUrl: site.url(), stayed: page.url() }
  await site.close()
  await page.locator('.bookmark-main').first().click(); await wait(1500)
  r.opened = page.url(); r.crumb = await page.locator('.crumbs-path').innerText()
  await page.locator('.crumbs-path').getByText('Bookmarks').click(); await wait(1000)
  r.back = page.url(); r.listed = (await rows(page)).length
  await page.goto(`${base}/pages?page=dan`); await wait(1500)
  r.own = await page.locator('.crumbs-path').innerText()
  r.ok = /x\.com/.test(r.siteUrl) && /view=bookmarks/.test(r.stayed) && /page=dan&from=bookmarks/.test(r.opened) && r.crumb.trim() === 'Bookmarks' && /view=bookmarks/.test(r.back) && r.listed === 3 && !/Bookmarks/.test(r.own)
  return r
})
await scenario('Trash from a page opened here comes back here, gone from the list; Undo returns it; the card on its day stays', '', async page => {
  await page.goto(`${base}/pages?page=dan&from=bookmarks`); await wait(1800)
  await page.locator('.page-more').first().click(); await wait(200)
  await page.getByRole('menuitem', { name: 'Delete' }).click(); await wait(1500)
  const r = { at: page.url(), rows: await rows(page) }
  await page.getByRole('button', { name: 'Undo' }).first().click(); await wait(1500)
  r.back = await rows(page)
  r.ok = /view=bookmarks/.test(r.at) && !r.rows.includes('DAN KOE (@thedankoe) on X') && r.back.includes('DAN KOE (@thedankoe) on X')
  return r
})
await scenario('Trashing the last one: the list says so, and the entry goes', '', async page => {
  await page.goto(`${base}/pages?view=bookmarks`); await wait(1500)
  for (const id of ['dan', 'kept', 'bare']) {
    await page.goto(`${base}/pages?page=${id}&from=bookmarks`); await wait(1400)
    await page.locator('.page-more').first().click(); await wait(200)
    await page.getByRole('menuitem', { name: 'Delete' }).click(); await wait(1200)
  }
  const r = { text: await page.locator('.list-screen').innerText(), side: await page.locator('.sidebar .side-row', { hasText: 'Bookmarks' }).count() }
  r.ok = /No bookmarks yet/.test(r.text) && r.side === 0
  return r
})
await scenario('390: a row at the top of Pages with the count; ↗ is a 44 px target; nothing past the edge; the way back works', '', async page => {
  await page.goto(`${base}/pages`); await wait(1800)
  const row = page.locator('.pages-bookmarks-row')
  const r = { label: await row.innerText(), first: await page.locator('.list-screen > *').nth(1).getAttribute('class') }
  await row.click(); await wait(1000)
  const box = await page.locator('.bookmark-open').first().boundingBox()
  r.size = [box.width, box.height]; r.overflow = await page.evaluate(() => document.documentElement.scrollWidth - innerWidth)
  await page.locator('.bookmark-main').first().click(); await wait(1500)
  await page.locator('.crumbs-path').getByText('Bookmarks').click(); await wait(800)
  r.back = page.url()
  r.ok = /Bookmarks · 3/.test(r.label) && /pages-bookmarks-row/.test(r.first) && r.size[0] >= 44 && r.size[1] >= 44 && r.overflow <= 0 && /view=bookmarks/.test(r.back)
  return r
}, phone)
for (const [label, options] of [['390', phone], ['1280', wide]]) await scenario(`${label}: back by the crumb lands on the row just left, not at the top`, 'many', async page => {
  await page.goto(`${base}/pages?view=bookmarks`); await wait(1800)
  const row = page.locator('.bookmark-main', { hasText: 'Bookmark number 3' }).first()
  await row.scrollIntoViewIfNeeded(); await wait(200)
  const before = (await row.boundingBox()).y
  await row.click(); await wait(1400)
  await page.locator('.crumbs-path').getByText('Bookmarks').click(); await wait(1000)
  const after = await page.locator('.bookmark-main', { hasText: 'Bookmark number 3' }).first().boundingBox()
  const height = page.viewportSize().height
  const r = { before: Math.round(before), after: Math.round(after.y), height, scrolled: await page.evaluate(() => Math.round(document.scrollingElement?.scrollTop ?? 0)) }
  r.ok = after.y > 0 && after.y < height - 60
  return r
}, options)
await browser.close()
console.log(failed ? `${failed} FAILED` : 'ALL PASS')
process.exit(failed ? 1 : 0)
