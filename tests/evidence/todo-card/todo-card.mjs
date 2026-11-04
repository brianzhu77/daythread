// A card keeps its column's width whatever its title (a regression from #88), and a to-do's box sits on its title's first line, on a board and a gallery.
// Usage: node tests/evidence/todo-card/todo-card.mjs <base-url> <store-path> <1280|390> [chromium|webkit] [shots-dir]  (a throwaway store the server at <base-url> reads, never his data)
import * as pw from '@playwright/test'
import { execSync } from 'node:child_process'
const [base, storePath, width, engine = 'chromium', shots] = process.argv.slice(2)
if (!base || !storePath || !width) { console.error('Usage: node tests/evidence/todo-card/todo-card.mjs <base-url> <store-path> <1280|390> [chromium|webkit] [shots-dir]'); process.exit(2) }
const wide = width === '1280'
execSync(`rm -f ${storePath} ${storePath}-wal ${storePath}-shm && node tests/evidence/todo-card/seed-todo-card.ts ${storePath}`, { stdio: 'ignore' })
const browser = await pw[engine].launch({ headless: true })
const context = await browser.newContext({ viewport: { width: Number(width), height: wide ? 900 : 844 }, hasTouch: !wide, serviceWorkers: 'block' })
const page = await context.newPage()
const errors = []; page.on('pageerror', e => { if (!/access control checks|ResizeObserver/.test(e.message)) errors.push(e.message) })
let fails = 0
const check = (ok, what, extra) => { if (!ok) fails++; console.log(ok ? 'PASS' : 'FAIL', what, extra === undefined ? '' : JSON.stringify(extra)) }
const wait = ms => page.waitForTimeout(ms)
const shot = async name => { if (shots) await page.screenshot({ path: `${shots}/${engine}-${width}-${name}.png` }) }
const tap = l => wide ? l.click() : l.tap()
const block = page.locator('.database-block').first(), menu = page.locator('.database-menu')
const layout = async name => { await tap(block.locator('.database-more-button')); await wait(300); await tap(menu.getByRole('menuitem', { name: 'Layout' })); await wait(300); await tap(menu.getByRole('menuitemradio', { name })); await wait(700); if (await menu.getByRole('menuitem', { name: 'Status' }).count()) { await tap(menu.getByRole('menuitem', { name: 'Status' }).first()); await wait(600) } await page.keyboard.press('Escape'); await wait(250); if (await menu.count()) { await page.locator('.database-menu-scrim').click({ position: { x: 5, y: 5 } }).catch(() => {}); await wait(250) } }
const fit = selector => page.evaluate(s => [...document.querySelectorAll(s)].map(card => { const col = card.closest('.database-column').getBoundingClientRect(), c = card.getBoundingClientRect(), t = card.querySelector('.database-card-title'), r = document.createRange(); r.selectNodeContents(t); return { over: Math.round(c.width - col.width), titleOver: Math.round(r.getBoundingClientRect().right - c.right), lines: r.getClientRects().length } }), selector)
const onFirstLine = (card, title) => page.evaluate(([c, t]) => [...document.querySelectorAll(c)].filter(e => e.querySelector('.property-checkbox')).map(e => { const box = e.querySelector('.property-checkbox').getBoundingClientRect(), tt = e.querySelector(t), r = document.createRange(); r.selectNodeContents(tt); const line = r.getClientRects()[0]; return { same: Math.abs((box.top + box.height / 2) - (line.top + line.height / 2)) <= 3, right: box.right <= line.left } }), [card, title])

await page.goto(`${base}/pages?page=books`); await wait(2500)
const cards = await fit('.database-column .database-card')
check(cards.some(c => c.lines > 1), 'a long title runs on to more lines', cards.filter(c => c.lines > 1))
check(cards.length > 0 && cards.every(c => c.over <= 0 && c.titleOver <= 0), 'an ordinary card keeps its column width, a long title wrapped', cards.filter(c => c.over > 0 || c.titleOver > 0))
await shot('board')
await page.goto(`${base}/pages?page=todos`); await wait(2500)
await layout('Board')
const todoCards = await fit('.database-column .database-card')
check(todoCards.length === 2 && todoCards.every(c => c.over <= 0 && c.titleOver <= 0), 'so does a to-do card', todoCards)
const boardLine = await onFirstLine('.database-column .database-card', '.database-card-title')
check(boardLine.length === 2 && boardLine.every(l => l.same && l.right), "a board's box sits on its title's first line", boardLine)
await shot('todo-board')
const tick = page.locator('.database-column .database-card .property-checkbox').first()
await tap(tick); await wait(900)
check(await page.getByText('Done', { exact: true }).count() > 0 && page.url().includes('page=todos'), 'the box still ticks, and opens nothing')
await layout('Gallery')
const galleryLine = await onFirstLine('.database-gallery-card', '.database-gallery-title')
check(galleryLine.length >= 1 && galleryLine.every(l => l.same && l.right), "a gallery's too", galleryLine)
await shot('todo-gallery')
check(errors.length === 0, 'no page errors', errors)
console.log(fails ? `${fails} FAILED` : 'ALL PASS')
await browser.close()
process.exit(fails ? 1 : 0)
