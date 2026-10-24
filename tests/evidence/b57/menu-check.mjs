// B57: a task's "Another day" choices on today's page, with the browser's clock set to each weekday. Built server,
// sign-in off, a fresh store per run: node tests/evidence/b57/menu-check.mjs <base> <YYYY-MM-DD>
import { chromium } from '@playwright/test'
const [base, day] = process.argv.slice(2)
if (!base || new URL(base).hostname !== '127.0.0.1' || new URL(base).port === '3000' || !/^\d{4}-\d{2}-\d{2}$/.test(day ?? '')) throw Error('Use a disposable loopback server and a date')
const browser = await chromium.launch(), context = await browser.newContext({ viewport: { width: 1280, height: 900 }, timezoneId: 'America/Vancouver' })
await context.clock.install({ time: new Date(`${day}T10:00:00-07:00`) }); await context.clock.resume()
const p = await context.newPage()
await p.goto(`${base}/`, { waitUntil: 'networkidle' }); await p.waitForTimeout(800)
const top3 = p.locator(`.bn-block-outer[data-id="day:${day}:top3:template:0"] .bn-inline-content`).first()
await top3.click(); await p.keyboard.type('[] b57 task'); await p.waitForTimeout(1500)
const row = p.locator('[data-content-type="task"]', { hasText: 'b57 task' }).first()
await row.hover(); await p.locator('.bn-block-outer', { has: row }).locator('.editor-row-more').first().click(); await p.waitForTimeout(400)
const another = p.locator('.app-menu [role^=menuitem]', { hasText: 'Another day' })
if (await another.count()) { await another.first().hover(); await p.waitForTimeout(300) }
const items = await p.locator('.app-menu [role^=menuitem]').allInnerTexts()
console.log(day, JSON.stringify(items.map(t => t.replace(/\s+/g, ' ').trim()).filter(t => /Tomorrow|weekend|Next week|Pick date/.test(t))))
await browser.close()
