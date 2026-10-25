// B27: screenshots for Jazz's design check (the `@` list's three states, a future day's events, the strip) at 390.
//   node tests/evidence/b27/design-shots.mjs <base> <out dir>   (fresh store from seed.ts; it types)
import * as pw from '@playwright/test'
const [base, out] = process.argv.slice(2)
if (!base || !out || new URL(base).hostname !== '127.0.0.1' || new URL(base).port === '3000') throw Error('Use a disposable loopback server')
const today = new Date().toLocaleDateString('en-CA', { timeZone: 'America/Vancouver' })
const browser = await pw.webkit.launch(), p = await browser.newPage({ viewport: { width: 390, height: 844 }, hasTouch: true })
await p.goto(`${base}/day/${today}`, { waitUntil: 'networkidle' }); await p.waitForTimeout(1200)
const later = p.getByRole('button', { name: 'Later', exact: true }); if (await later.count()) await later.tap()
await p.locator(`.bn-block-outer[data-id="day:${today}:good-stuffs:template:0"] .bn-inline-content`).tap(); await p.waitForTimeout(300)
const shot = async name => { const m = await p.locator('.date-menu').boundingBox(); const y = Math.max(0, (m?.y ?? 300) - 80); await p.screenshot({ path: `${out}/${name}.png`, clip: { x: 0, y, width: 390, height: Math.min(844 - y, (m?.height ?? 200) + 140) } }) }
await p.keyboard.type('PAC Lunch @'); await p.waitForTimeout(300); await shot('picker-empty-390')
await p.keyboard.type('nov'); await p.waitForTimeout(300); await shot('picker-keep-typing-390')
await p.keyboard.type(' 20 12pm'); await p.waitForTimeout(300); await shot('picker-reading-390')
await p.keyboard.press('Escape')
await p.goto(`${base}/day/2026-11-20`, { waitUntil: 'networkidle' }); await p.waitForTimeout(1000)
await p.screenshot({ path: `${out}/future-day-390.png` })
await browser.close()
