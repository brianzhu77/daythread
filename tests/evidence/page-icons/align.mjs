// P1-3's alignment: an icon lines up with the title and leaves a row's words where they were. The gate doesn't measure these. The day's icon goes above its date (§7.2), and Esc returns focus to the icon.
// Usage: node tests/evidence/page-icons/align.mjs <base-url> <store-path> [chromium|webkit]  (a throwaway store the server uses, never his data)
import * as pw from '@playwright/test'
import { execSync } from 'node:child_process'
const [base, S, engine = 'chromium'] = process.argv.slice(2)
if (!base || !S) { console.error('Usage: node tests/evidence/page-icons/align.mjs <base-url> <store-path> [chromium|webkit]'); process.exit(2) }
execSync(`rm -f ${S} ${S}-wal ${S}-shm && node --no-warnings tests/evidence/page-icons/seed.ts ${S}`, { stdio: 'ignore' })
const browser = await pw[engine].launch({ headless: true })
let fails = 0
const check = (ok, what, extra) => { if (!ok) fails++; console.log(ok ? 'PASS' : 'FAIL', what, extra === undefined ? '' : JSON.stringify(extra)) }
const today = new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Vancouver' }).format(new Date())
const open = async (width, url) => { const c = await browser.newContext({ viewport: { width, height: 800 }, serviceWorkers: 'block', ...(width < 500 ? { hasTouch: true } : {}) }), p = await c.newPage(); await p.goto(base + url); await p.waitForTimeout(2000); return { c, p, wait: ms => p.waitForTimeout(ms) } }
const treeX = p => p.evaluate(() => Object.fromEntries([...document.querySelectorAll('.tree-row')].map(r => { const t = r.querySelector('.tree-title'), words = document.createTreeWalker(t, NodeFilter.SHOW_TEXT), texts = []; while (words.nextNode()) if (!words.currentNode.parentElement.closest('.page-emoji')) texts.push(words.currentNode); const range = document.createRange(); range.selectNodeContents(texts.at(-1)); return [texts.at(-1).textContent.trim(), Math.round(range.getBoundingClientRect().x)] })))
const setIcon = async (p, pageId, icon) => { const url = await p.evaluate(() => location.href); void url; execSync(`node --no-warnings tests/evidence/page-icons/set-icon.ts ${S} ${pageId} ${icon}`, { stdio: 'ignore' }); await p.reload(); await p.waitForTimeout(2000) }
// Before and after, on one store.
{ const { c, p } = await open(1280, '/pages?page=notes')
  const before = await treeX(p)
  const noIcon = await p.evaluate(() => [document.querySelector('.page-title-field').getBoundingClientRect().y, document.querySelectorAll('.page-icon').length])
  check(noIcon[1] === 0, 'no icon: nothing in the head', noIcon)
  await setIcon(p, 'notes', '🌿'); await setIcon(p, 'links', '🔗'); await setIcon(p, 'one', '📕'); await setIcon(p, 'books', '📚')
  const after = await treeX(p)
  check(JSON.stringify(before) === JSON.stringify(after), "an icon in the sidebar leaves the row's words where they were", [before, after])
  const head = await p.evaluate(() => { const i = document.querySelector('.page-icon').getBoundingClientRect(), t = document.querySelector('.page-title-field').getBoundingClientRect(); return { dx: t.x - i.x, gap: t.y - i.bottom, h: i.height, title: t.y } })
  check(head.dx === 2 && head.gap >= 0 && head.gap <= 14 && head.h === 52, "the icon's at the title's edge, 2 px back, and just above it", head)
  check(head.title - noIcon[0] === 64 || Math.abs(head.title - noIcon[0] - 54) <= 12, 'the title moves down by the icon', [noIcon[0], head.title])
  // The chip.
  await p.goto(`${base}/pages?page=links`); await p.waitForTimeout(2000)
  const chip = await p.evaluate(() => { const e = document.querySelector('.page-ref .page-emoji').getBoundingClientRect(), t = document.querySelector('.page-ref .page-ref-title').getBoundingClientRect(), r = document.createRange(); r.selectNodeContents(document.querySelector('.page-ref .page-emoji')); const g = r.getBoundingClientRect(); return { gap: t.x - e.right, drawnGap: t.x - g.right, centre: Math.abs((e.y + e.height / 2) - (t.y + t.height / 2)) } })
  check(chip.gap >= 2 && chip.centre <= 2, 'in a [[ chip, there is a gap after the emoji, and it sits on the line', chip)
  // A row.
  await p.goto(`${base}/pages?page=books`); await p.waitForTimeout(2000)
  const row = await p.evaluate(() => { const name = id => document.querySelector(`tr[data-row="${id}"] .database-title-cell`); const a = name('one'), icon = a.querySelector('.database-row-icon').getBoundingClientRect(), cell = a.getBoundingClientRect(), b = name('two'), first = document.createRange(); first.selectNodeContents(b); return { centre: Math.abs((icon.y + icon.height / 2) - (cell.y + cell.height / 2)), x: icon.x - cell.x, plain: first.getBoundingClientRect().x - cell.x } })
  check(row.centre <= 2, "a row's icon is centred on its row", row)
  check(Math.abs(row.x - row.plain) <= 1, 'and starts where a name without one does', row)
  // Esc.
  await p.goto(`${base}/pages?page=notes`); await p.waitForTimeout(2000)
  await p.locator('.page-icon').click(); await p.waitForTimeout(600); await p.keyboard.press('Escape'); await p.waitForTimeout(200)
  check(await p.locator('.icon-picker').count() === 0 && await p.evaluate(() => document.activeElement?.classList.contains('page-icon')), 'Esc closes the picker, and focus is back on the icon')
  // A day.
  await setIcon(p, 'DAY', '☀️'); await p.goto(`${base}/day/${today}`); await p.waitForTimeout(2000)
  const day = await p.evaluate(() => { const i = document.querySelector('.page-icon').getBoundingClientRect(), t = document.querySelector('.day-title').getBoundingClientRect(); return { above: i.bottom <= t.y + 1, y: i.y, gap: t.y - i.bottom, dx: t.x - i.x } })
  check(day.above && day.y >= 16 && day.gap <= 30, 'on a day, the icon is above the date, clear of the top', day)
  await c.close() }
{ const { c, p } = await open(390, `/day/${today}`)
  const day = await p.evaluate(() => { const i = document.querySelector('.page-icon').getBoundingClientRect(), t = document.querySelector('.day-title').getBoundingClientRect(); return { above: i.bottom <= t.y + 1, y: i.y, gap: t.y - i.bottom } })
  check(day.above && day.y >= 16 && day.gap <= 36, 'at 390 too', day)
  await p.screenshot({ path: '/tmp/jazz-icon-run/shots/after-390-day.png' })
  await c.close() }
console.log(fails ? `${fails} FAILED` : 'ALL PASS')
await browser.close()
process.exit(fails ? 1 : 0)
