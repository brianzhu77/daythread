// B21-18 the look, in the built app, on a fresh store from b21/seed.ts: lines keep their columns, the label shows by hover and by caret with
// nothing shifting, a phone can tap it, the empty block's placeholder, and "↻ Sync unavailable" with Retry. check-alignment measures the geometry.
// Usage: node tests/evidence/b21/look.mjs <base-url> <store-path> <1280|390> [chromium|webkit] [shots-dir]  (a throwaway store the server at <base-url> uses)
import * as pw from '@playwright/test'
import { execSync } from 'node:child_process'
const [base, storePath, width, engine = 'chromium', shots] = process.argv.slice(2)
if (!base || !storePath || !width) { console.error('Usage: node tests/evidence/b21/look.mjs <base-url> <store-path> <1280|390> [chromium|webkit] [shots-dir]'); process.exit(2) }
const wide = width === '1280'
const seed = () => execSync(`rm -f ${storePath} ${storePath}-wal ${storePath}-shm && node --no-warnings tests/evidence/b21/seed.ts ${storePath}`, { stdio: 'ignore' })
seed()
const sql = q => execSync(`sqlite3 ${storePath} "${q}"`, { maxBuffer: 1 << 26 }).toString()
const browser = await pw[engine].launch({ headless: true })
const context = await browser.newContext({ viewport: { width: Number(width), height: wide ? 900 : 844 }, hasTouch: !wide, serviceWorkers: 'block' })
const page = await context.newPage()
const errors = []; page.on('pageerror', e => { if (!/access control checks|ResizeObserver/.test(e.message)) errors.push(e.message) })
let fails = 0
const check = (ok, what, extra) => { if (!ok) fails++; console.log(ok ? 'PASS' : 'FAIL', what, extra === undefined ? '' : JSON.stringify(extra)) }
const wait = ms => page.waitForTimeout(ms)
const shot = async name => { if (shots) await page.screenshot({ path: `${shots}/${engine}-${width}-${name}.png` }) }
const tap = l => wide ? l.click() : l.tap()
const line = words => page.locator('.bn-inline-content', { hasText: words }).first()
const label = page.locator('.synced-label').first()
const opacity = () => label.evaluate(e => getComputedStyle(e).opacity)
const box = async l => { const b = await l.boundingBox(); return { x: b.x, y: b.y } }

await page.goto(`${base}/pages?page=a`); await wait(2500)
check((await box(line('Shared one'))).x === (await box(line('Above on A'))).x, "a line keeps the column it has outside", [await box(line('Shared one')), await box(line('Above on A'))])
check(await opacity() === '0', 'at rest there is no label', await opacity())
await shot('rest')
const before = await box(line('Shared one'))
if (wide) {
  await line('Shared one').hover(); await wait(200)
  check(await opacity() === '1', 'hover shows the label')
  const edge = await label.evaluate(e => getComputedStyle(e.closest('.bn-block')).outlineColor)
  await page.mouse.move(2, 2); await wait(200)
  check(await opacity() === '0' && edge !== await label.evaluate(e => getComputedStyle(e.closest('.bn-block')).outlineColor), 'and the outline darkens with it, and both go')
}
await tap(line('Shared two')); await wait(300)
check(await opacity() === '1', 'the caret inside shows the label')
const after = await box(line('Shared one'))
check(after.x === before.x && Math.abs(after.y - before.y) < 1, 'and nothing shifts', [before, after])
await shot('caret')
await tap(line('Above on A')); await wait(300)
check(await opacity() === '0', 'the caret outside hides it')
await tap(line('Shared two')); await wait(300)
await tap(label.getByRole('button')); await wait(300)
const items = await page.getByRole('menuitem').allInnerTexts()
check(items.includes('Copy') && items.includes('Delete'), 'a tap on the label opens its menu', items)
await shot('menu')
await page.keyboard.press('Escape'); await wait(200)
// A tap on the first line's text places the caret there, not on the label.
const tag = await label.boundingBox(), first = await line('Shared one').boundingBox()
const at = await page.evaluate(([x, y]) => document.elementFromPoint(x, y)?.closest('.synced-label') ? 'label' : 'line', [tag.x + 10, first.y + first.height / 2])
check(at === 'line', "under the label's reach the first line is still the line's", at)

// The empty block's placeholder, when a block has no words.
await page.goto(`${base}/pages?page=b`); await wait(2500)
await tap(line('Below on B')); await page.keyboard.press('End'); await page.keyboard.press('Enter'); await wait(150)
await page.keyboard.type('/Synced'); await wait(500); await page.keyboard.press('Enter'); await wait(700)
const placeholder = await page.evaluate(() => [...document.querySelectorAll('.bn-inline-content')].map(e => getComputedStyle(e, '::before').content).filter(c => c.includes('Empty synced block')).length)
const hint = await page.evaluate(() => [...document.querySelectorAll('.bn-block-content[data-content-type="paragraph"]')].filter(e => /Write|Type/.test(getComputedStyle(e, '::after').content)).length)
check(placeholder === 1 && hint === 0, '/ Synced block reads "Empty synced block", with no other hint over it', [placeholder, hint])
await shot('empty')
await wait(1400)

// Its record can't be read: the block holds its place, with no lines, and Retry; the rest of the page works.
seed()
const data = sql('select data from workspace').trim()
sql(`update workspace set data = json_remove(data, '$.synced')`)
await page.goto(`${base}/pages?page=a`); await wait(2500)
const unavailable = page.locator('.synced-unavailable')
check(await unavailable.count() === 1 && (await unavailable.innerText()).includes('Sync unavailable'), 'with no record it reads "↻ Sync unavailable"', await page.locator('.bn-editor').innerText().catch(() => ''))
check(await unavailable.getByRole('button', { name: 'Retry' }).count() === 1, 'with Retry')
check(await page.locator('.bn-inline-content', { hasText: 'Shared one' }).count() === 0, 'and no lines')
await shot('unavailable')
await tap(line('Below on A')); await page.keyboard.type(' typed'); await wait(1600)
const saved = sql('select data from workspace'); check(saved.includes('typed') && saved.includes('syncedBlock'), "the page's other lines save, and the save keeps the block", (await line('typed').innerText()))
check(await unavailable.count() === 1, 'and the block stays')
await tap(unavailable.getByRole('button', { name: 'Retry' })); await wait(1200)
check(await unavailable.count() === 1, "Retry with the record still gone changes nothing")
check(errors.length === 0, 'no page errors', errors)
console.log(fails ? `${fails} FAILED` : 'ALL PASS')
await browser.close()
process.exit(fails ? 1 : 0)
