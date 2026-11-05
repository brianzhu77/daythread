// R4-12 on Timeline in the built app: the bar takes a rule's tint, an open end fades from it, a name off screen and a line at 390 take it too, and a row with no match stays plain.
// Usage: node tests/evidence/timeline/tint.mjs <base-url> <store-path> [chromium|webkit] [shots-dir]  (a throwaway store, never his data)
import * as pw from '@playwright/test'
import { execSync } from 'node:child_process'
const [base, S, engine = 'chromium', shots] = process.argv.slice(2)
if (!base || !S) { console.error('Usage: node tests/evidence/timeline/tint.mjs <base-url> <store-path> [chromium|webkit] [shots-dir]'); process.exit(2) }
const seed = () => execSync(`rm -f ${S} ${S}-wal ${S}-shm && node --no-warnings tests/evidence/timeline/seed.ts ${S} && node --no-warnings tests/evidence/timeline/seed-tint.ts ${S}`, { stdio: 'ignore' })
const browser = await pw[engine].launch({ headless: true })
let fails = 0
const check = (ok, what, extra) => { if (!ok) fails++; console.log(ok ? 'PASS' : 'FAIL', what, extra === undefined ? '' : JSON.stringify(extra)) }
for (const scheme of ['light', 'dark']) {
  seed()
  const page = await (await browser.newContext({ viewport: { width: 1280, height: 800 }, colorScheme: scheme, serviceWorkers: 'block' })).newPage()
  const errors = []; page.on('pageerror', e => { if (!/access control checks|ResizeObserver/.test(e.message)) errors.push(e.message) })
  const wait = ms => page.waitForTimeout(ms), lane = id => page.locator(`.database-bar-lane[data-row="${id}"]`)
  const bg = l => l.evaluate(e => getComputedStyle(e).backgroundColor)
  const tintOf = name => page.evaluate(n => { const d = document.createElement('div'); d.style.background = `var(--tint-${n})`; document.body.append(d); const c = getComputedStyle(d).backgroundColor; d.remove(); return c }, name)
  const contrast = l => l.evaluate(e => { const lum = c => { const m = c.match(/[\d.]+/g).map(Number).slice(0, 3).map(v => { v /= 255; return v <= .03928 ? v / 12.92 : ((v + .055) / 1.055) ** 2.4 }); return .2126 * m[0] + .7152 * m[1] + .0722 * m[2] }; const a = lum(getComputedStyle(e).backgroundColor), b = lum(getComputedStyle(e.querySelector('.database-bar-title') ?? e).color); return Math.round((Math.max(a, b) + .05) / (Math.min(a, b) + .05) * 10) / 10 })
  await page.goto(`${base}/pages?page=plans`); await wait(2500)
  const [blue, green] = [await tintOf('blue'), await tintOf('green')]
  const call = lane('call').locator('.database-bar'), trip = lane('trip').locator('.database-bar'), running = lane('run').locator('.database-bar')
  check(await bg(call) === blue, `${scheme}: a bar takes its rule's tint`, await bg(call))
  check(await bg(trip) === green, `${scheme}: another rule, another tint`, await bg(trip))
  check(await bg(running) !== blue && await bg(running) !== green, `${scheme}: a bar with no match stays grey`, await bg(running))
  const ratio = await contrast(call)
  check(ratio >= 4.5, `${scheme}: its title stays readable`, ratio)
  await call.hover(); await wait(150)
  check(await call.evaluate(e => getComputedStyle(e).backgroundImage !== 'none'), `${scheme}: a hover still shows on the tint`)
  await page.mouse.move(5, 5)
  if (scheme === 'light') { if (shots) await page.screenshot({ path: `${shots}/${engine}-bars.png` }) }
  // An open end fades from the tint.
  await page.locator('.database-more-button').first().click(); await wait(300); await page.locator('.database-menu').getByRole('menuitem', { name: 'Layout' }).click(); await wait(300)
  await page.locator('.database-menu').locator('label.database-menu-row', { hasText: 'Show timeline by' }).locator('select').selectOption({ label: 'From' }); await wait(600)
  await page.locator('.database-menu').getByLabel('End', { exact: true }).selectOption({ label: 'To' }); await wait(600); await page.keyboard.press('Escape'); await wait(300)
  const open = lane('call').locator('.database-bar')
  const image = await open.evaluate(e => [e.className, getComputedStyle(e).backgroundImage])
  check(image[0].includes('is-open-end') && image[1].includes('gradient') && image[1].includes(blue.replace(/\)$/, '')), `${scheme}: an open end fades from the tint`, image)
  // A name off screen, and one with no date.
  await page.locator('.database-more-button').first().click(); await wait(300); await page.locator('.database-menu').getByRole('menuitem', { name: 'Layout' }).click(); await wait(300)
  await page.locator('.database-menu').locator('label.database-menu-row', { hasText: 'Show timeline by' }).locator('select').selectOption({ label: 'When' }); await wait(600); await page.keyboard.press('Escape'); await wait(300)
  await page.locator('.database-undated-head').click(); await wait(300)
  const undated = page.locator('.database-bar-off.is-name', { hasText: 'No dates yet' })
  check(await bg(undated) === blue, `${scheme}: a row with no date shows the tint on its name`, await bg(undated))
  check(errors.length === 0, `${scheme}: no page errors`, errors)
  if (scheme === 'dark' && shots) await page.screenshot({ path: `${shots}/${engine}-bars-dark.png` })
  await page.context().close()
}
// At 390 it's a line.
seed()
const phone = await (await browser.newContext({ viewport: { width: 390, height: 844 }, hasTouch: engine === 'chromium', serviceWorkers: 'block' })).newPage()
await phone.goto(`${base}/pages?page=plans`); await phone.waitForTimeout(2500)
const row = phone.locator('.database-week-row[data-row="call"]')
const expected = await phone.evaluate(() => { const d = document.createElement('div'); d.style.background = 'var(--tint-blue)'; document.body.append(d); const c = getComputedStyle(d).backgroundColor; d.remove(); return c })
check(await row.evaluate(e => getComputedStyle(e).backgroundColor) === expected, '390: a line takes the tint')
const plain = await phone.locator('.database-week-row[data-row="run"]').count() ? await phone.locator('.database-week-row[data-row="run"]').evaluate(e => getComputedStyle(e).backgroundColor) : 'rgba(0, 0, 0, 0)'
check(plain === 'rgba(0, 0, 0, 0)', '390: a line with no match stays plain', plain)
if (shots) await phone.screenshot({ path: `${shots}/${engine}-weeks.png` })
console.log(fails ? `${fails} FAILED` : 'ALL PASS')
await browser.close()
process.exit(fails ? 1 : 0)
